const mongoose = require("mongoose");
const orderModel = require("../models/orderModel");
const userModel = require("../models/userModel");
const productModel = require("../models/productModel");
const settingModel = require("../models/settingModel");

/**
 * Parse and normalize a date range from query params.
 * - Handles "YYYY-MM-DD" date-only strings (end is inclusive of the full day).
 * - Returns null for invalid or missing values.
 * @param {string} startDate - Start date string
 * @param {string} endDate - End date string
 * @returns {{start: Date|null, end: Date|null}}
 */
const parseDateRange = (startDate, endDate) => {
  let start = startDate ? new Date(startDate) : null;
  let end = endDate ? new Date(endDate) : null;

  if (start && isNaN(start.getTime())) start = null;
  if (end && isNaN(end.getTime())) end = null;

  // Date-only strings are parsed as UTC midnight; make the end of the range
  // inclusive of the whole day so orders on endDate are counted.
  if (start && /^\d{4}-\d{2}-\d{2}$/.test(String(startDate))) {
    start.setUTCHours(0, 0, 0, 0);
  }
  if (end && /^\d{4}-\d{2}-\d{2}$/.test(String(endDate))) {
    end.setUTCHours(23, 59, 59, 999);
  }

  return { start, end };
};

// M3: Group the 10 deliveryStatus values into 4 dashboard buckets
const ORDER_STATUS_BUCKETS = {
  inProgress: ["pending", "confirmed", "shipped", "in_transit", "out_for_delivery"],
  completed: ["delivered", "completed"],
  failedReturned: ["failed", "returned"],
  cancelled: ["cancelled"],
};

// M3: Payment methods tracked on orders
const PAYMENT_METHODS = ["card", "cash"];

/**
 * Calculate total revenue from orders
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @returns {Object} Total revenue and percentage change
 */
const calculateTotalRevenue = async (startDate = null, endDate = null) => {
  try {
    const currentPeriodQuery = {
      paymentStatus: { $in: ["confirmed", "completed"] },
    };

    if (startDate && endDate) {
      currentPeriodQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    // Current period revenue
    const currentRevenue = await orderModel.aggregate([
      { $match: currentPeriodQuery },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalOrderPrice" },
        },
      },
    ]);

    const currentTotal = currentRevenue.length > 0 ? currentRevenue[0].total : 0;

    // Previous period for comparison (same duration)
    let percentageChange = 0;
    if (startDate && endDate) {
      const duration = endDate - startDate;
      const previousStartDate = new Date(startDate.getTime() - duration);
      const previousEndDate = new Date(startDate.getTime());

      const previousRevenue = await orderModel.aggregate([
        {
          $match: {
            paymentStatus: { $in: ["confirmed", "completed"] },
            createdAt: { $gte: previousStartDate, $lt: previousEndDate },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalOrderPrice" },
          },
        },
      ]);

      const previousTotal = previousRevenue.length > 0 ? previousRevenue[0].total : 0;

      if (previousTotal > 0) {
        percentageChange = ((currentTotal - previousTotal) / previousTotal) * 100;
      } else {
        // No previous-period baseline -> can't compute a change (null = "New").
        percentageChange = null;
      }
    }

    return {
      total: currentTotal,
      percentageChange:
        percentageChange === null ? null : parseFloat(percentageChange.toFixed(2)),
      trend: percentageChange === null ? "neutral" : percentageChange >= 0 ? "up" : "down",
    };
  } catch (error) {
    throw new Error(`Error calculating total revenue: ${error.message}`);
  }
};

/**
 * Calculate new customers count
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @returns {Object} New customers count and percentage change
 */
