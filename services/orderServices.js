const stripe = require("stripe")(process.env.STRIPE_SECRET);
const asyncHandler = require("express-async-handler");
const { getAll, getOne } = require("./handlersFactory");
const ApiError = require("../utils/endpointError");
const { post } = require("axios");
const { logOrderActivity } = require("../socket/activityLogger");

const User = require("../models/userModel");
const Product = require("../models/productModel");
const Cart = require("../models/cartModel");
const Order = require("../models/orderModel");
const { createShipment, getTrackingInfo, updateOrderStatus } = require("./deliveryService");
const { generateInvoice } = require("./invoiceService");
// M2: Transition rules + stock re-adjustment for the admin order edit flow.
const { isAllowedTransition } = require("../utils/orderStatusTransitions");
const { applyQuantityDeltas } = require("../utils/stockAdjustment");

// M3: Single source of truth for the flat shipping fee (persisted on orders so
// admin/confirmation subtotals compute as totalOrderPrice - shippingPrice).
const SHIPPING_PRICE = 500;

// M0: Model helper aliases (were undefined, causing every order endpoint to 500)
const create = (data) => Order.create(data);
const _findOne = (query) => Order.findOne(query);
const _findById = (id) => Order.findById(id);
const findOne = (query) => User.findOne(query);
const bulkWrite = (ops, opts) => Product.bulkWrite(ops, opts);
const findById = (id) => Cart.findById(id);
const findByIdAndDelete = (id) => Cart.findByIdAndDelete(id);

const createCashOrder = asyncHandler(async (req, res, next) => {
  const shippingPrice = SHIPPING_PRICE;

  const cart = await findById(req.params.cartId);
  if (!cart) {
    return next(
      new ApiError(`There is no such cart with id ${req.params.cartId}`, 404)
    );
  }

  // M1: Cart ownership guard
  if (cart.user.toString() !== req.user._id.toString()) {
    return next(new ApiError("This cart does not belong to you", 403));
  }

  const cartPrice = cart.totalPriceAfterDiscount
    ? cart.totalPriceAfterDiscount
    : cart.totalCartPrice;

  const totalOrderPrice = cartPrice + shippingPrice;

  const order = await create({
    user: req.user._id,
    cartItems: cart.cartItems,
    shippingAddress: req.body.shippingAddress,
    shippingPrice, // M3: persist so the admin subtotal (total - shipping) is correct
    totalOrderPrice,
    codAmount: totalOrderPrice,
    deliveryStatus: "pending",
    paymentMethodType: "cash",
    paymentStatus: "pending",
    statusHistory: [
      {
        status: "pending",
        note: "Order created, waiting for seller confirmation",
        updatedBy: "customer",
      },
    ],
  });

  // Log activity
  if (order && req.user) {
    await logOrderActivity("create", order, req.user, {
      paymentMethod: "cash",
      itemsCount: cart.cartItems.length,
    });
  }

  if (order) {
    const bulkOption = cart.cartItems.map((item) => ({
      updateOne: {
        filter: { _id: item.product },
        update: { $inc: { quantity: -item.quantity, sold: +item.quantity } },
      },
    }));
    await bulkWrite(bulkOption, {});
    await findByIdAndDelete(req.params.cartId);
  }

  res.status(201).json({
    status: "success",
    message: "Order created successfully. Waiting for seller confirmation.",
    data: order,
  });
});

const handlePaymentCaptured = async (charge) => {
  try {
    // M4: BACKSTOP ONLY — createCardOrder (on checkout.session.completed) is the
    // single source of truth for payment capture: it already sets isPaid:true and
    // paymentStatus:"confirmed". This handler only reconciles orders that somehow
    // still have isPaid === false (e.g. legacy data); it is a no-op otherwise.
    // M2: Match by payment_intent, not total price (total price matching
    // corrupts the wrong order when two orders share the same amount).
    const order = await _findOne({
      stripePaymentIntentId: charge.payment_intent,
    });

    if (!order) return;

    if (!order.isPaid) {
      order.paymentStatus = "confirmed";
      order.isPaid = true;
      order.paidAt = new Date();
    }
    order.statusHistory.push({
      status: "payment_captured",
      note: `Payment captured by Stripe. Charge ID: ${charge.id}`,
      updatedBy: "system",
    });

    await order.save();
    console.log(`✔️ Payment captured for order: ${order._id}`);
  } catch (error) {
    console.error("Error handling payment capture:", error.message);
  }
};

