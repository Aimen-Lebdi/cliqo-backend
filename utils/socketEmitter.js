// Utility for managing socket instance across the application
class SocketEmitter {
  constructor() {
    this.socketInstance = null;
  }

  setSocket(socketInstance) {
    this.socketInstance = socketInstance;
  }

  getSocket() {
    return this.socketInstance;
  }

  // Convenience method - emits to the dashboard room (admin live feed)
  emitToDashboard(event, data) {
    if (this.socketInstance) {
      this.socketInstance.emitToDashboard(event, data);
    }
  }

  // Whether at least one admin is currently in the dashboard room
  hasDashboardListeners() {
    return this.socketInstance
      ? this.socketInstance.hasDashboardListeners()
      : false;
  }
}

// Export singleton instance
module.exports = new SocketEmitter();
