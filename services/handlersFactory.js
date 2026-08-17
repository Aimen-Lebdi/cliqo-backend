const expressAsyncHandler = require("express-async-handler");
const endpointError = require("../utils/endpointError");
const ApiFeatures = require("../utils/apiFeatures");
const ActivityLogger = require("../socket/activityLogger");
const { deleteImageFromCloudinary } = require("../config/cloudinary");

// Maps model names → which fields hold Cloudinary image URLs
const IMAGE_FIELDS = {
  Category:  { image: 'string' },
  Brand:     { image: 'string' },
  SubCategory: { image: 'string' },
  User:      { image: 'string' },
  Product:   { mainImage: 'string', images: 'array' },
};

/**
 * Extract all image URLs from a document based on IMAGE_FIELDS config.
 */
const extractImageUrls = (doc) => {
  const modelConfig = IMAGE_FIELDS[doc.constructor.modelName] || IMAGE_FIELDS[doc.model?.modelName];
  if (!modelConfig) return [];

  const urls = [];
  for (const [field, type] of Object.entries(modelConfig)) {
    const value = doc[field];
    if (!value) continue;
    if (type === 'array' && Array.isArray(value)) {
      urls.push(...value.filter(Boolean));
    } else if (type === 'string' && typeof value === 'string') {
      urls.push(value);
    }
  }
  return urls;
};

/**
 * Delete all Cloudinary images for a list of documents (fire-and-forget).
 */
const cleanupDocumentImages = (docs) => {
  const urls = docs.flatMap(extractImageUrls);
  if (urls.length > 0) {
    Promise.all(urls.map(deleteImageFromCloudinary)).catch(() => {});
  }
};

// Activity configuration for different models
const ACTIVITY_CONFIG = {
  Category: {
    modelType: "category",
    nameField: "name",
    methods: {
      create: "logCategoryActivity",
      update: "logCategoryActivity",
      delete: "logCategoryActivity",
    },
  },
  Product: {
    modelType: "product",
    nameField: "title",
    methods: {
      create: "logProductActivity",
      update: "logProductActivity",
      delete: "logProductActivity",
    },
  },
  User: {
    modelType: "user",
    nameField: "name",
    methods: {
      create: "logUserActivity",
      update: "logUserActivity",
      delete: "logUserActivity",
    },
  },
  Order: {
    modelType: "order",
    nameField: "_id",
    methods: {
      create: "logOrderActivity",
      update: "logOrderActivity",
      delete: "logOrderActivity",
    },
  },
  Brand: {
    modelType: "brand",
    nameField: "name",
    methods: {
      create: "logBrandActivity",
      update: "logBrandActivity",
      delete: "logBrandActivity",
    },
  },
  SubCategory: {
    modelType: "subcategory",
    nameField: "name",
    methods: {
      create: "logSubCategoryActivity",
      update: "logSubCategoryActivity",
      delete: "logSubCategoryActivity",
    },
  },
  // M6: Cart removed — cart routes don't use the factory handlers, so this
  // config was dead code that could never trigger.
};

// Helper function to get activity config
const getActivityConfig = (Model) => {
  return ACTIVITY_CONFIG[Model.modelName] || null;
};