const handlePaymentRefunded = async (charge) => {
  try {
    // M2: Match by payment_intent so refunds always land on the right order.
    const order = await _findOne({
      stripePaymentIntentId: charge.payment_intent,
    });

    if (!order) return;

    order.paymentStatus = "refunded";
    order.isPaid = false;
    order.statusHistory.push({
      status: "payment_refunded",
      note: `Payment refunded. Charge ID: ${charge.id}`,
      updatedBy: "system",
    });

    await order.save();
    console.log(`↩️ Payment refunded for order: ${order._id}`);
  } catch (error) {
    console.error("Error handling payment refund:", error.message);
  }
};

const filterOrderForLoggedUser = asyncHandler(async (req, res, next) => {
  // Everyone (admin or user) sees only their own orders
  req.filterObj = { user: req.user._id };
  next();
});

// M1: Load the order and ensure the requester owns it (or is an admin).
const restrictOrderAccess = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(
      new ApiError(`There is no such order with id: ${req.params.id}`, 404)
    );
  }

  const isOwner =
    order.user && order.user._id.toString() === req.user._id.toString();
  const isAdmin = req.user.role === "admin";

  if (!isOwner && !isAdmin) {
    return next(new ApiError("You are not allowed to access this order", 403));
  }

  req.order = order;
  next();
});

const findAllOrders = getAll(Order);
const findSpecificOrder = getOne(Order);

const updateOrderToPaid = asyncHandler(async (req, res, next) => {
  const order = await _findById(req.params.id);
  if (!order) {
    return next(
      new ApiError(
        `There is no such a order with this id:${req.params.id}`,
        404
      )
    );
  }

  order.isPaid = true;
  order.paidAt = Date.now();
  const updatedOrder = await order.save();

  // Log activity
  if (req.user) {
    await logOrderActivity("update", updatedOrder, req.user, {
      changes: "payment status marked as paid",
    });
  }

  res.status(200).json({ status: "success", data: updatedOrder });
});

const updateOrderToDelivered = asyncHandler(async (req, res, next) => {
  const order = await _findById(req.params.id);
  if (!order) {
    return next(
      new ApiError(
        `There is no such a order with this id:${req.params.id}`,
        404
      )
    );
  }

  order.isDelivered = true;
  order.deliveredAt = Date.now();
  order.deliveryStatus = "delivered";
  const updatedOrder = await order.save();

  // Log activity
  if (req.user) {
    await logOrderActivity("deliver", updatedOrder, req.user);
  }

  res.status(200).json({ status: "success", data: updatedOrder });
});

const checkoutSession = asyncHandler(async (req, res, next) => {
  const shippingPrice = SHIPPING_PRICE;

  const cart = await findById(req.params.cartId);
  if (!cart) {
    return next(
      new ApiError(`There is no such cart with id ${req.params.cartId}`, 404)
    );
  }

  // M1: Ownership guard — a user may only checkout their own cart.
  if (cart.user.toString() !== req.user._id.toString()) {
    return next(new ApiError("This cart does not belong to you", 403));
  }

  const cartPrice = cart.totalPriceAfterDiscount
    ? cart.totalPriceAfterDiscount
    : cart.totalCartPrice;
  const totalOrderPrice = cartPrice + shippingPrice;

  const shippingAddress = {
    wilaya: req.body.shippingAddress?.wilaya || "",
    dayra: req.body.shippingAddress?.dayra || "",
    baladiya: req.body.shippingAddress?.baladiya || "",
    phone: req.body.shippingAddress?.phone || "",
  };

  // M2 (Option B): NO order is created and NO stock is deducted here.
  // The order is only created inside the `checkout.session.completed`
  // webhook, so an abandoned session leaves no order and no stock change.
  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data: {
          currency: "dzd",
          product_data: {
            name: `Order for ${req.user.name}`,
          },
          unit_amount: totalOrderPrice * 100,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: `${process.env.FRONTEND_URL}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/checkout`,
    customer_email: req.user.email,
    client_reference_id: cart._id.toString(),
    metadata: {
      cartId: cart._id.toString(),
      userId: req.user._id.toString(),
      shippingWilaya: shippingAddress.wilaya,
      shippingDayra: shippingAddress.dayra,
      shippingBaladiya: shippingAddress.baladiya,
      shippingPhone: shippingAddress.phone,
    },
  });

  res.status(200).json({ status: "success", session });
});

