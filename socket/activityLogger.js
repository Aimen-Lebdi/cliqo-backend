const mongoose = require("mongoose");
const ActivityLog = require("../models/activityLogModel");
const socketInstance = require("../utils/socketEmitter");
const { computeActivityStats } = require("./activityStats");
const { ACTIVITIES, STATUS, RELATED_MODEL_MAP } = require("./activityTypes");

class ActivityLogger {
  static async logActivity({
    type,
    activity,
    user,
    description,
    status = "success",
    amount = null,
    relatedId,
    relatedModel,
    metadata = {},
  }) {
    try {
      // Safety check for user object
      if (!user || !user._id || !user.name || !user.role) {
        console.error("ActivityLogger: Invalid user object", user);
        return null;
      }

      const activityLog = await ActivityLog.create({
        type,
        activity,
        user: {
          name: user.name,
          id: user._id,
          role: user.role,
        },
        description,
        status,
        amount,
        relatedId,
        relatedModel,
        metadata,
      });

      const activityData = {
        _id: activityLog._id,
        type: activityLog.type,
        activity: activityLog.activity,
        user: activityLog.user,
        description: activityLog.description,
        status: activityLog.status,
        amount: activityLog.amount,
        createdAt: activityLog.createdAt,
        metadata: activityLog.metadata,
      };

      // Check if socket instance exists before emitting
      if (socketInstance && socketInstance.getSocket()) {
        try {
          // FIXED: Only emit to dashboard room (admins who joined dashboard)
          // This prevents duplicate emissions
          socketInstance.getSocket().emitToDashboard("new_activity", activityData);

          console.log(`📤 Activity emitted to dashboard: ${activity}`);

          // FIXED (M6): Also push fresh realtime stats so the dashboard's live
          // metrics (cards/chart) refresh in sync with the new activity. Gated
          // on dashboard listeners and fire-and-forget so activity logging is
          // never blocked by the stats aggregation.
          if (socketInstance.getSocket().hasDashboardListeners()) {
            computeActivityStats()
              .then((realtimeStats) => {
                socketInstance
                  .getSocket()
                  .emitToDashboard("activity_stats", {
                    ...realtimeStats,
                    timestamp: new Date(),
                  });
                console.log("📊 Realtime activity stats pushed to dashboard");
              })
              .catch((statsError) => {
                console.error(
                  "Error computing realtime activity stats:",
                  statsError.message
                );
              });
          }
        } catch (socketError) {
          console.error("Error emitting socket event:", socketError.message);
          // Don't throw - activity was logged successfully
        }
      }

      return activityLog;
    } catch (error) {
      console.error("Error logging activity:", error);
      return null;
    }
  }

  // ==================== CATEGORY ACTIVITIES ====================
  static async logCategoryActivity(action, category, user, additionalData = {}) {
    const activities = {
      create: "Category Created",
      update: "Category Updated",
      delete: "Category Deleted",
    };

    const descriptions = {
      create: `New category "${category.name}" created`,
      update: `Category "${category.name}" updated${
        additionalData.changes ? ` - ${additionalData.changes}` : ""
      }`,
      delete: `Category "${category.name}" deleted`,
    };

    return await ActivityLogger.logActivity({
      type: "category",
      activity: activities[action],
      user,
      description: descriptions[action],
      relatedId: category._id,
      relatedModel: "Category",
      metadata: {
        categoryName: category.name,
        categorySlug: category.slug,
        ...additionalData,
      },
    });
  }

  // ==================== PRODUCT ACTIVITIES ====================
  static async logProductActivity(action, product, user, additionalData = {}) {
    const activities = {
      create: "Product Created",
      update: "Product Updated",
      delete: "Product Deleted",
    };

    const descriptions = {
      create: `New product "${product.title}" created with price ${product.price} DZD`,
      update: `Product "${product.title}" updated${
        additionalData.changes ? ` - ${additionalData.changes}` : ""
      }`,
      delete: `Product "${product.title}" deleted (Stock: ${product.quantity})`,
    };

    return await ActivityLogger.logActivity({
      type: "product",
      activity: activities[action],
      user,
      description: descriptions[action],
      amount: product.price || null,
      relatedId: product._id,
      relatedModel: "Product",
      metadata: {
        productTitle: product.title,
        productPrice: product.price,
        productQuantity: product.quantity,
        productCategory: product.category,
        productBrand: product.brand,
        ...additionalData,
      },
    });
  }

