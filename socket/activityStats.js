const ActivityLog = require("../models/activityLogModel");

/**
 * Compute realtime activity stats for the last 24h, matching the shape consumed
 * by the dashboard `activity_stats` socket event. Shared by the
 * `request_activity_stats` socket handler and the activity logger (which pushes
 * fresh stats after every new activity) so the aggregation lives in one place.
 *
 * @returns {Promise<{
 *   stats: Array<{ _id: string, count: number }>,
 *   dailyStats: Array<{ _id: string, count: number }>,
 *   total: number,
 *   timeframe: string
 * }>}
 */
async function computeActivityStats() {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const stats = await ActivityLog.aggregate([
    {
      $match: {
        createdAt: { $gte: last24h },
      },
    },
    {
      $group: {
        _id: "$type",
        count: { $sum: 1 },
      },
    },
  ]);

  // Daily breakdown for the same 24h window (same shape as the REST stats
  // endpoint: `_id` = YYYY-MM-DD), so socket-pushed stats keep dailyStats
  // populated instead of leaving it as an empty array.
  const dailyStats = await ActivityLog.aggregate([
    {
      $match: {
        createdAt: { $gte: last24h },
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

  const total = await ActivityLog.countDocuments({
    createdAt: { $gte: last24h },
  });

  return { stats, dailyStats, total, timeframe: "24h" };
}

module.exports = { computeActivityStats };
