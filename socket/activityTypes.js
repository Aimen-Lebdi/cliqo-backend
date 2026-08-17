/**
 * Canonical activity vocabulary — single source of truth for every activity
 * literal, description template, and metadata shape.
 *
 * WHY: activityLogger and other callers used to hardcode the same strings in
 * many places, which led to drift (e.g. "Payment Captured" vs "Payment
 * captured"). This module centralises them so every caller references the same
 * constant.
 *
 * USAGE:
 *   const { ACTIVITIES, buildOrderMeta } = require('./activityTypes');
 *   activity: ACTIVITIES.PAYMENT.CAPTURED
 *   metadata: buildOrderMeta(order, extra)
 */

// ---------------------------------------------------------------------------
// 1. Activity literals grouped by domain type
// ---------------------------------------------------------------------------

const ACTIVITIES = Object.freeze({
  // ---- Orders ----
  ORDER: Object.freeze({
    PLACED: "New Order Placed",
    CONFIRMED: "Order Confirmed",
    SHIPPED: "Order Shipped",
    DELIVERED: "Order Delivered",
    CANCELLED: "Order Cancelled",
    UPDATED: "Order Updated",
  }),

  // ---- Payments ----
  PAYMENT: Object.freeze({
    CAPTURED: "Payment Captured",
    REFUNDED: "Payment Refunded",
    FAILED: "Payment Failed",
    MARKED_PAID: "Payment Marked Paid",
  }),

  // ---- Delivery ----
  DELIVERY: Object.freeze({
    IN_TRANSIT: "Delivery In Transit",
    OUT_FOR_DELIVERY: "Delivery Out For Delivery",
    DELIVERED: "Delivery Delivered",
    FAILED: "Delivery Failed",
    RETURNED: "Delivery Returned",
  }),

  // ---- Products & stock ----
  PRODUCT: Object.freeze({
    CREATED: "Product Created",
    UPDATED: "Product Updated",
    DELETED: "Product Deleted",
    BULK_DELETED: "Products Bulk Deleted",
    LOW_STOCK: "Low Stock",
    OUT_OF_STOCK: "Out of Stock",
    RESTOCKED: "Restocked",
  }),

  // ---- Users ----
  USER: Object.freeze({
    REGISTERED: "User Registered",
    UPDATED: "User Updated",
    DEACTIVATED: "User Deactivated",
    ACTIVATED: "User Activated",
    BANNED: "User Banned",
    UNBANNED: "User Unbanned",
    PASSWORD_CHANGED: "Password Changed",
    PASSWORD_RESET_REQUESTED: "Password Reset Requested",
    BULK_ACTIVATED: "Users Activated",
    BULK_DEACTIVATED: "Users Deactivated",
  }),

  // ---- Auth ----
  AUTH: Object.freeze({
    LOGIN_SUCCESS: "Login Success",
    LOGIN_FAILED: "Login Failed",
  }),

  // ---- Category ----
  CATEGORY: Object.freeze({
    CREATED: "Category Created",
    UPDATED: "Category Updated",
    DELETED: "Category Deleted",
    BULK_DELETED: "Categories Bulk Deleted",
  }),

  // ---- Brand ----
  BRAND: Object.freeze({
    CREATED: "Brand Created",
    UPDATED: "Brand Updated",
    DELETED: "Brand Deleted",
    BULK_DELETED: "Brands Bulk Deleted",
  }),

  // ---- SubCategory ----
  SUBCATEGORY: Object.freeze({
    CREATED: "SubCategory Created",
    UPDATED: "SubCategory Updated",
    DELETED: "SubCategory Deleted",
    BULK_DELETED: "SubCategories Bulk Deleted",
  }),

  // ---- Cart (legacy — kept for backward compatibility) ----
  CART: Object.freeze({
    UPDATED: "Cart Updated",
    CLEARED: "Cart Cleared",
  }),
});