const createCardOrder = async (session) => {
  // M1: Idempotency guard — Stripe retries webhooks that don't ack fast enough;
  // stripeSessionId has a unique index, so a duplicate create would throw E11000
  // and make the webhook 500 (which in turn triggers even more retries).
  const existing = await _findOne({ stripeSessionId: session.id });
  if (existing) {
    console.log(
      `✔️ Order ${existing._id} already exists for session ${session.id} — skipping duplicate`
    );
    return existing;
  }

  // M2: Resolve the cart from metadata (client_reference_id is the cart id).
  const cartId = session.metadata?.cartId || session.client_reference_id;
  const orderPrice = session.amount_total / 100;

  const shippingAddress = {
    wilaya: session.metadata?.shippingWilaya || "",
    dayra: session.metadata?.shippingDayra || "",
    baladiya: session.metadata?.shippingBaladiya || "",
    phone: session.metadata?.shippingPhone || "",
  };

  const cart = await findById(cartId);
  let user = await findOne({ _id: session.metadata?.userId });
  if (!user && session.customer_email) {
    user = await findOne({ email: session.customer_email });
  }

  if (!cart || !user) {
    console.error("Cart or user not found for session:", session.id);
    return;
  }

  // M1: Wrap the create so a concurrent duplicate webhook (race on the unique
  // stripeSessionId index) returns the existing order instead of failing.
  let order;
  try {
    order = await create({
      user: user._id,
      cartItems: cart.cartItems,
      shippingAddress,
      shippingPrice: SHIPPING_PRICE, // M3: persist so the admin subtotal is correct
      totalOrderPrice: orderPrice,
      paymentMethodType: "card",
      // M1/M4: Payment is captured at checkout (Stripe mode:"payment"), so the
      // order starts confirmed + paid. The admin "Confirm" button is a DELIVERY
      // confirmation (pending -> confirmed), not a payment-capture step.
      paymentStatus: "confirmed",
      deliveryStatus: "pending",
      isPaid: true,
      paidAt: new Date(),
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent || undefined,
      statusHistory: [
        {
          status: "pending",
          note: "Order created from Stripe checkout. Payment received.",
          updatedBy: "system",
        },
      ],
    });
  } catch (error) {
    if (error?.code === 11000) {
      const dup = await _findOne({ stripeSessionId: session.id });
      if (dup) {
        console.log(
          `✔️ Duplicate session ${session.id} — reusing order ${dup._id}`
        );
        return dup;
      }
    }
    throw error;
  }

  if (order) {
    const bulkOption = cart.cartItems.map((item) => ({
      updateOne: {
        filter: { _id: item.product },
        update: { $inc: { quantity: -item.quantity, sold: +item.quantity } },
      },
    }));
    await bulkWrite(bulkOption, {});
    await findByIdAndDelete(cartId);
  }

  console.log(`✔️ Order created: ${order._id} for session: ${session.id}`);
  return order;
};

const getOrderBySession = asyncHandler(async (req, res, next) => {
  const order = await _findOne({
    stripeSessionId: req.params.sessionId,
    user: req.user._id,
  });

  if (!order) {
    return next(new ApiError(`No order found for this session`, 404));
  }

  res.status(200).json({
    status: "success",
    data: order,
  });
});

const webhookCheckout = asyncHandler(async (req, res, next) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed":
      await createCardOrder(event.data.object);
      break;

    case "charge.succeeded":
      await handlePaymentCaptured(event.data.object);
      break;

    case "charge.refunded":
      await handlePaymentRefunded(event.data.object);
      break;

    case "payout.paid":
      console.log("💰 Payout completed:", event.data.object.id);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.status(200).json({ received: true });
});

const confirmOrder = asyncHandler(async (req, res, next) => {
  const order = await _findById(req.params.id);

  if (!order) {
    return next(
      new ApiError(`There is no such order with id: ${req.params.id}`, 404)
    );
  }

  if (order.deliveryStatus !== "pending") {
    return next(
      new ApiError(`Order already confirmed or in different state`, 400)
    );
  }

  order.deliveryStatus = "confirmed";
  order.statusHistory.push({
    status: "confirmed",
    note: "Order confirmed by seller",
    updatedBy: "seller",
  });

  await order.save();

  // Log activity
  if (req.user) {
    await logOrderActivity("confirm", order, req.user);
  }

  res.status(200).json({
    status: "success",
    message: "Order confirmed. Ready to ship.",
    data: order,
  });
});

