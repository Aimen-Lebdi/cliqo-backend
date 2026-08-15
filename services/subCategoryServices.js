const subCategoryModel = require("../models/subCategoryModel");
const factory = require("./handlersFactory");
const expressAsyncHandler = require("express-async-handler");
const { uploadSingleImage } = require("../middlewares/uploadImageMiddleware");

// Upload to Cloudinary 'subcategories' folder
const uploadSubCategoryImage = uploadSingleImage("image", "subcategories");

// No need for sharp anymore - Cloudinary handles it!
const processSubCategoryImage = expressAsyncHandler(async (req, res, next) => {
  if (req.file) {
    // Cloudinary automatically uploads and returns the full URL
    // Store the full URL in the database
    req.body.image = req.file.path; // This is the Cloudinary URL
  }
  next();
});

const fromParamsToBody = (req, res, next) => {
  if (!req.body.category) req.body.category = req.params.categoryId;
  next();
};

const createFilterObj = async (req, res, next) => {
  let filterObject = {};
  if (req.params.categoryId) {
    filterObject = { category: req.params.categoryId };
  }
  req.filterObj = filterObject;
  next();
};

const createSubCategory = factory.createOne(subCategoryModel);
const getAllSubCategories = factory.getAll(subCategoryModel, ["name"], "category");
const getOneSubCategory = factory.getOne(subCategoryModel);
const updateSubCategory = factory.updateOne(subCategoryModel);
const deleteSubCategory = factory.deleteOne(subCategoryModel);
const deleteManySubCategories = factory.deleteMany(subCategoryModel);

module.exports = {
  getAllSubCategories,
  getOneSubCategory,
  createSubCategory,
  updateSubCategory,
  deleteSubCategory,
  deleteManySubCategories,
  uploadSubCategoryImage,
  processSubCategoryImage,
  fromParamsToBody,
  createFilterObj,
};