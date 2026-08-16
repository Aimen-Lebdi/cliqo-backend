const asyncHandler = require("express-async-handler");
const {
  parseDateRange,
  getDashboardAnalytics,
  getDashboardTables,
  getGrowthRateData,
  calculateTotalRevenue,
  calculateNewCustomers,
  calculateTotalOrders,
  getTopProduct,
  getOrderStatusBreakdown,
  getPaymentMethodBreakdown,
  getSetting,
  setSetting,
  getLowStockProducts,
  getRevenueByGroup,
} = require("../services/analyticsService");

/**
 * @desc    Get dashboard cards analytics (revenue, customers, orders, top product, aov, conversion)
 * @route   GET /api/v1/analytics/dashboard/cards
 * @access  Private/Admin
 * @query   startDate, endDate (optional; defaults to last 30 days)
 */
exports.getDashboardCards = asyncHandler(async (req, res) => {
  const { start, end } = parseDateRange(req.query.startDate, req.query.endDate);
  const data = await getDashboardAnalytics(start, end);

  res.status(200).json({
    status: "success",
    data: data.cards,
  });
});

/**
 * @desc    Get dashboard tables (best orders, top customers, best products)
 * @route   GET /api/v1/analytics/dashboard/tables
 * @access  Private/Admin
 * @query   startDate, endDate (optional)
 */
exports.getDashboardTablesController = asyncHandler(async (req, res) => {
  const { start, end } = parseDateRange(req.query.startDate, req.query.endDate);
  const data = await getDashboardTables(start, end);

  res.status(200).json({
    status: "success",
    data,
  });
});

/**
 * @desc    Get growth rate chart data
 * @route   GET /api/v1/analytics/growth-rate
 * @access  Private/Admin
 * @query   days - Number of days (7, 30, or 90) OR startDate & endDate for a custom range
 */
exports.getGrowthRate = asyncHandler(async (req, res) => {
  const { days, startDate, endDate } = req.query;

  // Prefer an explicit custom date range when both bounds are provided
  if (startDate && endDate) {
    const { start, end } = parseDateRange(startDate, endDate);
    const data = await getGrowthRateData(90, start, end);

    res.status(200).json({
      status: "success",
      data: {
        period: "custom",
        chartData: data,
      },
    });
    return;
  }

  const allowedDays = [7, 30, 90];
  const selectedDays = allowedDays.includes(parseInt(days)) ? parseInt(days) : 90;

  const data = await getGrowthRateData(selectedDays);

  res.status(200).json({
    status: "success",
    data: {
      period: `${selectedDays}d`,
      chartData: data,
    },
  });
});

/**
 * @desc    Get complete dashboard data (cards + tables)
 * @route   GET /api/v1/analytics/dashboard
 * @access  Private/Admin
 * @query   startDate, endDate (optional)
 */
exports.getCompleteDashboard = asyncHandler(async (req, res) => {
  const { start, end } = parseDateRange(req.query.startDate, req.query.endDate);
  const [cardsData, tablesData] = await Promise.all([
    getDashboardAnalytics(start, end),
    getDashboardTables(start, end),
  ]);

  res.status(200).json({
    status: "success",
    data: {
      cards: cardsData.cards,
      tables: tablesData,
    },
  });
});

/**
 * @desc    Get revenue analytics for custom date range
 * @route   GET /api/v1/analytics/revenue
 * @access  Private/Admin
 * @query   startDate, endDate
 */
exports.getRevenueAnalytics = asyncHandler(async (req, res) => {
  const { start, end } = parseDateRange(req.query.startDate, req.query.endDate);
  const data = await calculateTotalRevenue(start, end);

  res.status(200).json({
    status: "success",
    data,
  });
});

/**
 * @desc    Get customers analytics for custom date range
 * @route   GET /api/v1/analytics/customers
 * @access  Private/Admin
 * @query   startDate, endDate
 */
exports.getCustomersAnalytics = asyncHandler(async (req, res) => {
  const { start, end } = parseDateRange(req.query.startDate, req.query.endDate);
  const data = await calculateNewCustomers(start, end);

  res.status(200).json({
    status: "success",
    data,
  });
});