const shipOrder = asyncHandler(async (req, res, next) => {
  try {
    const order = await _findById(req.params.id);
    const result = await createShipment(req.params.id);

    // Log activity
    if (req.user && order) {
      await logOrderActivity("ship", order, req.user, {
        trackingNumber: result.trackingNumber || "pending",
      });
    }

    res.status(200).json({
      status: "success",
      ...result,
    });
  } catch (error) {
    return next(new ApiError(error.message, 400));
  }
});

const getOrderTracking = asyncHandler(async (req, res, next) => {
  const order = await _findById(req.params.id).populate(
    "user",
    "name email"
  );

  if (!order) {
    return next(
      new ApiError(`There is no such order with id: ${req.params.id}`, 404)
    );
  }

  let trackingInfo = null;
  if (order.trackingNumber) {
    try {
      trackingInfo = await getTrackingInfo(
        order.trackingNumber
      );
    } catch (error) {
      console.error("Failed to fetch tracking info:", error.message);
    }
  }

  res.status(200).json({
    status: "success",
    data: {
      order: {
        _id: order._id,
        orderNumber: order._id,
        deliveryStatus: order.deliveryStatus,
        trackingNumber: order.trackingNumber,
        isPaid: order.isPaid,
        isDelivered: order.isDelivered,
        totalOrderPrice: order.totalOrderPrice,
        statusHistory: order.statusHistory,
      },
      tracking: trackingInfo,
    },
  });
});

const deliveryWebhook = asyncHandler(async (req, res, next) => {
  console.log("📦 Delivery webhook received:", req.body);

  const { event, data } = req.body;

  if (event === "parcel.status.updated") {
    try {
      await updateOrderStatus(data.order_id, {
        status: data.status,
        note: `Delivery update: ${data.status}`,
      });

      console.log(`✔️ Order ${data.order_id} updated to: ${data.status}`);
    } catch (error) {
      console.error("❌ Webhook processing error:", error.message);
    }
  }

  res.status(200).json({
    success: true,
    message: "Webhook received",
  });
});

const simulateDelivery = asyncHandler(async (req, res, next) => {
  const order = await _findById(req.params.id);

  if (!order || !order.trackingNumber) {
    return next(
      new ApiError("Order not shipped yet or tracking number missing", 404)
    );
  }

  const { speed, scenario } = req.body;
  try {
    const response = await post(
      `${process.env.DELIVERY_API_URL || "http://localhost:3001/api/v1"}/parcels/${order.trackingNumber}/simulate`,
      { speed, scenario }
    );

    res.status(200).json({
      status: "success",
      message: "Delivery simulation started",
      data: response.data.data,
    });
  } catch (error) {
    return next(
      new ApiError(`Simulation failed: ${error.message || error}`, 400)
    );
  }
});

const cancelOrder = asyncHandler(async (req, res, next) => {
  // M1: Reuse the order loaded by restrictOrderAccess when present.
  const order = req.order || (await _findById(req.params.id));

  if (!order) {
    return next(
      new ApiError(`There is no such order with id: ${req.params.id}`, 404)
    );
  }

  // M4: Reject double-cancellation / cancelling once shipped.
  if (!["pending", "confirmed"].includes(order.deliveryStatus)) {
    return next(
      new ApiError(
        `Cannot cancel order. Current status: ${order.deliveryStatus}. Orders can only be cancelled before shipping.`,
        400
      )
    );
  }

  // M4: Restore product stock and decrement sold count (floored at 0).
  if (order.cartItems && order.cartItems.length > 0) {
    for (const item of order.cartItems) {
      await Product.updateOne(
        { _id: item.product },
        [
          {
            $set: {
              quantity: { $add: ["$quantity", item.quantity] },
              sold: { $max: [{ $subtract: ["$sold", item.quantity] }, 0] },
            },
          },
        ]
      );
    }
  }

  // M4: For card orders with captured/authorized payment, issue a real Stripe
  // refund. Only mark paymentStatus "refunded" when the refund actually
  // succeeded — never mark refunded when there is no PaymentIntent or the
  // refund API call failed (that would silently lose money).
  const shouldRefund =
    order.paymentMethodType === "card" &&
    ["authorized", "confirmed"].includes(order.paymentStatus) &&
    order.isPaid;

  if (shouldRefund) {
    const updatedBy = req.user?.role === "admin" ? "seller" : "customer";

    if (!order.stripePaymentIntentId) {
      console.warn(
        `Cannot refund order ${order._id}: no stripePaymentIntentId. Payment NOT marked as refunded.`
      );
      order.statusHistory.push({
        status: "refund_failed",
        note: "Refund could not be issued: missing Stripe PaymentIntent ID. Payment left unchanged.",
        updatedBy,
      });
    } else {
      try {
        const refundResult = await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId,
        });
        console.log(
          `↩️ Stripe refund created for order ${order._id}: ${refundResult.id}`
        );
        order.paymentStatus = "refunded";
        order.isPaid = false;
        order.statusHistory.push({
          status: "payment_refunded",
          note: `Payment refunded via Stripe. Refund ID: ${refundResult.id}`,
          updatedBy,
        });
      } catch (error) {
        console.error(
          `Failed to refund Stripe payment for order ${order._id}:`,
          error.message
        );
        order.statusHistory.push({
          status: "refund_failed",
          note: `Refund failed: ${error.message}. Payment NOT marked as refunded.`,
          updatedBy,
        });
      }
    }
  }

  order.deliveryStatus = "cancelled";
  order.statusHistory.push({
    status: "cancelled",
    note: req.body.reason || "Order cancelled by user",
    updatedBy: req.user?.role === "admin" ? "seller" : "customer",
  });

  await order.save();

  // Log activity
  if (req.user) {
    await logOrderActivity("cancel", order, req.user, {
      reason: req.body.reason || "No reason provided",
    });
  }

  res.status(200).json({
    status: "success",
    message: "Order cancelled successfully",
    data: order,
  });
});

