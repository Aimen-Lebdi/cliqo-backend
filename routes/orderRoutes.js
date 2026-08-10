const express = require("express");
const {
  createCashOrder,
  findAllOrders,
  findSpecificOrder,
  filterOrderForLoggedUser,
  updateOrderToPaid,
  updateOrderToDelivered,
  checkoutSession,
  confirmOrder, // NEW
  shipOrder, // NEW
  cancelOrder, // ADD THIS
  restrictOrderAccess, // M1: ownership guard middleware
  getOrderTracking, // NEW
  simulateDelivery, // NEW (testing only)
  deliveryWebhook,
  confirmCardOrder,
  getOrderBySession,
  downloadInvoice,
  updateOrder, // M2: admin order edit (View/Edit dialog)
} = require("../services/orderServices");

const { updateOrderValidator } = require("../utils/validators/orderValidators");

const authService = require("../services/authServices");

const router = express.Router();

// Webhook endpoint (must be BEFORE auth middleware)
router.post("/delivery/webhook", deliveryWebhook);

// NEW: Get order by Stripe session ID (must be BEFORE /:id route)
router.get(
  "/session/:sessionId",
  authService.protectRoute,
  authService.allowTo("user", "admin"),
  getOrderBySession
);

// Stripe checkout - CHANGE TO POST
router.post(
  "/checkout-session/:cartId",
  authService.protectRoute,
  authService.allowTo("user", "admin"),
  checkoutSession
);

// Create cash order
router.post(
  "/:cartId",
  authService.protectRoute,
  authService.allowTo("user" ,"admin"),
  createCashOrder
);

// Get all orders (admin only — regular users use /myOrders)
router.get(
  "/",
  authService.protectRoute,
  authService.allowTo("admin"),
  findAllOrders
);

// Get all orders for specific user
router.get("/myOrders", authService.protectRoute,
  authService.allowTo("user", "admin"),
  filterOrderForLoggedUser,
  findAllOrders);

// Get specific order (owner or admin only)
router.get(
  "/:id",
  authService.protectRoute,
  authService.allowTo("user", "admin"),
  restrictOrderAccess,
  findSpecificOrder
);

// M2: Admin order edit (View/Edit dialog). Strict whitelist + shape validation
// via updateOrderValidator; transition legality + card-order lock enforced in
// the service. PUT /:id does not collide with /myOrders or /session/:sessionId.
router.put(
  "/:id",
  authService.protectRoute,
  authService.allowTo("admin"),
  updateOrderValidator,
  updateOrder
);

// COD Workflow endpoints (admin only)
router.put(
  "/:id/confirm",
  authService.protectRoute,
  authService.allowTo("admin"),
  confirmOrder
); // Seller confirms order
router.post(
  "/:id/ship",
  authService.protectRoute,
  authService.allowTo("admin"),
  shipOrder
); // Create shipment with delivery agency
router.get(
  "/:id/tracking",
  authService.protectRoute,
  authService.allowTo("user", "admin"),
  restrictOrderAccess,
  getOrderTracking
); // Get tracking info

// Cancel order (owner or admin only)
router.put(
  "/:id/cancel",
  authService.protectRoute,
  authService.allowTo("user", "admin"),
  restrictOrderAccess,
  cancelOrder
);

// Testing endpoint (admin only — mock delivery flow stays usable in prod)
router.post(
  "/:id/simulate-delivery",
  authService.protectRoute,
  authService.allowTo("admin"),
  simulateDelivery
);

router.put(
  "/:id/confirm-card",
  authService.protectRoute,
  authService.allowTo("admin"),
  confirmCardOrder
); // Confirm card payment order

// Payment & delivery status updates (admin)
// router.put("/:id/pay", updateOrderToPaid);
// router.put("/:id/deliver", updateOrderToDelivered);

// Add this route
router.get(
  "/:id/invoice",
  authService.protectRoute,
  authService.allowTo("user", "admin"),
  downloadInvoice
);

module.exports = router;
