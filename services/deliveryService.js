const axios = require("axios");
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const Product = require("../models/productModel");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
// M2: Reused by the webhook-driven `returned`/`failed` flow (restock + refund
// + cash payment closure).
const {
  restockOrderItems,
  refundCardOrder,
  closeCashPayment,
} = require("../utils/orderRecovery");
// M3: Delivery activity logging.
const ActivityLogger = require("../socket/activityLogger");

// M3: System-level actor for webhook-triggered delivery events (no authenticated
// user is available when the delivery agency fires a webhook).
const SYSTEM_USER = Object.freeze({
  _id: new mongoose.Types.ObjectId("000000000000000000000000"),
  name: "Delivery System",
  role: "admin",
});

// M3: Maps delivery agency status strings to logDeliveryActivity action keys.
const DELIVERY_STATUS_ACTION_MAP = Object.freeze({
  in_transit: "inTransit",
  out_for_delivery: "outForDelivery",
  delivered: "delivered",
  failed_delivery: "failed",
  returned: "returned",
});

// Configuration
// M3: Fixed broken default URL (was .../api/api/v1/)
const DELIVERY_API_URL =
  process.env.DELIVERY_API_URL || "http://localhost:3001/api/v1";
const WEBHOOK_URL =
  process.env.DELIVERY_WEBHOOK_URL ||
  "http://localhost:5000/api/v1/orders/delivery/webhook";

// M3: Ordered delivery flow — statuses may only move forward along this list.
// Indexes are used to reject downgrades (e.g. shipped -> confirmed).
const DELIVERY_FLOW = [
  "pending",
  "confirmed",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "completed",
  "failed",
  "returned",
  "cancelled",
];

class DeliveryService {
  // Create shipment with delivery agency (call after order is confirmed)
  static async createShipment(id) {
    try {
      const order = await Order.findById(id).populate(
        "user",
        "name email phone"
      );

      if (!order) {
        throw new Error("Order not found");
      }

      if (order.deliveryStatus !== "confirmed") {
        throw new Error("Order must be confirmed before shipping");
      }

      // M2: Idempotency — if a parcel was already created for this order (e.g.
      // a retry after a failed confirm), don't POST a second one. Return the
      // existing tracking number so callers (confirmOrder) skip creation and
      // go straight to auto-simulate. The "must be confirmed" guard above is
      // intentionally NOT relaxed.
      if (order.trackingNumber) {
        return {
          success: true,
          alreadyShipped: true,
          trackingNumber: order.trackingNumber,
          message: "Shipment already exists for this order",
        };
      }

      // Prepare product list
      const productList = order.cartItems.map((item) => ({
        name: item.product?.name || "Product",
        quantity: item.quantity,
        price: item.price,
      }));

      // Call delivery agency API
      const response = await axios.post(`${DELIVERY_API_URL}/parcels`, {
        order_id: order._id.toString(),
        customer_name: order.user.name,
        customer_phone: order.shippingAddress.phone || order.user.phone,
        customer_address: order.shippingAddress.baladiya,
        wilaya: order.shippingAddress.wilaya,
        product_list: productList,
        price: order.totalOrderPrice,
        webhook_url: WEBHOOK_URL,
      });

      if (response.data.success) {
        // Update order with tracking info
        order.trackingNumber = response.data.data.tracking_number;
        order.deliveryStatus = "shipped";
        order.deliveryAgency = {
          name: "Yalidine Express",
          apiResponse: response.data,
        };
        order.statusHistory.push({
          status: "shipped",
          note: `Package handed to delivery agency. Tracking: ${response.data.data.tracking_number}`,
          updatedBy: "system",
        });

        await order.save();

        return {
          success: true,
          trackingNumber: response.data.data.tracking_number,
          message: "Shipment created successfully",
        };
      }
    } catch (error) {
      console.error("Error creating shipment:", error.message);
      throw new Error(`Failed to create shipment: ${error.message}`);
    }
  }

  // Best-effort cancellation of a parcel in the delivery API (M2). Called by
  // cancelOrder. Never throws — a mock/agency failure is logged and the order
  // cancel proceeds regardless (best-effort, decision 5 / risk 3).
  static async cancelParcel(trackingNumber) {
    if (!trackingNumber) {
      return;
    }
    try {
      await axios.put(`${DELIVERY_API_URL}/parcels/${trackingNumber}/status`, {
        status: "cancelled",
      });
      console.log(`🚫 Parcel ${trackingNumber} cancelled in delivery API`);
    } catch (error) {
      console.warn(
        `⚠️ Failed to cancel parcel ${trackingNumber} in delivery API: ${error.message}`
      );
    }
  }

