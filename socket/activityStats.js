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
 *   statusStats: Array<{ _id: string, count: number }>,
 *   failureRate: number,
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

  // M9: Status breakdown — count per status (success/failed/pending) so the
  // dashboard can show failure rate and highlight issues.
  const statusStats = await ActivityLog.aggregate([
    {
      $match: {
        createdAt: { $gte: last24h },
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
    total > 0 ? Math.round((failedCount / total) * 1000) / 10 : 0;

  return { stats, dailyStats, statusStats, failureRate, total, timeframe: "24h" };
}

module.exports = { computeActivityStats };
