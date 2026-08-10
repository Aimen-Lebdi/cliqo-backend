const { checkSchema } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");
const orderModel = require("../../models/orderModel");
const { ORDER_STATUSES } = require("../orderStatusTransitions");

// Whitelist of body keys accepted by PUT /api/v1/orders/:id. Any key outside
// this list is rejected with 400 (strict unknown-key rejection).
const ALLOWED_UPDATE_KEYS = [
  "deliveryStatus",
  "statusNote",
  "shippingAddress",
  "cartItems",
  "shippingPrice",
  "trackingNumber",
];

// Admin-only update validator for the order edit dialog. Mirrors the
// categoryValidators.js pattern (checkSchema + validatorMiddleware). Transition
// legality (isAllowedTransition) is enforced in the service (M2), not here —
// this layer only validates shape/enum/format.
const updateOrderValidator = [
  checkSchema({
    id: {
      notEmpty: {
        errorMessage: "Order ID is required",
      },
      isMongoId: {
        errorMessage: "Invalid Order ID",
      },
      custom: {
        options: async (val) => {
          const existingOrder = await orderModel.findById(val);
          if (!existingOrder) {
            throw new Error("Order does not exist");
          }
        },
      },
    },
    deliveryStatus: {
      optional: true,
      isIn: {
        options: [ORDER_STATUSES],
        errorMessage: "Invalid delivery status",
      },
    },
    statusNote: {
      optional: true,
      isString: {
        errorMessage: "statusNote must be a string",
      },
      trim: true,
    },
    shippingAddress: {
      optional: true,
      isObject: {
        errorMessage: "shippingAddress must be an object",
      },
    },
    "shippingAddress.wilaya": {
      optional: true,
      isString: {
        errorMessage: "Wilaya must be a string",
      },
      notEmpty: {
        errorMessage: "Wilaya must not be empty",
      },
      trim: true,
    },
    "shippingAddress.dayra": {
      optional: true,
      isString: {
        errorMessage: "Dayra must be a string",
      },
      notEmpty: {
        errorMessage: "Dayra must not be empty",
      },
      trim: true,
    },
    "shippingAddress.baladiya": {
      optional: true,
      isString: {
        errorMessage: "Baladiya must be a string",
      },
      notEmpty: {
        errorMessage: "Baladiya must not be empty",
      },
      trim: true,
    },
    // Aligned with existing ar-DZ digit rules (see phoneValidators.js).
    "shippingAddress.phone": {
      optional: true,
      isMobilePhone: {
        options: ["ar-DZ"],
        errorMessage: "Invalid phone number format",
      },
      trim: true,
    },
    cartItems: {
      optional: true,
      isArray: {
        errorMessage: "cartItems must be an array",
      },
    },
    "cartItems.*._id": {
      optional: true,
      isMongoId: {
        errorMessage: "Invalid product ID in cartItems",
      },
    },
    "cartItems.*.quantity": {
      optional: true,
      isInt: {
        options: { min: 1 },
        errorMessage: "Quantity must be a positive integer",
      },
      toInt: true,
    },
    "cartItems.*.color": {
      optional: true,
      isString: {
        errorMessage: "Color must be a string",
      },
      trim: true,
    },
    shippingPrice: {
      optional: true,
      isFloat: {
        options: { min: 0 },
        errorMessage: "shippingPrice must be a number >= 0",
      },
      toFloat: true,
    },
    trackingNumber: {
      optional: true,
      isString: {
        errorMessage: "trackingNumber must be a string",
      },
      trim: true,
    },
  }),
  // Unknown-key rejection: this endpoint is a strict whitelist.
  (req, res, next) => {
    const unknownKeys = Object.keys(req.body).filter(
      (key) => !ALLOWED_UPDATE_KEYS.includes(key)
    );
    if (unknownKeys.length > 0) {
      return res.status(400).json({
        errors: [
          {
            msg: `Unknown fields are not allowed: ${unknownKeys.join(", ")}`,
          },
        ],
      });
    }
    next();
  },
  validatorMiddleware,
];

module.exports = { updateOrderValidator };
