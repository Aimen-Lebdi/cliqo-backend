/**
 * Order "recovery" operations shared by the cancel and webhook-driven
 * `returned` flows (M1).
 *
 * Pure module: no req/res. The Product model and Stripe client are passed in
 * as arguments so this can be unit-tested in isolation with stubs.
 *
 * - `restockOrderItems` restores product stock and decrements the sold count
 *   (floored at 0) — ported verbatim from cancelOrder.
 * - `refundCardOrder` issues a real Stripe refund for card orders. It only
 *   marks paymentStatus "refunded" when the refund actually succeeded — never
 *   when there is no PaymentIntent or the refund API call failed (that would
 *   silently lose money). Writes `refund_failed` / `payment_refunded` entries
 *   into `order.statusHistory`.
 */

/**
 * Restore product stock and decrement sold count (floored at 0).
 * Mutates the DB via Product.updateOne for each order line; the order doc
 * itself is untouched.
 *
 * @param {{cartItems?: Array<{product: unknown, quantity: number}>}} order
 *   Mongoose order doc (or plain object) with cartItems.
 * @param {{updateOne: Function}} Product Mongoose Product model (injected for
 *   testability).
 */
const restockOrderItems = async (order, Product) => {
  if (order.cartItems && order.cartItems.length > 0) {
    for (const item of order.cartItems) {
      await Product.updateOne(
        { _id: item.product },
        [
          {
            $set: {
              quantity: { $add: ["$quantity", item.quantity] },
              sold: { $max: [{ $subtract: ["$sold", item.quantity] }, 0] },
            },
          },
        ]
      );
    }
  }
};

/**
 * Refund a card order via Stripe (best-effort, never throws).
 *
 * Refunds only when the order is a card order that is actually paid
 * (paymentMethodType "card", paymentStatus authorized/confirmed, isPaid).
 * On success marks the order `refunded` + `isPaid = false` and pushes a
 * `payment_refunded` history entry. On any failure (missing PaymentIntent or a
 * Stripe API error) it pushes a `refund_failed` history entry and leaves the
 * payment status untouched — the caller decides whether to surface it.
 *
 * @param {object} order Mongoose order doc; mutated in place.
 * @param {object} stripe Stripe client (injected for testability).
 * @param {string} [updatedBy="system"] Who triggered the refund (e.g.
 *   "seller", "customer", "system", "delivery_agency").
 * @returns {Promise<boolean>} true when a refund was actually issued.
 */
const refundCardOrder = async (order, stripe, updatedBy = "system") => {
  const shouldRefund =
    order.paymentMethodType === "card" &&
    ["authorized", "confirmed"].includes(order.paymentStatus) &&
    order.isPaid;

  if (!shouldRefund) {
    return false;
  }

  if (!order.stripePaymentIntentId) {
    console.warn(
      `Cannot refund order ${order._id}: no stripePaymentIntentId. Payment NOT marked as refunded.`
    );
    order.statusHistory.push({
      status: "refund_failed",
      note: "Refund could not be issued: missing Stripe PaymentIntent ID. Payment left unchanged.",
      updatedBy,
    });
    return false;
  }

  try {
    const refundResult = await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId,
    });
    console.log(
      `↩️ Stripe refund created for order ${order._id}: ${refundResult.id}`
    );
    order.paymentStatus = "refunded";
    order.isPaid = false;
    order.statusHistory.push({
      status: "payment_refunded",
      note: `Payment refunded via Stripe. Refund ID: ${refundResult.id}`,
      updatedBy,
    });
    return true;
  } catch (error) {
    console.error(
      `Failed to refund Stripe payment for order ${order._id}:`,
      error.message
    );
    order.statusHistory.push({
      status: "refund_failed",
      note: `Refund failed: ${error.message}. Payment NOT marked as refunded.`,
      updatedBy,
    });
    return false;
  }
};

module.exports = { restockOrderItems, refundCardOrder };
