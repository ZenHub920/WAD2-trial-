/** Ticket market: browse resale listings and buy one. */
import { publicUser } from './publicUser.js';

const PAYMENT_METHODS = ['visa', 'mastercard', 'paypal', 'apple_pay'];

const ORDER_ERROR_STATUS = {
  listing_not_found: 404,
  listing_unavailable: 409,
  cannot_buy_own_listing: 409,
};

export function createMarketController(repos) {
  return {
    list(req, res) {
      const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
      res.json({ listings: repos.listings.listOpen({ query }).map(publicListing) });
    },

    detail(req, res) {
      const listing = repos.listings.findById(req.params.id);
      if (!listing) return res.status(404).json({ error: 'listing_not_found' });
      res.json({ listing: publicListing(listing) });
    },

    /** The buyer is the signed-in user; the price comes from the listing, never the request. */
    buy(req, res) {
      if (!PAYMENT_METHODS.includes(req.body?.payment_method)) {
        return res.status(400).json({ error: 'invalid_payment_method' });
      }
      try {
        const order = repos.orders.purchase({
          listing_id: req.params.id,
          buyer_user_id: req.user.id,
          payment_method: req.body.payment_method,
        });
        res.status(201).json({ order: publicOrder(order, repos) });
      } catch (err) {
        const status = ORDER_ERROR_STATUS[err.code];
        if (!status) throw err;
        res.status(status).json({ error: err.code });
      }
    },

    /** Only the buyer can see their own order. */
    order(req, res) {
      const order = repos.orders.findById(req.params.id);
      if (!order || order.buyer_user_id !== req.user.id) {
        return res.status(404).json({ error: 'order_not_found' });
      }
      res.json({ order: publicOrder(order, repos) });
    },
  };
}

function publicListing(listing) {
  return {
    id: listing.id,
    title: listing.title,
    category: listing.category,
    showDate: listing.show_date,
    seatRow: listing.seat_row,
    seatNumbers: listing.seat_numbers,
    quantity: listing.quantity,
    priceCents: listing.price_cents,
    currency: listing.currency,
    description: listing.description,
    imageUrl: listing.image_url ?? listing.concert.hero_image_url,
    verified: Boolean(listing.verified),
    status: listing.status,
    createdAt: listing.created_at,
    seller: publicUser(listing.seller),
    concert: {
      id: listing.concert.id,
      artist: listing.concert.artist,
      tourName: listing.concert.tour_name,
      venue: listing.concert.venue,
      city: listing.concert.city,
      eventDate: listing.concert.event_date,
    },
  };
}

function publicOrder(order, repos) {
  const listing = repos.listings.findById(order.listing_id);
  return {
    id: order.id,
    status: order.status,
    subtotalCents: order.subtotal_cents,
    deliveryFeeCents: order.delivery_fee_cents,
    totalCents: order.total_cents,
    currency: order.currency,
    paymentMethod: order.payment_method,
    buyerUserId: order.buyer_user_id,
    createdAt: order.created_at,
    listing: listing ? publicListing(listing) : null,
  };
}