  // ==================== ORDER ACTIVITIES ====================
  static async logOrderActivity(action, order, user, additionalData = {}) {
    const activities = {
      create: "New Order Placed",
      update: "Order Updated",
      confirm: "Order Confirmed",
      ship: "Order Shipped",
      deliver: "Order Delivered",
      cancel: "Order Cancelled",
    };

    const descriptions = {
      create: `New order #${order._id.toString().slice(-8)} placed - Amount: ${order.totalOrderPrice} DZD`,
      update: `Order #${order._id.toString().slice(-8)} updated${
        additionalData.changes ? ` - ${additionalData.changes}` : ""
      }`,
      confirm: `Order #${order._id.toString().slice(-8)} confirmed by seller`,
      ship: `Order #${order._id.toString().slice(-8)} shipped - Tracking: ${additionalData.trackingNumber || "N/A"}`,
      deliver: `Order #${order._id.toString().slice(-8)} delivered`,
      cancel: `Order #${order._id.toString().slice(-8)} cancelled - Reason: ${additionalData.reason || "No reason provided"}`,
    };

    return await ActivityLogger.logActivity({
      type: "order",
      activity: activities[action],
      user,
      description: descriptions[action],
      status: additionalData.status || "success",
      amount: order.totalOrderPrice || order.totalPrice,
      relatedId: order._id,
      relatedModel: "Order",
      metadata: {
        orderId: order._id,
        customerName: order.user?.name || "Unknown",
        totalAmount: order.totalOrderPrice || order.totalPrice,
        paymentMethod: order.paymentMethodType,
        deliveryStatus: order.deliveryStatus,
        itemsCount: order.cartItems?.length || 0,
        ...additionalData,
      },
    });
  }

  // ==================== USER ACTIVITIES ====================
  static async logUserActivity(action, targetUser, adminUser, additionalData = {}) {
    const activities = {
      create: "User Registered",
      update: "User Updated",
      delete: "User Deactivated",
      activate: "User Activated",
      passwordChange: "User Password Changed",
      ban: "User Banned",
      unban: "User Unbanned",
    };

    const descriptions = {
      create: `User "${targetUser.name}" (${targetUser.email}) registered`,
      update: `User "${targetUser.name}" profile updated${
        additionalData.changes ? ` - ${additionalData.changes}` : ""
      }`,
      delete: `User "${targetUser.name}" account deactivated`,
      activate: `User "${targetUser.name}" account activated`,
      passwordChange: `Password changed for user "${targetUser.name}"`,
      ban: `User "${targetUser.name}" (${targetUser.email}) account suspended by admin`,
      unban: `User "${targetUser.name}" (${targetUser.email}) account reactivated by admin`,
    };

    return await ActivityLogger.logActivity({
      type: "user",
      activity: activities[action],
      user: adminUser,
      description: descriptions[action],
      relatedId: targetUser._id,
      relatedModel: "User",
      metadata: {
        targetUserName: targetUser.name,
        targetUserEmail: targetUser.email,
        targetUserRole: targetUser.role,
        targetUserActive: targetUser.active,
        ...additionalData,
      },
    });
  }

  // ==================== BRAND ACTIVITIES ====================
  static async logBrandActivity(action, brand, user, additionalData = {}) {
    const activities = {
      create: "Brand Created",
      update: "Brand Updated",
      delete: "Brand Deleted",
    };

    const descriptions = {
      create: `New brand "${brand.name}" created`,
      update: `Brand "${brand.name}" updated${
        additionalData.changes ? ` - ${additionalData.changes}` : ""
      }`,
      delete: `Brand "${brand.name}" deleted`,
    };

    return await ActivityLogger.logActivity({
      type: "brand",
      activity: activities[action],
      user,
      description: descriptions[action],
      relatedId: brand._id,
      relatedModel: "Brand",
      metadata: {
        brandName: brand.name,
        brandSlug: brand.slug,
        ...additionalData,
      },
    });
  }

