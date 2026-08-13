// Socket event handlers for different activities
const { computeActivityStats } = require("./activityStats");
const User = require("../models/userModel");

class SocketHandlers {
  constructor(io) {
    this.io = io;
  }

  // A1: Re-validate admin authorization on privileged events. The handshake
  // middleware captures a snapshot (socket.user) that can go stale (role
  // demoted, account deactivated, etc.), so we re-fetch from the DB here.
  // On success the snapshot is refreshed (A3) so subsequent events use fresh
  // data. On failure we emit the given error event, leave the dashboard room
  // and force-close the socket.
  async ensureAuthorizedAdmin(socket, errorEvent) {
    try {
      const freshUser = await User.findById(socket.user?._id).select("-password");

      if (!freshUser || !freshUser.active || freshUser.role !== "admin") {
        throw new Error("Access denied: Admin role required");
      }

      // A3: Refresh the cached snapshot for subsequent events
      socket.user = freshUser;
      return freshUser;
    } catch (error) {
      console.error(
        `⚠️ Admin authorization failed for socket ${socket.id}: ${error.message}`
      );
      socket.emit(errorEvent, { message: error.message });
      socket.leave("dashboard");
      // Force close — a deactivated/demoted admin must not keep a live
      // connection or keep receiving dashboard events.
      socket.disconnect(true);
      return null;
    }
  }

  // Handle activity-related events
  handleActivityEvents(socket) {
    // FIXED: Separate handler for join_dashboard - only send activities after joining
    socket.on("join_dashboard", async () => {
      // A2: Re-validate admin auth (role/active may have changed since handshake)
      const freshUser = await this.ensureAuthorizedAdmin(socket, "dashboard_error");
      if (!freshUser) return;

      try {
        // Join the dashboard room first
        socket.join("dashboard");
        console.log(`📊 Admin ${socket.user.name} joined dashboard room`);
        
        // Emit join confirmation
        socket.emit("dashboard_joined", {
          message: "Successfully joined dashboard",
        });

        // THEN send initial activities (only if not already sent)
        if (!socket.hasReceivedInitialActivities) {
          const ActivityLog = require("../models/activityLogModel");

          const recentActivities = await ActivityLog.find({})
            .sort({ createdAt: -1 })
            .limit(20)
            .select({
              type: 1,
              activity: 1,
              user: 1,
              description: 1,
              status: 1,
              amount: 1,
              createdAt: 1,
            });

          socket.hasReceivedInitialActivities = true;

          socket.emit("initial_activities", {
            activities: recentActivities,
            timestamp: new Date(),
          });

          console.log(`✅ Admin ${socket.user.name} received ${recentActivities.length} initial activities`);
        }
      } catch (error) {
        console.error("Error in join_dashboard:", error);
        socket.emit("activity_error", {
          message: "Failed to join dashboard or load activities",
        });
      }
    });

    // Handle leaving the dashboard - reset the initial-activities flag so a
    // subsequent join_dashboard re-sends the initial activity list.
    socket.on("leave_dashboard", () => {
      socket.leave("dashboard");
      socket.hasReceivedInitialActivities = false;
      console.log(`👋 User ${socket.user.name} left dashboard room`);
      socket.emit("dashboard_left", { message: "Left dashboard room" });
    });

    // Handle activity filters
    socket.on("filter_activities", async (filters) => {
      // A2: Re-validate admin auth (role/active may have changed since handshake)
      const freshUser = await this.ensureAuthorizedAdmin(socket, "activity_error");
      if (!freshUser) return;

      try {
        const ActivityLog = require("../models/activityLogModel");

        let query = {};

        // Apply filters
        if (filters.type && filters.type !== "all") {
          query.type = filters.type;
        }

        if (filters.timeframe) {
          const now = new Date();
          let startDate = new Date();

          switch (filters.timeframe) {
            case "1h":
              startDate.setHours(now.getHours() - 1);
              break;
            case "24h":
              startDate.setDate(now.getDate() - 1);
              break;
            case "7d":
              startDate.setDate(now.getDate() - 7);
              break;
            case "30d":
              startDate.setDate(now.getDate() - 30);
              break;
          }

          if (filters.timeframe !== "all") {
            query.createdAt = { $gte: startDate };
          }
        }

        const filteredActivities = await ActivityLog.find(query)
          .sort({ createdAt: -1 })
          .limit(50)
          .select({
            type: 1,
            activity: 1,
            user: 1,
            description: 1,
            status: 1,
            amount: 1,
            createdAt: 1,
          });

        socket.emit("filtered_activities", {
          activities: filteredActivities,
          filters: filters,
          timestamp: new Date(),
        });

        console.log(`🔍 Filtered ${filteredActivities.length} activities for ${socket.user.name}`);
      } catch (error) {
        console.error("Error filtering activities:", error);
        socket.emit("activity_error", {
          message: "Failed to filter activities",
        });
      }
    });

    // Handle real-time activity requests
    socket.on("request_activity_stats", async () => {
      // A2: Re-validate admin auth (role/active may have changed since handshake)
      const freshUser = await this.ensureAuthorizedAdmin(socket, "activity_error");
      if (!freshUser) return;

      try {
        // FIXED (M6): Use the shared stats helper (also used by the activity
        // logger to push live stats) to avoid duplicated aggregation queries.
        const realtimeStats = await computeActivityStats();

        socket.emit("activity_stats", {
          ...realtimeStats,
          timestamp: new Date(),
        });

        console.log(`📊 Sent activity stats to ${socket.user.name}`);
      } catch (error) {
        console.error("Error getting activity stats:", error);
        socket.emit("activity_error", { message: "Failed to get stats" });
      }
    });
  }

  // Setup all handlers
  setupHandlers(socket) {
    this.handleActivityEvents(socket);

    // Add more handler categories as needed
    // this.handleOrderEvents(socket);
    // this.handleProductEvents(socket);
  }
}

module.exports = SocketHandlers;