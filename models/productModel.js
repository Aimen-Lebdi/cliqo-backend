const mongoose = require("mongoose");

const { normalizeSearchText } = require("../utils/searchNormalize");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      validate: {
        validator: (v) => typeof v === "string",
        message: "Name must be a string",
      },
      required: [true, "Product must have a name"],
      trim: true,
    },
    slug: {
      type: String,
      validate: {
        validator: (v) => typeof v === "string",
        message: "Slug must be a string",
      },
      required: [true, "Product must have a slug"],
      lowercase: true,
    },
    description: {
      type: String,
      validate: {
        validator: (v) => typeof v === "string",
        message: "Description must be a string",
      },
      required: [true, "Product must have a description"],
    },
    price: {
      type: Number,
      validate: {
        validator: (v) => typeof v === "number" && !isNaN(v),
        message: "Price must be a number",
      },
      required: [true, "Product must have a price"],
      trim: true,
    },
    mainImage: {
      type: String,
      validate: {
        validator: (v) => typeof v === "string",
        message: "Main image must be a string",
      },
      required: [true, "Product must have a main image"],
    },
    images: [String], // Will store full Cloudinary URLs
    colors: [String],
    quantity: {
      type: Number,
      validate: {
        validator: (v) => typeof v === "number" && !isNaN(v),
        message: "Quantity must be a number",
      },
      required: [true, "Product must have a quantity"],
    },
    sold: {
      type: Number,
      validate: {
        validator: (v) => typeof v === "number" && !isNaN(v),
        message: "Sold must be a number",
      },
      default: 0,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      validate: {
        validator: (v) => mongoose.Types.ObjectId.isValid(v),
        message: "Category must be a valid ObjectId",
      },
      ref: "Category",
      required: [true, "Product must belong to a category"],
    },
    subCategory: {
      type: mongoose.Schema.Types.ObjectId,
      validate: {
        validator: (v) =>
          v === null || v === undefined || mongoose.Types.ObjectId.isValid(v),
        message: "Subcategory must be a valid ObjectId",
      },
      ref: "Subcategory",
      default: null,
    },

    brand: {
      type: mongoose.Schema.Types.ObjectId,
      validate: {
        validator: (v) =>
          v === null || v === undefined || mongoose.Types.ObjectId.isValid(v),
        message: "Brand must be a valid ObjectId",
      },
      ref: "Brand",
      default: null,
    },

    // Normalized search fields (diacritic-stripped + Arabic-normalized +
    // lowercased). Used for keyword search; kept hidden from API responses.
    searchName: {
      type: String,
      select: false,
      index: true,
    },
    searchDescription: {
      type: String,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);



productSchema.pre(/^find/, function () {
  this.populate({
    path: "category",
    select: "name _id",
  });
  this.populate({
    path: "subCategory",
    select: "name _id",
  });
  this.populate({
    path: "brand",
    select: "name _id",
  });
});

// Populate normalized search fields whenever a product is saved
productSchema.pre("save", function () {
  this.searchName = normalizeSearchText(this.name);
  this.searchDescription = normalizeSearchText(this.description);
});

// Middleware to update category product count when a product is saved
productSchema.post("save", async function (doc) {
  // Update category product count
  if (doc.category) {
    const Category = mongoose.model("Category");
    await Category.updateProductCount(doc.category);
  }

  // Update subcategory product count
  if (doc.subCategory) {
    const Subcategory = mongoose.model("Subcategory");
    await Subcategory.updateProductCount(doc.subCategory);
  }

  // Update brand product count
  if (doc.brand) {
    const Brand = mongoose.model("Brand");
    await Brand.updateProductCount(doc.brand);
  }
});

// Middleware to update category product count when a product is removed
productSchema.post("findOneAndDelete", async function (doc) {
  if (doc) {
    if (doc.category) {
      const Category = mongoose.model("Category");
      await Category.updateProductCount(doc.category);
    }
    if (doc.subCategory) {
      const Subcategory = mongoose.model("Subcategory");
      await Subcategory.updateProductCount(doc.subCategory);
    }
    if (doc.brand) {
      const Brand = mongoose.model("Brand");
      await Brand.updateProductCount(doc.brand);
    }
  }
});

// Helper: extract a string ID from a field that may be a raw ObjectId
// or a populated sub-document { _id: ObjectId, name: '...' }
const toIdString = (ref) => {
  if (!ref) return null;
  if (typeof ref === "object" && ref._id) return ref._id.toString();
  return ref.toString();
};