  // ==================== SUBCATEGORY ACTIVITIES ====================
  static async logSubCategoryActivity(action, subCategory, user, additionalData = {}) {
    const activities = {
      create: "SubCategory Created",
      update: "SubCategory Updated",
      delete: "SubCategory Deleted",
    };

    const descriptions = {
      create: `New subcategory "${subCategory.name}" created`,
      update: `SubCategory "${subCategory.name}" updated${
        additionalData.changes ? ` - ${additionalData.changes}` : ""
      }`,
      delete: `SubCategory "${subCategory.name}" deleted`,
    };

    return await ActivityLogger.logActivity({
      type: "subcategory",
      activity: activities[action],
      user,
      description: descriptions[action],
      relatedId: subCategory._id,
      relatedModel: "SubCategory",
      metadata: {
        subCategoryName: subCategory.name,
        subCategorySlug: subCategory.slug,
        parentCategory: subCategory.category,
        ...additionalData,
      },
    });
  }


  // ==================== BULK OPERATIONS ====================
  static async logBulkDeleteActivity(model, count, ids, user, additionalData = {}) {
    const modelTypeMap = {
      Product: "product",
      Category: "category",
      Brand: "brand",
      User: "user",
      SubCategory: "subcategory",
    };

    return await ActivityLogger.logActivity({
      type: modelTypeMap[model] || "product",
      activity: `${model}s Bulk Deleted`,
      user,
      description: `${count} ${model.toLowerCase()}(s) deleted in bulk operation`,
      relatedId: user._id,
      relatedModel: model,
      metadata: {
        bulkOperation: true,
        totalDeleted: count,
        itemsDeleted: ids,
        ...additionalData,
      },
    });
  }

  static async logBulkActivateActivity(count, ids, user, additionalData = {}) {
    return await ActivityLogger.logActivity({
      type: "user",
      activity: "Users Activated",
      user,
      description: `${count} user(s) activated in bulk operation`,
      relatedId: user._id,
      relatedModel: "User",
      metadata: {
        bulkOperation: true,
        totalActivated: count,
        usersActivated: ids,
        ...additionalData,
      },
    });
  }

  static async logBulkDeactivateActivity(count, ids, user, additionalData = {}) {
    return await ActivityLogger.logActivity({
      type: "user",
      activity: "Users Deactivated",
      user,
      description: `${count} user(s) deactivated in bulk operation`,
      relatedId: user._id,
      relatedModel: "User",
      metadata: {
        bulkOperation: true,
        totalDeactivated: count,
        usersDeactivated: ids,
        ...additionalData,
      },
    });
  }

  // ==================== PAYMENT ACTIVITIES ====================
  /**
   * Log a payment lifecycle event (Captured, Refunded, Failed, Marked Paid).
   *
   * @param {string}   action  - One of 'captured', 'refunded', 'failed', 'markedPaid'
   * @param {Object}   order   - Mongoose order document
   * @param {Object}   user    - The admin/operator who triggered the action
   * @param {Object}   [extra] - Additional metadata (e.g. chargeId, reason)
   */
  static async logPaymentActivity(action, order, user, extra = {}) {
    const literals = {
      captured: ACTIVITIES.PAYMENT.CAPTURED,
      refunded: ACTIVITIES.PAYMENT.REFUNDED,
      failed: ACTIVITIES.PAYMENT.FAILED,
      markedPaid: ACTIVITIES.PAYMENT.MARKED_PAID,
    };

    const statusMap = {
      captured: STATUS.SUCCESS,
      refunded: STATUS.SUCCESS,
      failed: STATUS.FAILED,
      markedPaid: STATUS.SUCCESS,
    };

    const shortId = order._id?.toString().slice(-8) ?? "unknown";
    const customerName =
      order.user?.name ?? order.shippingAddress?.name ?? "Unknown";
    const amount = order.totalOrderPrice ?? order.totalPrice ?? 0;

    const descriptions = {
      captured: `Payment captured for order #${shortId} — ${amount} DZD (${order.paymentMethodType ?? "N/A"})`,
      refunded: `Payment refunded for order #${shortId} — ${amount} DZD`,
      failed: `Payment failed for order #${shortId} — ${amount} DZD`,
      markedPaid: `Order #${shortId} manually marked as paid — ${amount} DZD`,
    };

    return await ActivityLogger.logActivity({
      type: "payment",
      activity: literals[action],
      user,
      description: descriptions[action],
      status: statusMap[action],
      amount,
      relatedId: order._id,
      relatedModel: "Order",
      metadata: {
        orderShortId: shortId,
        customerName,
        totalAmount: amount,
        paymentMethod: order.paymentMethodType ?? "unknown",
        itemsCount: order.cartItems?.length ?? 0,
        ...extra,
      },
    });
  }