const confirmCardOrder = asyncHandler(async (req, res, next) => {
  const order = await _findById(req.params.id);

  if (!order) {
    return next(
      new ApiError(`There is no such order with id: ${req.params.id}`, 404)
    );
  }

  if (order.paymentMethodType !== "card") {
    return next(
      new ApiError("This endpoint is only for card payment orders", 400)
    );
  }

  if (order.deliveryStatus !== "pending") {
    return next(
      new ApiError(
        `Cannot confirm. Delivery status is: ${order.deliveryStatus}`,
        400
      )
    );
  }

  // M1: Payment is captured at checkout (paymentStatus "confirmed"), so this
  // endpoint is the seller's DELIVERY confirmation step for card orders.
  if (!["authorized", "confirmed"].includes(order.paymentStatus)) {
    return next(
      new ApiError(
        `Cannot confirm. Payment status is: ${order.paymentStatus}`,
        400
      )
    );
  }

  // Payment may already be "confirmed" (captured at checkout); only promote
  // "authorized" -> "confirmed" so the flow is correct in both cases.
  if (order.paymentStatus === "authorized") {
    order.paymentStatus = "confirmed";
  }
  order.deliveryStatus = "confirmed";
  order.statusHistory.push({
    status: "confirmed",
    note: "Payment confirmed. Order ready to ship.",
    updatedBy: "seller",
  });

  await order.save();

  // Log activity
  if (req.user) {
    await logOrderActivity("confirm", order, req.user);
  }

  res.status(200).json({
    status: "success",
    message: "Card payment order confirmed. Ready to ship.",
    data: order,
  });
});

