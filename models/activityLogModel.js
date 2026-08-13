const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: [true, "Activity type is required"],
      enum: [
        "order",
        "product",
        "category",
        "brand",
        "user",
        "subcategory",
        "cart",
      ],
    },
    activity: {
      // Display-only free text. No enum on purpose: bulk operations produce dynamic
      // strings (e.g. `${model}s Bulk Deleted`) and order/user lifecycle actions add
      // new literals over time. Enum validation here was silently dropping valid logs.
      type: String,
      required: [true, "Activity name is required"],
    },
    user: {
      name: {
        type: String,
        required: [true, "User name is required"],
      },
      id: {
        type: mongoose.Schema.ObjectId,
        ref: "User",
        required: [true, "User ID is required"],
      },
      role: {
        type: String,
        enum: ["admin", "user"],
        required: [true, "User role is required"],
      },
    },
    description: {
      type: String,
      required: [true, "Activity description is required"],
    },
    status: {
      type: String,
      enum: ["success", "failed", "pending"],
      default: "success",
    },
    amount: {
      type: Number,
      default: null, // Only for order-related activities
    },
    relatedId: {
      type: mongoose.Schema.ObjectId,
      required: [true, "Related document ID is required"],
    },
    relatedModel: {
      type: String,
      required: [true, "Related model name is required"],
      enum: [
        "Order",
        "Product",
        "Category",
        "Brand",
        "User",
        "SubCategory",
        "Cart",
        "Wishlist",
      ],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed, // For storing additional data
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ type: 1, createdAt: -1 });
activityLogSchema.index({ "user.id": 1, createdAt: -1 });

const ActivityLogModel = mongoose.model("ActivityLog", activityLogSchema);

module.exports = ActivityLogModel;