const calculateNewCustomers = async (startDate = null, endDate = null) => {
  try {
    const currentPeriodQuery = { role: "user" };

    if (startDate && endDate) {
      currentPeriodQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    // Current period customers
    const currentCount = await userModel.countDocuments(currentPeriodQuery);

    // Previous period for comparison
    let percentageChange = 0;
    if (startDate && endDate) {
      const duration = endDate - startDate;
      const previousStartDate = new Date(startDate.getTime() - duration);
      const previousEndDate = new Date(startDate.getTime());

      const previousCount = await userModel.countDocuments({
        role: "user",
        createdAt: { $gte: previousStartDate, $lt: previousEndDate },
      });

      if (previousCount > 0) {
        percentageChange = ((currentCount - previousCount) / previousCount) * 100;
      } else {
        // No previous-period baseline -> can't compute a change (null = "New").
        percentageChange = null;
      }
    }

    return {
      total: currentCount,
      percentageChange:
        percentageChange === null ? null : parseFloat(percentageChange.toFixed(2)),
      trend: percentageChange === null ? "neutral" : percentageChange >= 0 ? "up" : "down",
    };
  } catch (error) {
    throw new Error(`Error calculating new customers: ${error.message}`);
  }
};

/**
 * Calculate total orders
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @param {boolean} paidOnly - When true, only count confirmed/completed (paid) orders
 * @returns {Object} Total orders count and percentage change
 */
const calculateTotalOrders = async (startDate = null, endDate = null, paidOnly = false) => {
  try {
    const currentPeriodQuery = {};

    if (paidOnly) {
      currentPeriodQuery.paymentStatus = { $in: ["confirmed", "completed"] };
    }

    if (startDate && endDate) {
      currentPeriodQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    // Current period orders
    const currentCount = await orderModel.countDocuments(currentPeriodQuery);

    // Previous period for comparison
    let percentageChange = 0;
    if (startDate && endDate) {
      const duration = endDate - startDate;
      const previousStartDate = new Date(startDate.getTime() - duration);
      const previousEndDate = new Date(startDate.getTime());

      const previousPeriodQuery = {
        createdAt: { $gte: previousStartDate, $lt: previousEndDate },
      };
      if (paidOnly) {
        previousPeriodQuery.paymentStatus = { $in: ["confirmed", "completed"] };
      }

      const previousCount = await orderModel.countDocuments(previousPeriodQuery);

      if (previousCount > 0) {
        percentageChange = ((currentCount - previousCount) / previousCount) * 100;
      } else {
        // No previous-period baseline -> can't compute a change (null = "New").
        percentageChange = null;
      }
    }

    return {
      total: currentCount,
      percentageChange:
        percentageChange === null ? null : parseFloat(percentageChange.toFixed(2)),
      trend: percentageChange === null ? "neutral" : percentageChange >= 0 ? "up" : "down",
    };
  } catch (error) {
    throw new Error(`Error calculating total orders: ${error.message}`);
  }
};

/**
 * Get top selling product
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @returns {Object} Top product details
 */
const getTopProduct = async (startDate = null, endDate = null) => {
  try {
    const matchQuery = {
      paymentStatus: { $in: ["confirmed", "completed"] },
    };

    if (startDate && endDate) {
      matchQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    const topProducts = await orderModel.aggregate([
      { $match: matchQuery },
      { $unwind: "$cartItems" },
      {
        $group: {
          _id: "$cartItems.product",
          totalQuantity: { $sum: "$cartItems.quantity" },
          totalRevenue: { $sum: { $multiply: ["$cartItems.quantity", "$cartItems.price"] } },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 1 },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      { $unwind: { path: "$productDetails", preserveNullAndEmptyArrays: true } },
    ]);

    if (topProducts.length === 0) {
      return {
        name: "No sales yet",
        totalQuantity: 0,
        totalRevenue: 0,
        percentageChange: 0,
        trend: "neutral",
      };
    }

    const topProduct = topProducts[0];

    // Calculate percentage change
    let percentageChange = 0;
    if (startDate && endDate) {
      const duration = endDate - startDate;
      const previousStartDate = new Date(startDate.getTime() - duration);
      const previousEndDate = new Date(startDate.getTime());

      const previousTopProduct = await orderModel.aggregate([
        {
          $match: {
            paymentStatus: { $in: ["confirmed", "completed"] },
            createdAt: { $gte: previousStartDate, $lt: previousEndDate },
          },
        },
        { $unwind: "$cartItems" },
        {
          $match: {
            "cartItems.product": topProduct._id,
          },
        },
        {
          $group: {
            _id: "$cartItems.product",
            totalQuantity: { $sum: "$cartItems.quantity" },
          },
        },
      ]);

      const previousQuantity = previousTopProduct.length > 0 ? previousTopProduct[0].totalQuantity : 0;

      if (previousQuantity > 0) {
        percentageChange = ((topProduct.totalQuantity - previousQuantity) / previousQuantity) * 100;
      } else {
        // No previous-period baseline -> can't compute a change (null = "New").
        percentageChange = null;
      }
    }

    return {
      productId: topProduct._id,
      name: topProduct.productDetails?.name || "Unknown Product",
      totalQuantity: topProduct.totalQuantity,
      totalRevenue: topProduct.totalRevenue,
      percentageChange:
        percentageChange === null ? null : parseFloat(percentageChange.toFixed(2)),
      trend: percentageChange === null ? "neutral" : percentageChange >= 0 ? "up" : "down",
    };
  } catch (error) {
    throw new Error(`Error getting top product: ${error.message}`);
  }
};

/**
 * Get growth rate data for charts
 * @param {Number} days - Number of days (7, 30, or 90)
 * @returns {Array} Daily growth data
 */
const getGrowthRateData = async (days = 90, startDate = null, endDate = null) => {
  try {
    let end = endDate;
    let start = startDate;

    // Fall back to a rolling window when no explicit range is provided
    if (!start || !end) {
      end = new Date();
      end.setHours(23, 59, 59, 999);

      start = new Date();
      start.setDate(start.getDate() - days);
      start.setHours(0, 0, 0, 0);
    }

    const dailyData = await orderModel.aggregate([
      {
        $match: {
          paymentStatus: { $in: ["confirmed", "completed"] },
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          desktop: { $sum: "$totalOrderPrice" },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: "$_id",
          desktop: { $round: ["$desktop", 0] },
        },
      },
    ]);

    // Fill in missing dates with 0 values
    const result = [];
    const currentDate = new Date(start);

    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const existingData = dailyData.find((d) => d.date === dateStr);

      result.push({
        date: dateStr,
        desktop: existingData ? existingData.desktop : 0,
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  } catch (error) {
    throw new Error(`Error getting growth rate data: ${error.message}`);
  }
};

/**
 * Get best orders (highest value orders)
 * @param {Number} limit - Number of orders to return
 * @returns {Array} Best orders
 */
const getBestOrders = async (limit = 5, startDate = null, endDate = null) => {
  try {
    const query = {
      paymentStatus: { $in: ["confirmed", "completed"] },
    };
    if (startDate && endDate) {
      query.createdAt = { $gte: startDate, $lte: endDate };
    }

    const orders = await orderModel
      .find(query)
      .sort({ totalOrderPrice: -1 })
      .limit(limit)
      .select("_id user totalOrderPrice createdAt")
      .populate("user", "name")
      .lean();

    return orders.map((order) => ({
      id: order._id.toString().substring(18, 24).toUpperCase(),
      customer: order.user?.name || "Unknown",
      total: `${order.totalOrderPrice.toFixed(2)} DZD`,
      date: order.createdAt.toISOString().split("T")[0],
    }));
  } catch (error) {
    throw new Error(`Error getting best orders: ${error.message}`);
  }
};

/**
 * Get top customers by revenue
 * @param {Number} limit - Number of customers to return
 * @returns {Array} Top customers
 */
const getTopCustomers = async (limit = 5, startDate = null, endDate = null) => {
  try {
    const matchQuery = {
      paymentStatus: { $in: ["confirmed", "completed"] },
    };
    if (startDate && endDate) {
      matchQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    const topCustomers = await orderModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$user",
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: "$totalOrderPrice" },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: { path: "$userDetails", preserveNullAndEmptyArrays: true } },
    ]);

    return topCustomers.map((customer) => ({
      name: customer.userDetails?.name || "Unknown",
      products: customer.totalOrders,
      revenue: `${customer.totalRevenue.toFixed(2)} DZD`,
    }));
  } catch (error) {
    throw new Error(`Error getting top customers: ${error.message}`);
  }
};

/**
 * Get best selling products
 * @param {Number} limit - Number of products to return
 * @returns {Array} Best products
 */
const getBestProducts = async (limit = 5, startDate = null, endDate = null) => {
  try {
    const matchQuery = {
      paymentStatus: { $in: ["confirmed", "completed"] },
    };
    if (startDate && endDate) {
      matchQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    const bestProducts = await orderModel.aggregate([
      { $match: matchQuery },
      { $unwind: "$cartItems" },
      {
        $group: {
          _id: "$cartItems.product",
          sold: { $sum: "$cartItems.quantity" },
          revenue: { $sum: { $multiply: ["$cartItems.quantity", "$cartItems.price"] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      { $unwind: { path: "$productDetails", preserveNullAndEmptyArrays: true } },
    ]);

    return bestProducts.map((product) => ({
      name: product.productDetails?.name || "Unknown Product",
      sold: product.sold,
      revenue: `${product.revenue.toFixed(2)} DZD`,
    }));
  } catch (error) {
    throw new Error(`Error getting best products: ${error.message}`);
  }
};

/**
 * Calculate average order value (AOV)
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @returns {Object} AOV and percentage change
 */
const calculateAOV = async (startDate = null, endDate = null) => {
  try {
    const revenue = await calculateTotalRevenue(startDate, endDate);
    // M1: AOV uses only paid (confirmed/completed) orders as the denominator.
    const orders = await calculateTotalOrders(startDate, endDate, true);
    const total = orders.total > 0 ? revenue.total / orders.total : 0;

    // Previous period for comparison (same duration)
    let percentageChange = 0;
    if (startDate && endDate) {
      const duration = endDate - startDate;
      const previousStartDate = new Date(startDate.getTime() - duration);
      const previousEndDate = new Date(startDate.getTime());

      const [prevRevenue, prevOrders] = await Promise.all([
        calculateTotalRevenue(previousStartDate, previousEndDate),
        calculateTotalOrders(previousStartDate, previousEndDate, true),
      ]);
      const prevAov = prevOrders.total > 0 ? prevRevenue.total / prevOrders.total : 0;

      if (prevAov > 0) {
        percentageChange = ((total - prevAov) / prevAov) * 100;
      } else {
        // No previous-period baseline -> can't compute a change (null = "New").
        percentageChange = null;
      }
    }

    return {
      total: parseFloat(total.toFixed(2)),
      percentageChange:
        percentageChange === null ? null : parseFloat(percentageChange.toFixed(2)),
      trend: percentageChange === null ? "neutral" : percentageChange >= 0 ? "up" : "down",
    };
  } catch (error) {
    throw new Error(`Error calculating average order value: ${error.message}`);
  }
};

/**
 * Calculate conversion (orders per registered user)
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @returns {Object} Conversion ratio and percentage change
 */
const calculateConversion = async (startDate = null, endDate = null) => {
  try {
    const orders = await calculateTotalOrders(startDate, endDate);

    const userQuery = { role: "user" };
    if (startDate && endDate) {
      userQuery.createdAt = { $gte: startDate, $lte: endDate };
    }
    const users = await userModel.countDocuments(userQuery);

    const total = users > 0 ? orders.total / users : 0;

    // Previous period for comparison (same duration)
    let percentageChange = 0;
    if (startDate && endDate) {
      const duration = endDate - startDate;
      const previousStartDate = new Date(startDate.getTime() - duration);
      const previousEndDate = new Date(startDate.getTime());

      const [prevOrders, prevUsers] = await Promise.all([
        calculateTotalOrders(previousStartDate, previousEndDate),
        userModel.countDocuments({
          role: "user",
          createdAt: { $gte: previousStartDate, $lt: previousEndDate },
        }),
      ]);
      const prevConversion = prevUsers > 0 ? prevOrders.total / prevUsers : 0;

      if (prevConversion > 0) {
        percentageChange = ((total - prevConversion) / prevConversion) * 100;
      } else {
        // No previous-period baseline -> can't compute a change (null = "New").
        percentageChange = null;
      }
    }

    return {
      total: parseFloat(total.toFixed(2)),
      percentageChange:
        percentageChange === null ? null : parseFloat(percentageChange.toFixed(2)),
      trend: percentageChange === null ? "neutral" : percentageChange >= 0 ? "up" : "down",
    };
  } catch (error) {
    throw new Error(`Error calculating conversion: ${error.message}`);
  }
};

/**
 * Get all dashboard analytics data
 * @param {Date} startDate - Start date for filtering (defaults to 30 days ago)
 * @param {Date} endDate - End date for filtering (defaults to now)
 * @returns {Object} Complete dashboard data
 */
const getDashboardAnalytics = async (startDate = null, endDate = null) => {
  try {
    // Default to a rolling 30-day window when no explicit range is provided
    if (!startDate || !endDate) {
      const now = new Date();
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      endDate = now;
    }

    const [revenue, customers, orders, topProduct, aov, conversion] =
      await Promise.all([
        calculateTotalRevenue(startDate, endDate),
        calculateNewCustomers(startDate, endDate),
        calculateTotalOrders(startDate, endDate),
        getTopProduct(startDate, endDate),
        calculateAOV(startDate, endDate),
        calculateConversion(startDate, endDate),
      ]);

    return {
      cards: {
        revenue,
        customers,
        orders,
        topProduct,
        aov,
        conversion,
      },
    };
  } catch (error) {
    throw new Error(`Error getting dashboard analytics: ${error.message}`);
  }
};

/**
 * Get all dashboard tables data
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @returns {Object} All tables data
 */
const getDashboardTables = async (startDate = null, endDate = null) => {
  try {
    const [bestOrders, topCustomers, bestProducts] = await Promise.all([
      getBestOrders(5, startDate, endDate),
      getTopCustomers(5, startDate, endDate),
      getBestProducts(5, startDate, endDate),
    ]);

    return {
      bestOrders,
      topCustomers,
      bestProducts,
    };
  } catch (error) {
    throw new Error(`Error getting dashboard tables: ${error.message}`);
  }
};

/**
 * Get order status breakdown grouped into 4 buckets
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @returns {Object} Buckets with counts + revenue + total orders
 */
const getOrderStatusBreakdown = async (startDate = null, endDate = null) => {
  try {
    const matchQuery = {};
    if (startDate && endDate) {
      matchQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    const statusCounts = await orderModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$deliveryStatus",
          count: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [
                { $in: ["$paymentStatus", ["confirmed", "completed"]] },
                "$totalOrderPrice",
                0,
              ],
            },
          },
        },
      },
    ]);

    const buckets = Object.entries(ORDER_STATUS_BUCKETS).map(
      ([key, statuses]) => {
        const bucketRows = statusCounts.filter((s) =>
          statuses.includes(s._id)
        );
        return {
          key,
          count: bucketRows.reduce((sum, s) => sum + s.count, 0),
          revenue: bucketRows.reduce((sum, s) => sum + (s.revenue || 0), 0),
        };
      }
    );

    const totalOrders = buckets.reduce((sum, b) => sum + b.count, 0);

    return {
      totalOrders,
      buckets,
    };
  } catch (error) {
    throw new Error(`Error getting order status breakdown: ${error.message}`);
  }
};

/**
 * Get payment method breakdown (card vs cash)
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @returns {Object} Card/cash counts + revenue
 */
const getPaymentMethodBreakdown = async (startDate = null, endDate = null) => {
  try {
    const matchQuery = {};
    if (startDate && endDate) {
      matchQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    const methodCounts = await orderModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$paymentMethodType",
          count: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [
                { $in: ["$paymentStatus", ["confirmed", "completed"]] },
                "$totalOrderPrice",
                0,
              ],
            },
          },
        },
      },
    ]);

    const result = {};
    for (const method of PAYMENT_METHODS) {
      const row = methodCounts.find((m) => m._id === method);
      result[method] = {
        key: method,
        count: row?.count || 0,
        revenue: row?.revenue || 0,
      };
    }

    return result;
  } catch (error) {
    throw new Error(`Error getting payment method breakdown: ${error.message}`);
  }
};