  // ==================== DELIVERY ACTIVITIES ====================
  /**
   * Log a delivery status transition event.
   *
   * @param {string}   action  - One of 'inTransit', 'outForDelivery', 'delivered',
   *                             'failed', 'returned'
   * @param {Object}   order   - Mongoose order document
   * @param {Object}   user    - The admin/operator or system user
   * @param {Object}   [extra] - Additional metadata (e.g. trackingNumber, reason)
   */
  static async logDeliveryActivity(action, order, user, extra = {}) {
    const literals = {
      inTransit: ACTIVITIES.DELIVERY.IN_TRANSIT,
      outForDelivery: ACTIVITIES.DELIVERY.OUT_FOR_DELIVERY,
      delivered: ACTIVITIES.DELIVERY.DELIVERED,
      failed: ACTIVITIES.DELIVERY.FAILED,
      returned: ACTIVITIES.DELIVERY.RETURNED,
    };

    const statusMap = {
      inTransit: STATUS.PENDING,
      outForDelivery: STATUS.PENDING,
      delivered: STATUS.SUCCESS,
      failed: STATUS.FAILED,
      returned: STATUS.FAILED,
    };

    const shortId = order._id?.toString().slice(-8) ?? "unknown";

    const descriptions = {
      inTransit: `Order #${shortId} is now in transit`,
      outForDelivery: `Order #${shortId} is out for delivery`,
      delivered: `Order #${shortId} delivered successfully`,
      failed: `Delivery failed for order #${shortId}${extra.reason ? ` — ${extra.reason}` : ""}`,
      returned: `Order #${shortId} returned${extra.reason ? ` — ${extra.reason}` : ""}`,
    };

    return await ActivityLogger.logActivity({
      type: "delivery",
      activity: literals[action],
      user,
      description: descriptions[action],
      status: statusMap[action],
      amount: order.totalOrderPrice ?? order.totalPrice ?? null,
      relatedId: order._id,
      relatedModel: "Order",
      metadata: {
        orderShortId: shortId,
        customerName:
          order.user?.name ?? order.shippingAddress?.name ?? "Unknown",
        totalAmount: order.totalOrderPrice ?? order.totalPrice ?? 0,
        deliveryStatus: action,
        ...extra,
      },
    });
  }

  // ==================== AUTH ACTIVITIES ====================
  /**
   * Log an authentication event (login success, login failed).
   *
   * @param {string}   action  - One of 'success', 'failed'
   * @param {Object}   target  - The user who attempted to log in (email + role)
   * @param {Object}   user    - Same as target for self-login; admin for admin actions
   * @param {Object}   [extra] - { ipAddress, userAgent }
   */
  static async logAuthActivity(action, target, user, extra = {}) {
    const literals = {
      success: ACTIVITIES.AUTH.LOGIN_SUCCESS,
      failed: ACTIVITIES.AUTH.LOGIN_FAILED,
    };

    const descriptions = {
      success: `Successful login for ${target.email ?? "unknown user"}`,
      failed: `Failed login attempt for ${target.email ?? "unknown user"}`,
    };

    const logEntry = {
      type: "auth",
      activity: literals[action],
      user,
      description: descriptions[action],
      status: action === "success" ? STATUS.SUCCESS : STATUS.FAILED,
      relatedId: target._id ?? target.id ?? user._id,
      relatedModel: "User",
      metadata: {
        targetUserEmail: target.email ?? "unknown",
        targetUserRole: target.role ?? "unknown",
        ...extra,
      },
    };

    return await ActivityLogger.logActivity(logEntry);
  }

