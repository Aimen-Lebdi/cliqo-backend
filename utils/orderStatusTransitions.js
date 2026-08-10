/**
 * Order delivery-status transition rules — single source of truth for the
 * admin order edit flow (M1). Pure module: no DB, no request/response, so it
 * can be unit-tested in isolation.
 *
 * Forward chain (enforced step-by-step):
 *   pending → confirmed → shipped → in_transit → out_for_delivery → delivered → completed
 *
 * Any NON-terminal state may abort to a terminal state (failed / returned /
 * cancelled). Terminal states (cancelled, failed, returned, completed) are
 * locked and have NO outgoing transitions.
 */

// Every deliveryStatus value accepted by the Order model (kept in sync with
// backend/models/orderModel.js). Used for enum validation.
const ORDER_STATUSES = Object.freeze([
  "pending",
  "confirmed",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "completed",
  "failed",
  "returned",
  "cancelled",
]);

// The forward progression chain, in order.
const FORWARD_CHAIN = Object.freeze([
  "pending",
  "confirmed",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "completed",
]);

// Terminal states: once reached the order is locked (no outgoing transitions).
const TERMINAL_STATES = Object.freeze([
  "cancelled",
  "failed",
  "returned",
  "completed",
]);

// States any non-terminal order may abort to.
const ABORT_STATES = Object.freeze(["failed", "returned", "cancelled"]);

// Source state → allowed target states (explicit adjacency map).
const TRANSITIONS = Object.freeze({
  pending: ["confirmed", "failed", "returned", "cancelled"],
  confirmed: ["shipped", "failed", "returned", "cancelled"],
  shipped: ["in_transit", "failed", "returned", "cancelled"],
  in_transit: ["out_for_delivery", "failed", "returned", "cancelled"],
  out_for_delivery: ["delivered", "failed", "returned", "cancelled"],
  delivered: ["completed", "failed", "returned", "cancelled"],
  completed: [],
  failed: [],
  returned: [],
  cancelled: [],
});

/**
 * True when moving `to` from `from` is permitted by the transition rules.
 * Same-state moves and terminal states always return false.
 */
const isAllowedTransition = (from, to) => {
  if (!from || !to) return false;
  const allowed = TRANSITIONS[from];
  return Boolean(allowed) && allowed.includes(to);
};

/**
 * Statuses reachable from `from` (empty array for terminal/unknown states).
 * Returns a fresh copy so callers can safely mutate the result.
 */
const getNextAllowedStatuses = (from) => {
  const allowed = TRANSITIONS[from];
  return allowed ? [...allowed] : [];
};

/** True when the state is terminal (locked, no outgoing transitions). */
const isTerminalState = (state) => TERMINAL_STATES.includes(state);

module.exports = {
  ORDER_STATUSES,
  FORWARD_CHAIN,
  TERMINAL_STATES,
  ABORT_STATES,
  TRANSITIONS,
  isAllowedTransition,
  getNextAllowedStatuses,
  isTerminalState,
};
