const factory = require("./handlersFactory");
const Product = require("../models/productModel");
const { uploadMixOfImages } = require("../middlewares/uploadImageMiddleware");
const expressAsyncHandler = require("express-async-handler");

// Upload to Cloudinary 'products' folder
const uploadProductImages = uploadMixOfImages(
  [
    {
      name: "mainImage",
      maxCount: 1,
    },
    {
      name: "images",
      maxCount: 5,
    },
  ],
  "products"
);

// No need for sharp anymore - Cloudinary handles it!
const processProductImages = expressAsyncHandler(async (req, res, next) => {
  // 1- Process mainImage
  if (req.files.mainImage) {
    // Cloudinary automatically uploads and returns the full URL
    req.body.mainImage = req.files.mainImage[0].path; // Cloudinary URL
  }

  // 2- Process images array
  if (req.files.images) {
    req.body.images = [];
    req.files.images.forEach((img) => {
      // Each image has its Cloudinary URL in .path
      req.body.images.push(img.path);
    });
  }

  next();
});

const createProduct = factory.createOne(Product);
// Search runs against the normalized search fields; the keyword is normalized
// with the same util (normalizeKeyword: true) so both sides match byte-for-byte.
const getAllProducts = factory.getAll(
  Product,
  ["searchName", "searchDescription"],
  undefined,
  { normalizeKeyword: true }
);
const getOneProduct = factory.getOne(Product);
const updateProduct = factory.updateOne(Product);
const deleteProduct = factory.deleteOne(Product);
const deleteManyProducts = factory.deleteMany(Product);

module.exports = {
  uploadProductImages,
  processProductImages,
  createProduct,
  getAllProducts,
  getOneProduct,
  updateProduct,
  deleteProduct,
  deleteManyProducts,
};