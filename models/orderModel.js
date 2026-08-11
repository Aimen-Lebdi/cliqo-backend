const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "Order must be belong to user"],
    },
    cartItems: [
      {
        product: {
          type: mongoose.Schema.ObjectId,
          ref: "Product",
        },
        quantity: Number,
        color: String,
        price: Number,
      },
    ],

    taxPrice: {
      type: Number,
      default: 0,
    },
    shippingAddress: {
      wilaya: String,
      dayra: String,
      baladiya: String,
      phone: String,
    },
    shippingPrice: {
      type: Number,
      default: 0,
    },
    totalOrderPrice: {
      type: Number,
    },
    paymentMethodType: {
      type: String,
      enum: ["card", "cash"],
      default: "cash",
    },
    stripeSessionId: {
      type: String,
      unique: true,
      sparse: true,
    },
    // M2: Stripe PaymentIntent id used to match webhook events (charge.succeeded /
    // charge.refunded) to the correct order instead of matching by total price.
    stripePaymentIntentId: {
      type: String,
      index: true,
    },
    deliveryStatus: {
      type: String,
      enum: [
        "pending", // Order created, waiting confirmation
        "confirmed", // Seller confirmed
        "shipped", // Handed to delivery agency
        "in_transit", // Being transported
        "out_for_delivery", // Delivery agent on the way
        "delivered", // Customer received & paid
        "completed", // Payment settled with seller
        "failed", // Delivery failed
        "returned", // Returned to seller
        "cancelled", // Order cancelled
      ],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: [
        "pending", // Waiting for payment
        "authorized", // Card authorized (funds on hold)
        "failed", // Payment failed
        "cancelled", // Payment cancelled (cash order at a terminal dead-end)
        "confirmed", // Payment confirmed by gateway
        "refunded", // Fully refunded
        "partially_refunded", // Partially refunded
        "completed", // Settled to seller account
      ],
      default: "pending",
    },
    trackingNumber: {
      type: String,
      trim: true,
    },

    // COD specific fields
    codAmount: {
      type: Number,
      default: 0,
    },

    // Status history for tracking
    statusHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String,
        updatedBy: String, // 'seller', 'delivery_agency', 'system'
      },
    ],

    // Delivery agency info
    deliveryAgency: {
      name: String,
      apiResponse: Object, // Store raw API response for debugging
    },
    isPaid: {
      type: Boolean,
      default: false,
    },
    paidAt: Date,
    isDelivered: {
      type: Boolean,
      default: false,
    },
    deliveredAt: Date,
  },
  { timestamps: true }
);

orderSchema.pre(/^find/, function (next) {
  this.populate({
    path: "user",
    select: "name image email phone",
  }).populate({
    path: "cartItems.product",
    select: "name mainImage",
  });

  next();
});

const orderModel = mongoose.model("Order", orderSchema);

module.exports = orderModel;
