const mongoose = require("mongoose");

/**
 * Generic key/value settings store (M4).
 * Used for admin-editable dashboard settings such as the low-stock threshold.
 */
const settingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, "Setting key is required"],
      unique: true,
      trim: true,
    },
    value: {
      // Mixed so settings can hold numbers, strings, booleans, objects, etc.
      type: mongoose.Schema.Types.Mixed,
      required: [true, "Setting value is required"],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Setting", settingSchema);
