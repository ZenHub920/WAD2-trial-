/** Checkout is unavailable until a payment provider is configured; historical orders remain readable. */
import { cleanListing } from './ticketController.js';

export function createOrderController(repos) {
  return {
    buy(req, res) {
      res.status(503).json({ error: 'payment_provider_not_configured' });
    },

    /** Only the buyer can see their own order; anyone else gets 404. */
    get(req, res) {
      const order = repos.orders.findById(req.params.id);
      if (!order || order.buyer_user_id !== req.user.id) {
        return res.status(404).json({ error: 'order_not_found' });
      }
      res.json({ order: publicOrder(order, repos) });
    },
  };
}

function publicOrder(order, repos) {
  return {
    id: order.id,
    status: order.status,
    subtotalCents: order.subtotal_cents,
    deliveryFeeCents: order.delivery_fee_cents,
    totalCents: order.total_cents,
    currency: order.currency,
    paymentMethod: order.payment_method,
    createdAt: order.created_at,
    listing: cleanListing(repos.tickets.findById(order.ticket_id)),
    // The buyer owns these now, and this shape is only ever sent to the buyer.
    ticketNumbers: repos.tickets.ticketNumbers(order.ticket_id),
  };
}