// Helper function to detect changes between original and updated documents
const detectChanges = (original, updated, config) => {
  const changes = [];
  const nameField = config.nameField;

  // Check name/title field changes
  if (original[nameField] !== updated[nameField]) {
    changes.push(
      `${nameField} changed from "${original[nameField]}" to "${updated[nameField]}"`
    );
  }

  // Check image changes (common field)
  if (original.image !== updated.image && updated.image) {
    changes.push("image updated");
  }

  // Check price changes (for products)
  if (
    original.price !== undefined &&
    original.price !== updated.price
  ) {
    changes.push(
      `price changed from ${original.price} to ${updated.price} DZD`
    );
  }

  // Check quantity changes (for products)
  if (
    original.quantity !== undefined &&
    original.quantity !== updated.quantity
  ) {
    changes.push(
      `quantity changed from ${original.quantity} to ${updated.quantity}`
    );
  }

  // Check status changes (for orders)
  if (original.status !== undefined && original.status !== updated.status) {
    changes.push(
      `status changed from "${original.status}" to "${updated.status}"`
    );
  }

  // Check delivery status (for orders)
  if (
    original.deliveryStatus !== undefined &&
    original.deliveryStatus !== updated.deliveryStatus
  ) {
    changes.push(
      `delivery status changed from "${original.deliveryStatus}" to "${updated.deliveryStatus}"`
    );
  }

  // Check active status (for users)
  if (original.active !== undefined && original.active !== updated.active) {
    changes.push(
      `account status changed from "${original.active ? "active" : "inactive"}" to "${
        updated.active ? "active" : "inactive"
      }"`
    );
  }

  // Check role changes (for users)
  if (original.role !== undefined && original.role !== updated.role) {
    changes.push(`user role changed from "${original.role}" to "${updated.role}"`);
  }

  return changes;
};

exports.createOne = (Model) =>
  expressAsyncHandler(async (req, res) => {
    const newDocument = await Model.create(req.body);

    // Log activity if config exists and user is available
    const config = getActivityConfig(Model);
    if (config && req.user) {
      const logMethod = ActivityLogger[config.methods.create];
      if (logMethod) {
        await logMethod("create", newDocument, req.user);
      }
    }

    res.status(201).json(newDocument);
  });

exports.getAll = (Model, searchFields = [], populationOpt, searchOptions) =>
  expressAsyncHandler(async (req, res, next) => {
    let filter;
    if (req.filterObj) {
      filter = req.filterObj;
    }

    const apiFeatures = new ApiFeatures(Model.find(filter), req.query);

    let query = apiFeatures
      .filter()
      .search(searchFields, searchOptions)
      .sort()
      .limitFields();

    const documentsCounts = await query.mongooseQuery.clone().countDocuments();

    query = query.paginate(documentsCounts);

    if (populationOpt) {
      query.mongooseQuery = query.mongooseQuery.populate(populationOpt);
    }

    const documents = await query.mongooseQuery;

    if (documents.length === 0) {
      return res.status(200).json({
        result: 0,
        pagination: {
          currentPage: 1,
          limit: parseInt(req.query.limit) || 10,
          numberOfPages: 0,
          totalResults: 0,
        },
        documents: [],
      });
    }

    res.status(200).json({
      result: documentsCounts,
      pagination: apiFeatures.pagination,
      documents,
    });
  });

exports.getOne = (Model, populationOpt) =>
  expressAsyncHandler(async (req, res, next) => {
    const _id = req.params.id;

    let query = Model.findById(_id);
    if (populationOpt) {
      query = query.populate(populationOpt);
    }

    const document = await query;

    if (!document) {
      return next(
        new endpointError(
          `there is no ${Model.modelName} with this ID format`,
          404
        )
      );
    }
    res.status(200).json(document);
  });

