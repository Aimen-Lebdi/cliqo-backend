const ActivityLog = require("../models/activityLogModel");
const socketInstance = require("../utils/socketEmitter");
const { computeActivityStats } = require("./activityStats");

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


  // ==================== CART ACTIVITIES ====================
  static async logCartActivity(action, cart, user, additionalData = {}) {
    const activities = {
      update: "Cart Updated",
      clear: "Cart Cleared",
    };

    const descriptions = {
      update: `Cart updated - Items: ${cart.cartItems?.length || 0}, Total: ${cart.totalCartPrice} DZD`,
      clear: `Cart cleared`,
    };

    return await ActivityLogger.logActivity({
      type: "cart",
      activity: activities[action],
      user,
      description: descriptions[action],
      amount: cart.totalCartPrice || null,
      relatedId: cart._id,
      relatedModel: "Cart",
      metadata: {
        cartItemsCount: cart.cartItems?.length || 0,
        totalPrice: cart.totalCartPrice,
        totalAfterDiscount: cart.totalPriceAfterDiscount,
        ...additionalData,
      },
    });
  }

  // ==================== WISHLIST ACTIVITIES ====================
  static async logWishlistActivity(action, wishlist, user, additionalData = {}) {
    const description = `Wishlist updated - ${additionalData.productName}${
      action === "add" ? " added to" : " removed from"
    } wishlist`;

    return await ActivityLogger.logActivity({
      type: "cart",
      activity: "Wishlist Updated",
      user,
      description,
      relatedId: wishlist._id,
      relatedModel: "Wishlist",
      metadata: {
        action: action,
        productId: additionalData.productId,
        productName: additionalData.productName,
        totalItems: additionalData.totalItems,
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
}

module.exports = ActivityLogger;