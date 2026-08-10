/**
 * Stock re-adjustment helper for the admin order edit flow (M3).
 *
 * Pure module: no req/res; receives the Product model as an argument so it can
 * be unit-tested in isolation with a stub collection.
 *
 * When an admin edits item quantities on a CASH order, product stock must be
 * re-synced against the ORDER's current quantities:
 *   delta > 0 (buyer ordered MORE units) → validate availability, then qty -d, sold +d
 *   delta < 0 (buyer ordered FEWER units) → restock, qty +|d|, sold -|d| (floored at 0)
 *
 * Availability is validated for ALL changed items BEFORE any mutation is
 * applied, so a shortage on one line never partially applies stock changes
 * (there is intentionally no DB transaction around the multi-item update —
 * validate-all-first mitigates that risk).
 */

/**
 * Compute the quantity delta for a change against the order's current item.
 * @param {{quantity?:number}|undefined} orderItem current cartItem (original qty)
 * @param {{quantity?:number}} change      incoming change { _id, quantity, color? }
 * @returns {number} delta (new - current); 0 means "no stock impact"
 *
 * A change is a stock edit ONLY when it carries an explicit `quantity` for an
 * item that actually exists on the order. Color-only changes (no quantity) and
 * changes that don't match an order line yield delta 0 — never a restock.
 */
const computeDelta = (orderItem, change) => {
  if (!orderItem || change.quantity === undefined) return 0;
  return change.quantity - (orderItem.quantity || 0);
};

/**
 * Normalize a cartItem.product reference (populated doc or ObjectId) to a
 * string id for safe matching against the change._id sent by the client.
 */
const toProductId = (item) =>
  item?.product?._id?.toString?.() ||
  item?.product?.toString?.() ||
  item?.product;

/**
 * Apply quantity deltas to product stock.
 *
 * @param {Object} order   order document (reads order.cartItems original qty)
 * @param {Array}  changes [{ _id: productId, quantity: newQty, color? }]
 * @param {Object} Product Product model (mongoose) — injected for testability
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
const applyQuantityDeltas = async (order, changes, Product) => {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: true };
  }

  const currentItems = (order.cartItems || []).map((item) => ({
    productId: toProductId(item),
    quantity: item.quantity || 0,
  }));

  // 1) Validate availability for ALL positive deltas before mutating anything.
  for (const change of changes) {
    const current = currentItems.find(
      (i) => i.productId === String(change._id)
    );
    const delta = computeDelta(current, change);
    if (delta <= 0) continue; // restocks never need availability checks

    const product = await Product.findById(change._id);
    if (!product) {
      return {
        ok: false,
        reason: `Product ${change._id} no longer exists — cannot increase quantity`,
      };
    }
    if (product.quantity < delta) {
      return {
        ok: false,
        reason: `Insufficient stock for product ${change._id}: need ${delta} more, only ${product.quantity} available`,
      };
    }
  }

  // 2) Apply the deltas (all validated → safe to apply).
  for (const change of changes) {
    const current = currentItems.find(
      (i) => i.productId === String(change._id)
    );
    const delta = computeDelta(current, change);
    if (delta === 0) continue;

    if (delta > 0) {
      // Buyer added units: consume stock, bump sold.
      await Product.updateOne(
        { _id: change._id },
        { $inc: { quantity: -delta, sold: +delta } }
      );
    } else {
      // Buyer removed units: restock, decrement sold (floored at 0 — same
      // pattern as cancelOrder in orderServices.js).
      const restock = Math.abs(delta);
      await Product.updateOne(
        { _id: change._id },
        [
          {
            $set: {
              quantity: { $add: ["$quantity", restock] },
              sold: { $max: [{ $subtract: ["$sold", restock] }, 0] },
            },
          },
        ]
      );
    }
  }

  return { ok: true };
};

module.exports = { applyQuantityDeltas, computeDelta };