exports.updateOne = (Model) =>
  expressAsyncHandler(async (req, res, next) => {
    const documentId = req.params.id;

    // Get activity config
    const config = getActivityConfig(Model);
    let originalDocument = null;

    // Get original document if activity logging is enabled
    if (config && req.user) {
      originalDocument = await Model.findById(documentId);
      if (!originalDocument) {
        return next(
          new endpointError(
            `there is no ${Model.modelName} with this ID format`,
            404
          )
        );
      }
    }

    // Update the document
    const updatedDocument = await Model.findByIdAndUpdate(
      documentId,
      req.body,
      { new: true }
    );

    if (!updatedDocument) {
      return next(
        new endpointError(
          `there is no ${Model.modelName} with this ID format`,
          404
        )
      );
    }

    // Log activity if config exists and user is available
    // M6: Skip logging when detectChanges finds no real change (prevents
    // noisy "general update" rows from no-op PATCH requests).
    if (config && req.user && originalDocument) {
      const logMethod = ActivityLogger[config.methods.update];
      if (logMethod) {
        const changes = detectChanges(originalDocument, updatedDocument, config);

        if (changes.length > 0) {
          const additionalData = {
            changes: changes.join(", "),
            originalData: {
              [config.nameField]: originalDocument[config.nameField],
              ...(originalDocument.image && {
                image: originalDocument.image,
              }),
              ...(originalDocument.price && { price: originalDocument.price }),
              ...(originalDocument.quantity && {
                quantity: originalDocument.quantity,
              }),
              ...(originalDocument.status && { status: originalDocument.status }),
              ...(originalDocument.deliveryStatus && {
                deliveryStatus: originalDocument.deliveryStatus,
              }),
            },
          };

          await logMethod("update", updatedDocument, req.user, additionalData);
        }
      }
    }

    // M5: When a Product's quantity is increased via generic update, log a
    // Restocked activity so the dashboard shows inventory changes.
    if (
      Model.modelName === "Product" &&
      req.user &&
      originalDocument &&
      originalDocument.quantity !== undefined &&
      updatedDocument.quantity > originalDocument.quantity
    ) {
      ActivityLogger.checkAndLogStockEvents(
        updatedDocument,
        originalDocument.quantity,
        updatedDocument.quantity,
        req.user,
        { source: "product_update" }
      ).catch(() => {}); // fire-and-forget
    }

    res.status(200).json({ data: updatedDocument });
  });

exports.deleteOne = (Model) =>
  expressAsyncHandler(async (req, res, next) => {
    const documentId = req.params.id;

    // Get activity config
    const config = getActivityConfig(Model);

    // Always fetch document before deletion (for image cleanup + activity logging)
    const documentToDelete = await Model.findById(documentId);
    if (!documentToDelete) {
      return next(
        new endpointError(
          `there is no ${Model.modelName} with this ID format`,
          404
        )
      );
    }

    // Delete the document
    await Model.findByIdAndDelete(documentId);

    // Cleanup Cloudinary images (fire-and-forget)
    cleanupDocumentImages([documentToDelete]);

    // Log activity if config exists and user is available
    if (config && req.user) {
      const logMethod = ActivityLogger[config.methods.delete];
      if (logMethod) {
        await logMethod("delete", documentToDelete, req.user);
      }
    }

    res.status(204).send();
  });

exports.deleteMany = (Model) =>
  expressAsyncHandler(async (req, res, next) => {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return next(new endpointError("IDs array is required", 400));
    }

    // Get activity config
    const config = getActivityConfig(Model);

    // Always fetch documents before deletion (for image cleanup + activity logging)
    const documentsToDelete = await Model.find({ _id: { $in: ids } });

    // Delete documents
    const deletedDocuments = await Model.deleteMany({
      _id: { $in: ids },
    });

    if (!deletedDocuments || deletedDocuments.deletedCount === 0) {
      return next(
        new endpointError(`No ${Model.modelName} were deleted`, 404)
      );
    }

    // Cleanup Cloudinary images (fire-and-forget)
    cleanupDocumentImages(documentsToDelete);

    // Log bulk delete activity
    if (config && req.user && documentsToDelete.length > 0) {
      // Special handling for bulk operations
      if (Model.modelName === "Product") {
        await ActivityLogger.logBulkDeleteActivity(
          "Product",
          deletedDocuments.deletedCount,
          ids,
          req.user
        );
      } else if (Model.modelName === "Category") {
        await ActivityLogger.logBulkDeleteActivity(
          "Category",
          deletedDocuments.deletedCount,
          ids,
          req.user
        );
      } else if (Model.modelName === "Brand") {
        await ActivityLogger.logBulkDeleteActivity(
          "Brand",
          deletedDocuments.deletedCount,
          ids,
          req.user
        );
      } else if (Model.modelName === "SubCategory") {
        await ActivityLogger.logBulkDeleteActivity(
          "SubCategory",
          deletedDocuments.deletedCount,
          ids,
          req.user
        );
      }
    }

    res.status(200).json({
      message: `${deletedDocuments.deletedCount} ${Model.modelName}(s) deleted successfully`,
      deletedCount: deletedDocuments.deletedCount,
    });
  });

module.exports = exports;