/**
 * @desc    Get orders analytics for custom date range
 * @route   GET /api/v1/analytics/orders
 * @access  Private/Admin
 * @query   startDate, endDate
 */
exports.getOrdersAnalytics = asyncHandler(async (req, res) => {
  const { start, end } = parseDateRange(req.query.startDate, req.query.endDate);
  const data = await calculateTotalOrders(start, end);

  res.status(200).json({
    status: "success",
    data,
  });
});

/**
 * @desc    Get top product analytics for custom date range
 * @route   GET /api/v1/analytics/top-product
 * @access  Private/Admin
 * @query   startDate, endDate
 */
exports.getTopProductAnalytics = asyncHandler(async (req, res) => {
  const { start, end } = parseDateRange(req.query.startDate, req.query.endDate);
  const data = await getTopProduct(start, end);

  res.status(200).json({
    status: "success",
    data,
  });
});

/**
 * @desc    Get order status breakdown (4 buckets)
 * @route   GET /api/v1/analytics/order-status
 * @access  Private/Admin
 * @query   startDate, endDate (optional)
 */
exports.getOrderStatus = asyncHandler(async (req, res) => {
  const { start, end } = parseDateRange(req.query.startDate, req.query.endDate);
  const data = await getOrderStatusBreakdown(start, end);

  res.status(200).json({
    status: "success",
    data,
  });
});

/**
 * @desc    Get payment method breakdown (card vs cash)
 * @route   GET /api/v1/analytics/payment-methods
 * @access  Private/Admin
 * @query   startDate, endDate (optional)
 */
exports.getPaymentMethods = asyncHandler(async (req, res) => {
  const { start, end } = parseDateRange(req.query.startDate, req.query.endDate);
  const data = await getPaymentMethodBreakdown(start, end);

  res.status(200).json({
    status: "success",
    data,
  });
});

/**
 * @desc    Get low-stock products using the configured threshold
 * @route   GET /api/v1/analytics/low-stock
 * @access  Private/Admin
 */
exports.getLowStock = asyncHandler(async (req, res) => {
  const threshold = await getSetting("lowStockThreshold", 10);
  const products = await getLowStockProducts(threshold, 10);

  res.status(200).json({
    status: "success",
    data: {
      threshold,
      products,
    },
  });
});

/**
 * @desc    Get the low-stock threshold setting
 * @route   GET /api/v1/analytics/settings/low-stock-threshold
 * @access  Private/Admin
 */
exports.getLowStockThreshold = asyncHandler(async (req, res) => {
  const threshold = await getSetting("lowStockThreshold", 10);

  res.status(200).json({
    status: "success",
    data: { threshold },
  });
});

/**
 * @desc    Update the low-stock threshold setting
 * @route   PUT /api/v1/analytics/settings/low-stock-threshold
 * @access  Private/Admin
 * @body    { threshold: Number }
 */
exports.updateLowStockThreshold = asyncHandler(async (req, res) => {
  const { threshold } = req.body;
  const value = Number(threshold);

  if (isNaN(value) || value < 0) {
    return res.status(400).json({
      status: "fail",
      message: "Threshold must be a non-negative number",
    });
  }

  await setSetting("lowStockThreshold", value);

  res.status(200).json({
    status: "success",
    data: { threshold: value },
  });
});

/**
 * @desc    Get revenue grouped by category or brand
 * @route   GET /api/v1/analytics/sales-by
 * @access  Private/Admin
 * @query   groupBy=category|brand, startDate, endDate (optional)
 */
exports.getSalesBy = asyncHandler(async (req, res) => {
  const { groupBy = "category", startDate, endDate } = req.query;
  const validGroup = groupBy === "brand" ? "brand" : "category";
  const { start, end } = parseDateRange(startDate, endDate);

  const items = await getRevenueByGroup(start, end, validGroup, 10);

  res.status(200).json({
    status: "success",
    data: {
      groupBy: validGroup,
      items,
    },
  });
});