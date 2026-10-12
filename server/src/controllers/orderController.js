/** Buying a ticket listing, and the buyer's receipt. Payment is simulated. */
import { cleanListing } from './ticketController.js';

const PAYMENT_METHODS = ['visa', 'mastercard', 'paypal', 'apple_pay'];

const ORDER_ERROR_STATUS = {
  listing_not_found: 404,
  listing_unavailable: 409,
  cannot_buy_own_listing: 409,
};

export function createOrderController(repos) {
  return {
    /** The buyer is the signed-in user; the price comes from the listing, never the request. */
    buy(req, res) {
      if (!PAYMENT_METHODS.includes(req.body?.paymentMethod)) {
        return res.status(400).json({ error: 'invalid_payment_method' });
      }
      try {
        const order = repos.orders.purchase({
          ticket_id: req.params.id,
          buyer_user_id: req.user.id,
          payment_method: req.body.paymentMethod,
        });
        res.status(201).json({ order: publicOrder(order, repos) });
      } catch (err) {
        const status = ORDER_ERROR_STATUS[err.code];
        if (!status) throw err;
        res.status(status).json({ error: err.code });
      }
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