// Helper: extract a string field value from a findOneAndUpdate update object.
// Handles flat updates ({ name: "..." }), $set, and $setOnInsert forms.
const textFromUpdate = (update, field) => {
  if (!update) return undefined;
  if (typeof update[field] === "string") return update[field];
  if (update.$set && typeof update.$set[field] === "string")
    return update.$set[field];
  if (update.$setOnInsert && typeof update.$setOnInsert[field] === "string")
    return update.$setOnInsert[field];
  return undefined;
};

// Middleware to update product counts when multiple products are deleted at once
productSchema.pre("deleteMany", async function () {
  // Fetch the products that will be deleted to capture their parent references
  // Note: the pre(/^find/) middleware populates category/subCategory/brand,
  // so each field may be a populated object rather than a raw ObjectId.
  const products = await this.model.find(this.getQuery()).select("category subCategory brand");

  // Store unique parent IDs for the post hook to recalculate
  this._categoriesToUpdate = [...new Set(products.map((p) => toIdString(p.category)).filter(Boolean))];
  this._subcategoriesToUpdate = [...new Set(products.map((p) => toIdString(p.subCategory)).filter(Boolean))];
  this._brandsToUpdate = [...new Set(products.map((p) => toIdString(p.brand)).filter(Boolean))];
});

productSchema.post("deleteMany", async function () {
  const Category = mongoose.model("Category");
  const Subcategory = mongoose.model("Subcategory");
  const Brand = mongoose.model("Brand");

  // Recalculate product counts for all affected parents
  for (const catId of this._categoriesToUpdate || []) {
    await Category.updateProductCount(catId);
  }
  for (const subId of this._subcategoriesToUpdate || []) {
    await Subcategory.updateProductCount(subId);
  }
  for (const brandId of this._brandsToUpdate || []) {
    await Brand.updateProductCount(brandId);
  }
});

// Middleware to handle category change during update
productSchema.pre("findOneAndUpdate", async function () {
  // Store the original document to compare categories later
  this._originalProduct = await this.model.findOne(this.getQuery());

  // Keep normalized search fields in sync when name/description change.
  // findOneAndUpdate does NOT fire pre("save"), so recompute here and merge
  // into the update via $set.
  const update = this.getUpdate() || {};
  const name = textFromUpdate(update, "name");
  const description = textFromUpdate(update, "description");

  if (typeof name === "string") {
    this.set({ searchName: normalizeSearchText(name) });
  }
  if (typeof description === "string") {
    this.set({ searchDescription: normalizeSearchText(description) });
  }
});

productSchema.post("findOneAndUpdate", async function (doc) {
  if (doc) {
    const Category = mongoose.model("Category");
    const Subcategory = mongoose.model("Subcategory");
    const Brand = mongoose.model("Brand");
    const originalProduct = this._originalProduct;

    if (originalProduct) {
      // Update category counts if category changed
      if (
        originalProduct.category &&
        originalProduct.category.toString() !==
          (doc.category ? doc.category.toString() : "")
      ) {
        await Category.updateProductCount(originalProduct.category);
      }
      if (doc.category) {
        await Category.updateProductCount(doc.category);
      }

      // Update subcategory counts if subcategory changed
      if (
        originalProduct.subCategory &&
        originalProduct.subCategory.toString() !==
          (doc.subCategory ? doc.subCategory.toString() : "")
      ) {
        await Subcategory.updateProductCount(originalProduct.subCategory);
      }
      if (doc.subCategory) {
        await Subcategory.updateProductCount(doc.subCategory);
      }

      // Update brand counts if brand changed
      if (
        originalProduct.brand &&
        originalProduct.brand.toString() !==
          (doc.brand ? doc.brand.toString() : "")
      ) {
        await Brand.updateProductCount(originalProduct.brand);
      }
      if (doc.brand) {
        await Brand.updateProductCount(doc.brand);
      }
    } else {
      // If no original product, just update current counts
      if (doc.category) await Category.updateProductCount(doc.category);
      if (doc.subCategory)
        await Subcategory.updateProductCount(doc.subCategory);
      if (doc.brand) await Brand.updateProductCount(doc.brand);
    }
  }
});

// Remove all the setImageURL logic - not needed with Cloudinary!
// Cloudinary returns full URLs, so we just store them directly

const productModel = mongoose.model("Product", productSchema);

module.exports = productModel;