// ---------------------------------------------------------------------------
// 2. Status constants
// ---------------------------------------------------------------------------

const STATUS = Object.freeze({
  SUCCESS: "success",
  FAILED: "failed",
  PENDING: "pending",
});

// ---------------------------------------------------------------------------
// 3. Related-model mapping (type enum → allowed relatedModel values)
// ---------------------------------------------------------------------------

const RELATED_MODEL_MAP = Object.freeze({
  order: "Order",
  payment: "Order", // payment events are tied to an order
  delivery: "Order",
  product: "Product",
  category: "Category",
  brand: "Brand",
  subcategory: "SubCategory",
  user: "User",
  auth: "User", // login events are tied to a user
  stock: "Product", // stock events are tied to a product
  cart: "Cart",
  wishlist: "Wishlist",
});

// ---------------------------------------------------------------------------
// 4. Metadata builders — one per domain to keep shapes consistent
// ---------------------------------------------------------------------------

/**
 * Build metadata for order / payment / delivery events.
 * All money-related events share this shape so the frontend can render them
 * uniformly.
 *
 * @param {Object} order          - Mongoose order document
 * @param {Object} [extra={}]     - Additional key/value pairs to spread in
 * @returns {Object}              - Normalised metadata object
 */
function buildOrderMeta(order, extra = {}) {
  return {
    orderShortId: order._id?.toString().slice(-8) ?? "unknown",
    customerName: order.user?.name ?? order.shippingAddress?.name ?? "Unknown",
    totalAmount: order.totalOrderPrice ?? order.totalPrice ?? 0,
    paymentMethod: order.paymentMethodType ?? "unknown",
    itemsCount: order.cartItems?.length ?? 0,
    ...extra,
  };
}

/**
 * Build metadata for product / stock events.
 *
 * @param {Object} product            - Mongoose product document
 * @param {Object} [extra={}]         - Additional key/value pairs to spread in
 * @returns {Object}                  - Normalised metadata object
 */
function buildProductMeta(product, extra = {}) {
  return {
    productTitle: product.title ?? "Unknown Product",
    productCategory:
      product.category?.name ?? product.category?.toString() ?? "Unknown",
    productBrand:
      product.brand?.name ?? product.brand?.toString() ?? "Unknown",
    ...extra,
  };
}

/**
 * Build metadata for stock-related events (LowStock / OutOfStock / Restocked).
 *
 * @param {Object} product            - Mongoose product document
 * @param {Object} [extra={}]         - Must include quantityBefore/quantityAfter
 * @returns {Object}                  - Normalised metadata object
 */
function buildStockMeta(product, extra = {}) {
  return {
    ...buildProductMeta(product),
    quantityBefore: extra.quantityBefore ?? null,
    quantityAfter: extra.quantityAfter ?? null,
    threshold: extra.threshold ?? null,
    ...extra,
  };
}

/**
 * Build metadata for auth events (login success / failure).
 *
 * @param {Object} user               - Mongoose user document (or email/role if
 *                                      the full doc isn't available yet)
 * @param {Object} [extra={}]         - Usually { ipAddress, userAgent }
 * @returns {Object}                  - Normalised metadata object
 */
function buildAuthMeta(user, extra = {}) {
  return {
    targetUserEmail: user.email ?? "unknown",
    targetUserRole: user.role ?? "unknown",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 5. Convenience: flat look-ups for quick "is this a money event?" checks
// ---------------------------------------------------------------------------

const MONEY_TYPES = new Set(["order", "payment"]);
const SECURITY_TYPES = new Set(["auth", "user"]);
const INVENTORY_TYPES = new Set(["product", "stock"]);

module.exports = {
  ACTIVITIES,
  STATUS,
  RELATED_MODEL_MAP,
  MONEY_TYPES,
  SECURITY_TYPES,
  INVENTORY_TYPES,
  buildOrderMeta,
  buildProductMeta,
  buildStockMeta,
  buildAuthMeta,
};