  // ==================== STOCK ACTIVITIES ====================

  /** Default threshold below which a product is considered "low stock". */
  static LOW_STOCK_THRESHOLD = 5;

  /**
   * Inspect a quantity change and fire the appropriate stock activity log
   * (LowStock / OutOfStock / Restocked) when warranted.
   *
   * Call this AFTER a stock mutation so that quantityBefore and quantityAfter
   * reflect the actual before/after state.
   *
   * @param {Object}   product        - Mongoose product document (post-mutation)
   * @param {number}   quantityBefore - Stock level before the mutation
   * @param {number}   quantityAfter  - Stock level after the mutation
   * @param {Object}   user           - The actor (admin, customer, or system)
   * @param {Object}   [extra={}]     - Additional metadata to spread
   * @returns {Promise<null|Object>}  - The created activity log, or null if
   *                                    no stock event was triggered / no user
   */
  static async checkAndLogStockEvents(
    product,
    quantityBefore,
    quantityAfter,
    user,
    extra = {}
  ) {
    if (!user) return null;
    const THRESHOLD = ActivityLogger.LOW_STOCK_THRESHOLD;

    // --- Restocked (quantity increased) ---
    if (quantityAfter > quantityBefore) {
      return await ActivityLogger.logStockActivity(
        "restocked",
        product,
        user,
        { quantityBefore, quantityAfter, threshold: THRESHOLD, ...extra }
      );
    }

    // --- Quantity decreased — check thresholds ---
    if (quantityAfter < quantityBefore) {
      if (quantityAfter <= 0) {
        return await ActivityLogger.logStockActivity(
          "outOfStock",
          product,
          user,
          { quantityBefore, quantityAfter, threshold: THRESHOLD, ...extra }
        );
      }
      if (quantityAfter <= THRESHOLD) {
        return await ActivityLogger.logStockActivity(
          "lowStock",
          product,
          user,
          { quantityBefore, quantityAfter, threshold: THRESHOLD, ...extra }
        );
      }
    }

    return null;
  }

  /**
   * Log an inventory / stock event (LowStock, OutOfStock, Restocked).
   *
   * @param {string}   action  - One of 'lowStock', 'outOfStock', 'restocked'
   * @param {Object}   product - Mongoose product document
   * @param {Object}   user    - The admin/operator who triggered the change
   * @param {Object}   [extra] - Must include quantityBefore & quantityAfter
   */
  static async logStockActivity(action, product, user, extra = {}) {
    const literals = {
      lowStock: ACTIVITIES.PRODUCT.LOW_STOCK,
      outOfStock: ACTIVITIES.PRODUCT.OUT_OF_STOCK,
      restocked: ACTIVITIES.PRODUCT.RESTOCKED,
    };

    const descriptions = {
      lowStock: `Low stock alert: "${product.title}" — ${extra.quantityAfter ?? product.quantity} units remaining`,
      outOfStock: `Out of stock: "${product.title}" — 0 units remaining`,
      restocked: `Restocked "${product.title}" — quantity changed from ${extra.quantityBefore ?? "?"} to ${extra.quantityAfter ?? product.quantity}`,
    };

    return await ActivityLogger.logActivity({
      type: "stock",
      activity: literals[action],
      user,
      description: descriptions[action],
      status: STATUS.SUCCESS,
      relatedId: product._id,
      relatedModel: "Product",
      metadata: {
        productTitle: product.title ?? "Unknown Product",
        productCategory:
          product.category?.name ?? product.category?.toString() ?? "Unknown",
        productBrand:
          product.brand?.name ?? product.brand?.toString() ?? "Unknown",
        quantityBefore: extra.quantityBefore ?? null,
        quantityAfter: extra.quantityAfter ?? null,
        threshold: extra.threshold ?? null,
        ...extra,
      },
    });
  }
}

module.exports = ActivityLogger;