/**
 * Get a single setting by key
 * @param {String} key - Setting key
 * @param {*} defaultValue - Value returned when setting is missing
 * @returns {*} Setting value
 */
const getSetting = async (key, defaultValue = null) => {
  const setting = await settingModel.findOne({ key }).lean();
  return setting ? setting.value : defaultValue;
};

/**
 * Set (upsert) a setting value by key
 * @param {String} key - Setting key
 * @param {*} value - Setting value
 * @returns {*} Saved value
 */
const setSetting = async (key, value) => {
  await settingModel.findOneAndUpdate(
    { key },
    { key, value },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return value;
};

/**
 * Get products with quantity at or below the given threshold
 * @param {Number} threshold - Low-stock threshold
 * @param {Number} limit - Max number of products to return
 * @returns {Array} Low-stock products
 */
const getLowStockProducts = async (threshold = 10, limit = 10) => {
  try {
    const products = await productModel
      .find({ quantity: { $lte: threshold } })
      .sort({ quantity: 1 })
      .limit(limit)
      .select("name quantity sold price category")
      .populate("category", "name")
      .lean();

    return products.map((product) => ({
      id: product._id,
      name: product.name,
      quantity: product.quantity,
      sold: product.sold,
      price: product.price,
      category: product.category?.name || null,
    }));
  } catch (error) {
    throw new Error(`Error getting low stock products: ${error.message}`);
  }
};

/**
 * Get revenue aggregated by category or brand
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @param {String} groupBy - "category" or "brand"
 * @param {Number} limit - Max number of groups to return
 * @returns {Array} Groups with revenue + units sold
 */
const getRevenueByGroup = async (
  startDate = null,
  endDate = null,
  groupBy = "category",
  limit = 10
) => {
  try {
    const matchQuery = {
      paymentStatus: { $in: ["confirmed", "completed"] },
    };
    if (startDate && endDate) {
      matchQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    const pipeline = [
      { $match: matchQuery },
      { $unwind: "$cartItems" },
      {
        $lookup: {
          from: "products",
          localField: "cartItems.product",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
    ];

    // Lookup the grouping collection (brand or category)
    const lookupFrom = groupBy === "brand" ? "brands" : "categories";
    const lookupField = groupBy === "brand" ? "product.brand" : "product.category";
    pipeline.push(
      {
        $lookup: {
          from: lookupFrom,
          localField: lookupField,
          foreignField: "_id",
          as: "group",
        },
      },
      { $unwind: { path: "$group", preserveNullAndEmptyArrays: true } }
    );

    pipeline.push(
      {
        $group: {
          _id: "$group._id",
          name: { $first: "$group.name" },
          revenue: {
            $sum: { $multiply: ["$cartItems.quantity", "$cartItems.price"] },
          },
          sold: { $sum: "$cartItems.quantity" },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit }
    );

    const results = await orderModel.aggregate(pipeline);

    return results.map((item) => ({
      id: item._id,
      name: item.name || "Unknown",
      revenue: item.revenue,
      sold: item.sold,
    }));
  } catch (error) {
    throw new Error(`Error getting revenue by ${groupBy}: ${error.message}`);
  }
};

module.exports = {
  parseDateRange,
  calculateTotalRevenue,
  calculateNewCustomers,
  calculateTotalOrders,
  getTopProduct,
  getGrowthRateData,
  getBestOrders,
  getTopCustomers,
  getBestProducts,
  getDashboardAnalytics,
  getDashboardTables,
  calculateAOV,
  calculateConversion,
  getOrderStatusBreakdown,
  getPaymentMethodBreakdown,
  getSetting,
  setSetting,
  getLowStockProducts,
  getRevenueByGroup,
};