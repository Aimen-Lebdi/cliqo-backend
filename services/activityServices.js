const ActivityLog = require("../models/activityLogModel");
const factory = require("./handlersFactory");
const expressAsyncHandler = require("express-async-handler");
const ApiFeatures = require("../utils/apiFeatures");

/**
 * Escape special regex characters so user-supplied search strings are
 * treated as literal text, not regex syntax.
 */
const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Build a safe regex filter for metadata.orderShortId. The input is
 * escaped to prevent invalid-regex errors from user-supplied strings.
 */
const buildOrderShortIdFilter = (orderShortId) => ({
  "metadata.orderShortId": {
    $regex: escapeRegExp(orderShortId),
    $options: "i",
  },
});

/**
 * Process metadata-level query params (e.g. orderShortId) and convert them
 * to proper MongoDB queries. Removes the processed params from req.query
 * so ApiFeatures.filter() doesn't try to match them as top-level fields.
 */
const processMetadataFilters = (req) => {
  if (req.query.orderShortId) {
    req.filterObj = {
      ...(req.filterObj || {}),
      ...buildOrderShortIdFilter(req.query.orderShortId),
    };
    delete req.query.orderShortId;
  }
};

// M7: Get all activities with full filtering, search, and pagination.
// Supports: ?status=failed, ?amount[gte]=X&amount[lte]=Y,
//   ?orderShortId=ABC, ?keyword=text, ?page, ?limit, ?sort
const getAllActivities = expressAsyncHandler(async (req, res, next) => {
  processMetadataFilters(req);

  // Delegate to the generic factory handler which applies ApiFeatures
  const handler = factory.getAll(
    ActivityLog,
    ["activity", "description", "user.name"], // Search fields
    null // No population needed
  );
  return handler(req, res, next);
});

// Get activity by ID
const getOneActivity = factory.getOne(ActivityLog);

// M7: Get activities for dashboard — last 50, with optional filters.
// Supports: ?status=failed, ?amount[gte]=X&amount[lte]=Y,
//   ?orderShortId=ABC, ?sort=field
const getDashboardActivities = expressAsyncHandler(async (req, res) => {
  const { status, orderShortId, sort } = req.query;

  // Build dynamic filter
  const filter = {};
  if (status) {
    filter.status = status;
  }
  if (orderShortId) {
    Object.assign(filter, buildOrderShortIdFilter(orderShortId));
  }

  // Handle amount range: ?amount[gte]=1000&amount[lte]=5000
  const amountFilter = {};
  if (req.query["amount[gte]"]) {
    amountFilter.$gte = Number(req.query["amount[gte]"]);
  }
  if (req.query["amount[lte]"]) {
    amountFilter.$lte = Number(req.query["amount[lte]"]);
  }
  if (Object.keys(amountFilter).length > 0) {
    filter.amount = amountFilter;
  }

  const sortOption = sort ? sort.split(",").join(" ") : "-createdAt";

  const activities = await ActivityLog.find(filter)
    .sort(sortOption)
    .limit(50)
    .select({
      type: 1,
      activity: 1,
      user: 1,
      description: 1,
      status: 1,
      amount: 1,
      metadata: 1, // M7: include metadata so the UI can display order details
      createdAt: 1,
    });

  res.status(200).json({
    result: activities.length,
    activities,
  });
});

// M7: Get activities by type with full filtering, search, and pagination.
// Supports: ?status=failed, ?amount[gte]=X&amount[lte]=Y,
//   ?orderShortId=ABC, ?keyword=text, ?page, ?limit, ?sort
const getActivitiesByType = expressAsyncHandler(async (req, res) => {
  const { type } = req.params;

  // Build base filter with the type from URL params
  const filter = { type };

  // Handle metadata search params (e.g. orderShortId)
  if (req.query.orderShortId) {
    Object.assign(filter, buildOrderShortIdFilter(req.query.orderShortId));
    delete req.query.orderShortId;
  }

  const apiFeatures = new ApiFeatures(ActivityLog.find(filter), req.query);

  let query = apiFeatures
    .filter() // Handles status, amount[gte]/[lte], and other model fields
    .search(["activity", "description", "user.name"]) // keyword search
    .sort()
    .limitFields();

  const documentsCounts = await query.mongooseQuery.clone().countDocuments();
  query = query.paginate(documentsCounts);

  const activities = await query.mongooseQuery;

  // Response shape kept flat (currentPage, totalPages, total) for backward
  // compatibility with the frontend activitiesSlice which reads these fields
  // directly from the response object.
  res.status(200).json({
    result: documentsCounts,
    total: documentsCounts,
    currentPage: apiFeatures.pagination.currentPage,
    totalPages: apiFeatures.pagination.numberOfPages,
    activities,
  });
});

// Get user activities
const getUserActivities = expressAsyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const skip = (page - 1) * limit;

  const activities = await ActivityLog.find({ "user.id": userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await ActivityLog.countDocuments({ "user.id": userId });

  res.status(200).json({
    result: activities.length,
    total,
    currentPage: parseInt(page),
    totalPages: Math.ceil(total / limit),
    activities,
  });
});

// Get activity statistics
const getActivityStats = expressAsyncHandler(async (req, res) => {
  const { timeframe = "7d" } = req.query;

  // Calculate date range based on timeframe
  const now = new Date();
  let startDate = new Date();

  switch (timeframe) {
    case "1d":
      startDate.setDate(now.getDate() - 1);
      break;
    case "7d":
      startDate.setDate(now.getDate() - 7);
      break;
    case "30d":
      startDate.setDate(now.getDate() - 30);
      break;
    case "90d":
      startDate.setDate(now.getDate() - 90);
      break;
    default:
      startDate.setDate(now.getDate() - 7);
  }

  // Aggregate activities by type
  const typeStats = await ActivityLog.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: "$type",
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
  ]);

  // Aggregate activities by day
  const dailyStats = await ActivityLog.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
          },
        },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  // Get total activities count
  const totalActivities = await ActivityLog.countDocuments({
    createdAt: { $gte: startDate },
  });

  // M9: Status breakdown — count per status (success/failed/pending) so the
  // frontend can display failure rate and highlight issues at a glance.
  const statusStats = await ActivityLog.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  // M9: Compute failure rate as a percentage (0–100, rounded to 1 decimal).
  const failedEntry = statusStats.find((s) => s._id === "failed");
  const failedCount = failedEntry ? failedEntry.count : 0;
  const failureRate =
    totalActivities > 0
      ? Math.round((failedCount / totalActivities) * 1000) / 10
      : 0;

  res.status(200).json({
    timeframe,
    totalActivities,
    typeStats,
    dailyStats,
    statusStats,
    failureRate,
  });
});

// Delete old activities (cleanup)
const cleanupOldActivities = expressAsyncHandler(async (req, res) => {
  const { days = 90 } = req.body; // Default: keep last 90 days

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const result = await ActivityLog.deleteMany({
    createdAt: { $lt: cutoffDate },
  });

  res.status(200).json({
    message: `Cleaned up ${result.deletedCount} old activity records`,
    deletedCount: result.deletedCount,
  });
});

module.exports = {
  getAllActivities,
  getOneActivity,
  getDashboardActivities,
  getActivitiesByType,
  getUserActivities,
  getActivityStats,
  cleanupOldActivities,
};