  // Start the delivery auto-simulation for an order (M2). Reads the order's
  // tracking number and picks a RANDOM scenario backend-side (success/failed);
  // the mock API then drives status via webhooks. Throws on failure so callers
  // (confirmOrder) can revert/abort.
  static async startSimulation(id) {
    const order = await Order.findById(id);

    if (!order) {
      throw new Error("Order not found");
    }

    if (!order.trackingNumber) {
      throw new Error("Order has no tracking number — cannot simulate");
    }

    // 50/50 random scenario. "failed" ends at `returned` (via webhook), which
    // restocks + refunds (decision 9); anything else follows the success flow.
    const scenario = Math.random() < 0.5 ? "failed" : "success";

    try {
      const response = await axios.post(
        `${DELIVERY_API_URL}/parcels/${order.trackingNumber}/simulate`,
        { speed: "fast", scenario }
      );

      if (response.data && response.data.success) {
        return response.data;
      }
      throw new Error(
        response.data?.message ||
          "Delivery API did not confirm simulation start"
      );
    } catch (error) {
      console.error("Error starting delivery simulation:", error.message);
      throw new Error(`Failed to start delivery simulation: ${error.message}`);
    }
  }

  // Update order status from delivery agency webhook
  // M3: accepts optional `triggeredBy` — defaults to SYSTEM_USER for
  // webhook-driven events where no authenticated user is available.
  static async updateOrderStatus(id, deliveryData, triggeredBy = SYSTEM_USER) {
    try {
      const order = await Order.findById(id);

      if (!order) {
        throw new Error("Order not found");
      }

      // Map delivery agency statuses to your order statuses
      // M3: pending_pickup -> "shipped" (the parcel was created, so the order
      // is already with the agency). Previously mapped to "confirmed", which
      // regressed a shipped order back to confirmed.
      const statusMap = {
        pending_pickup: "shipped",
        collected: "shipped",
        in_transit: "in_transit",
        out_for_delivery: "out_for_delivery",
        delivered: "delivered",
        completed: "completed",
        failed_delivery: "failed",
        returned: "returned",
        cancelled: "cancelled",
      };

      const mappedStatus = statusMap[deliveryData.status];
      const newStatus = mappedStatus || order.deliveryStatus;

      // M3: Never-downgrade guard — only move forward in the delivery flow.
      if (mappedStatus) {
        const currentIdx = DELIVERY_FLOW.indexOf(order.deliveryStatus);
        const newIdx = DELIVERY_FLOW.indexOf(newStatus);
        if (newIdx < currentIdx) {
          console.log(
            `⚠️ Skipping delivery status downgrade: ${order.deliveryStatus} -> ${newStatus}`
          );
          return order;
        }
      }

      // M3: No-op when the status is unchanged (avoids history spam, e.g.
      // a repeated pending_pickup webhook when the order is already shipped).
      if (newStatus === order.deliveryStatus) {
        return order;
      }

      // Update order
      order.deliveryStatus = newStatus;
      order.statusHistory.push({
        status: newStatus,
        timestamp: new Date(),
        note: deliveryData.note || `Delivery status: ${deliveryData.status}`,
        updatedBy: "delivery_agency",
      });

      // M2: A `returned`/`failed` parcel is treated like a cancellation —
      // restore product stock and, for paid card orders, issue a Stripe refund
      // BEFORE persisting. Restock/refund are best-effort: refund failures are
      // recorded in statusHistory (refund_failed) without blocking the save.
      // Cash (COD) orders get their payment closed via closeCashPayment
      // (`cancelled`) since there is no Stripe PaymentIntent to refund.
      if (["returned", "failed"].includes(mappedStatus)) {
        await restockOrderItems(order, Product);
        await refundCardOrder(order, stripe, "delivery_agency");
        closeCashPayment(order, "delivery_agency");
      }

      // M3: Log delivery activity for every meaningful status transition.
      // `logDeliveryActivity` maps the action to the canonical activity literal
      // (e.g. "Delivery In Transit") and appropriate status badge (pending /
      // success / failed). Fire-and-forget so a logging failure never blocks
      // the order update.
      const deliveryAction = DELIVERY_STATUS_ACTION_MAP[mappedStatus];
      if (deliveryAction) {
        ActivityLogger.logDeliveryActivity(deliveryAction, order, triggeredBy, {
          trackingNumber: order.trackingNumber || null,
          reason: deliveryData.note || null,
          agencyStatus: deliveryData.status,
        }).catch((err) => {
          console.error("M3: Failed to log delivery activity:", err.message);
        });
      }

      // If delivered, mark accordingly
      if (newStatus === "delivered") {
        order.isDelivered = true;
        order.deliveredAt = new Date();

        // For COD: mark as paid when delivered
        if (order.paymentMethodType === "cash") {
          order.isPaid = true;
          order.paidAt = new Date();
          order.paymentStatus = "completed";
        }

        // For Card: payment was already authorized, just update delivery
        if (order.paymentMethodType === "card") {
          // Payment status remains 'confirmed' until admin marks it 'completed'
        }
      }

      // If completed (COD collected or card payment settled)
      if (newStatus === "completed") {
        order.isPaid = true;
        order.isDelivered = true;
        order.paymentStatus = "completed";
      }

      await order.save();

      return order;
    } catch (error) {
      console.error("Error updating order status:", error.message);
      throw error;
    }
  }

  // Get tracking info from delivery agency
  static async getTrackingInfo(trackingNumber) {
    try {
      const response = await axios.get(
        `${DELIVERY_API_URL}/parcels/${trackingNumber}`
      );
      return response.data;
    } catch (error) {
      console.error("Error getting tracking info:", error.message);
      throw error;
    }
  }
}

module.exports = DeliveryService;
