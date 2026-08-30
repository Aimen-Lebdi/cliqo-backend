const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = mongoose.Schema(
  {
    name: {
      type: String,
      validate: {
        validator: (v) => typeof v === "string",
        message: "Name must be a string",
      },
      required: [true, "Name is required"],
      trim: true,
    },
    slug: {
      type: String,
      validate: {
        validator: (v) => typeof v === "string",
        message: "Slug must be a string",
      },
      lowercase: true,
    },
    email: {
      type: String,
      validate: {
        validator: (v) =>
          /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(v),
        message: "Please enter a valid email",
      },
      required: [true, "Email is required"],
      unique: [true, "Email must be unique"],
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      select: false,
      validate: {
        validator: (v) => typeof v === "string",
        message: "Password must be a string",
      },
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
    },
    passwordChangedAt: {
      type: Date,
      validate: {
        validator: (v) => v instanceof Date,
        message: "Password changed at must be a date",
      },
    },
    passwordResetCode: {
      type: String,
      validate: {
        validator: (v) => typeof v === "string",
        message: "Password reset code must be a string",
      },
    },
    passwordResetExpires: {
      type: Date,
      validate: {
        validator: (v) => v instanceof Date,
        message: "Password reset expires must be a date",
      },
    },
    passwordResetVerified: {
      type: Boolean,
      validate: {
        validator: (v) => typeof v === "boolean",
        message: "Password reset verified must be a boolean",
      },
      default: false,
    },
    role: {
      type: String,
      validate: {
        validator: (v) => typeof v === "string",
        message: "Role must be a string",
      },
      enum: ["user", "admin"],
      default: "user",
    },
    active: {
      type: Boolean,
      validate: {
        validator: (v) => typeof v === "boolean",
        message: "Active must be a boolean",
      },
      default: true,
    },
    image: String, // Will store full Cloudinary URL
    phone: {
      type: String,
      trim: true,
    },

    // child reference (one to many)
    wishlist: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "Product",
      },
    ],
    addresses: [
      {
        label: {
          type: String,
          required: [true, "Label is required"],
          trim: true,
          maxlength: [30, "Label must be at most 30 characters"],
        },
        wilaya: String,
        dayra: String,
        baladiya: String,
        isDefault: {
          type: Boolean,
          default: false,
        },
      },
    ],
    phones: [
      {
        label: {
          type: String,
          required: [true, "Label is required"],
          trim: true,
          maxlength: [30, "Label must be at most 30 characters"],
        },
        phone: {
          type: String,
          trim: true,
        },
        isDefault: {
          type: Boolean,
          default: false,
        },
      },
    ],
  },
  { timestamps: true }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

const userModel = mongoose.model("User", userSchema);

module.exports = userModel;