// M2: Admin order edit — single source of truth for the View/Edit dialog.
// Cash/COD orders: fully editable (status, address, item qty+color, shipping
// price, tracking number). Card orders: read-only except delivery-status
// progression (Status tab); any data edit is rejected with 403.
// Strict whitelist is enforced by updateOrderValidator (unknown keys → 400);
// transition legality (isAllowedTransition) is enforced here.
const updateOrder = asyncHandler(async (req, res, next) => {
  const order = await _findById(req.params.id);

  if (!order) {
    return next(
      new ApiError(`There is no such order with id: ${req.params.id}`, 404)
    );
  }

  const {
    deliveryStatus,
    statusNote,
    shippingAddress,
    cartItems,
    shippingPrice,
    trackingNumber,
  } = req.body;

  // Card orders are data read-only: only deliveryStatus (+ statusNote) may be
  // sent. The validator already rejects unknown top-level keys with 400; this
  // guard turns any *known-but-forbidden* data edit on a card order (address,
  // items, shippingPrice, trackingNumber) into a clear 403.
  const isStatusOnlyBody = Object.keys(req.body).every((key) =>
    ["deliveryStatus", "statusNote"].includes(key)
  );
  if (order.paymentMethodType === "card" && !isStatusOnlyBody) {
    return next(
      new ApiError(
        "Card orders are read-only. Only the delivery status can be updated.",
        403
      )
    );
  }

  // --- delivery status progression (cash + card share the Status tab) ---
  if (deliveryStatus !== undefined) {
    // Same-state moves and terminal states (cancelled/failed/returned/
    // completed) have no outgoing transitions → isAllowedTransition is false.
    if (!isAllowedTransition(order.deliveryStatus, deliveryStatus)) {
      return next(
        new ApiError(
          `Cannot change delivery status from "${order.deliveryStatus}" to "${deliveryStatus}"`,
          400
        )
      );
    }

    order.deliveryStatus = deliveryStatus;
    order.statusHistory.push({
      status: deliveryStatus,
      note: statusNote || "Order updated by seller",
      updatedBy: "seller",
    });

    if (req.user) {
      await logOrderActivity("update", order, req.user, {
        changes: `status -> ${deliveryStatus}`,
      });
    }
  }

  // --- cash-only editable fields (card orders stay untouched here) ---
  if (order.paymentMethodType !== "card") {
    if (shippingAddress !== undefined) {
      // Whitelist sub-keys (mirrors updateOrderValidator) — never trust the
      // raw object wholesale.
      order.shippingAddress = {
        wilaya: shippingAddress.wilaya,
        dayra: shippingAddress.dayra,
        baladiya: shippingAddress.baladiya,
        phone: shippingAddress.phone,
      };
    }

    if (cartItems !== undefined) {
      // Resolve incoming changes against the order's current items (matched by
      // product id). Stock is validated/applied BEFORE mutating the order's
      // quantities, so applyQuantityDeltas computes deltas from the original
      // quantities. On shortage we abort with 400 and nothing is persisted.
      const matchedChanges = [];
      for (const change of cartItems) {
        const item = order.cartItems.find(
          (i) => String(i.product?._id || i.product) === String(change._id)
        );
        if (item) matchedChanges.push(change);
      }

      if (matchedChanges.length > 0) {
        const stockResult = await applyQuantityDeltas(
          order,
          matchedChanges,
          Product
        );
        if (!stockResult.ok) {
          return next(new ApiError(stockResult.reason, 400));
        }
      }

      // Apply qty/color to the matching cart items (price stays frozen).
      for (const change of cartItems) {
        const item = order.cartItems.find(
          (i) => String(i.product?._id || i.product) === String(change._id)
        );
        if (!item) continue;
        if (change.quantity !== undefined) item.quantity = change.quantity;
        if (change.color !== undefined) item.color = change.color;
      }
    }

    if (shippingPrice !== undefined) {
      order.shippingPrice = shippingPrice;
    }

    if (trackingNumber !== undefined) {
      order.trackingNumber = trackingNumber;
    }
  }

  // --- always recompute totals from frozen per-item prices ---
  const subtotal = order.cartItems.reduce(
    (sum, item) => sum + (item.quantity || 0) * (item.price || 0),
    0
  );
  order.totalOrderPrice =
    Math.round(
      (subtotal + (order.shippingPrice || 0) + (order.taxPrice || 0)) * 100
    ) / 100;

  // COD amount mirrors the total for cash orders (derived field).
  if (order.paymentMethodType === "cash") {
    order.codAmount = order.totalOrderPrice;
  }

  const updatedOrder = await order.save();

  res.status(200).json({ status: "success", data: updatedOrder });
});

const downloadInvoice = asyncHandler(async (req, res, next) => {
  const order = await _findById(req.params.id)
    .populate("user", "name email phone")
    // Product model exposes `name`/`mainImage` (not `title`/`imageCover`)
    .populate("cartItems.product", "name mainImage");

  if (!order) {
    return next(
      new ApiError(`There is no such order with id: ${req.params.id}`, 404)
    );
  }

  if (
    req.user.role !== "admin" &&
    order.user?._id?.toString() !== req.user._id.toString()
  ) {
    return next(
      new ApiError("You are not authorized to download this invoice", 403)
    );
  }

  const pdfBuffer = await generateInvoice(order);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=invoice-${order._id}.pdf`
  );

  res.send(pdfBuffer);
});


module.exports = {
  createCashOrder,
  filterOrderForLoggedUser,
  findAllOrders,
  findSpecificOrder,
  restrictOrderAccess,
  updateOrderToPaid,
  updateOrderToDelivered,
  checkoutSession,
  getOrderBySession,
  webhookCheckout,
  confirmOrder,
  shipOrder,
  getOrderTracking,
  deliveryWebhook,
  simulateDelivery,
  cancelOrder,
  confirmCardOrder,
  updateOrder,
  downloadInvoice
};
