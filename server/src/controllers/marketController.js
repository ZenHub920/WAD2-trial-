/** Ticket market: browse resale listings and buy one. */
import { publicUser } from './publicUser.js';

const PAYMENT_METHODS = ['visa', 'mastercard', 'paypal', 'apple_pay'];

/** Ticket-number problems a seller can fix, with the number that caused each. */
const TICKET_NUMBER_ERRORS = {
  duplicate_ticket_number: 400,
  ticket_number_not_issued: 400,
  ticket_category_mismatch: 400,
  ticket_number_already_listed: 409,
};

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

    /** List a ticket for sale as the signed-in user. */
    create(req, res) {
      const error = validateListing(req.body);
      if (error) return res.status(400).json({ error });
      if (!repos.concerts.findById(req.body.concert_id)) {
        return res.status(400).json({ error: 'concert_not_found' });
      }
      let listing;
      try {
        listing = repos.listings.create({
          ticket_numbers: req.body.ticket_numbers ?? [],
          seller_user_id: req.user.id,
          concert_id: req.body.concert_id,
          title: req.body.title.trim(),
          category: req.body.category.trim(),
          show_date: req.body.show_date ?? null,
          seat_row: optionalText(req.body.seat_row),
          seat_numbers: optionalText(req.body.seat_numbers),
          quantity: req.body.quantity,
          price_cents: req.body.price_cents,
          description: optionalText(req.body.description),
          image_url: req.body.image_url ?? null,
          proof_data: req.body.proof_data ?? null,
        });
      } catch (err) {
        const status = TICKET_NUMBER_ERRORS[err.code];
        if (!status) throw err;
        return res.status(status).json({ error: err.code, ticketNumber: err.detail });
      }
      res.status(201).json({ listing: ownerListing(listing, repos) });
    },

    mine(req, res) {
      res.json({ listings: repos.listings.forSeller(req.user.id).map((l) => ownerListing(l, repos)) });
    },

    /** Seller uploads proof of purchase for one of their open listings. */
    submitProof(req, res) {
      const error = validateProof(req.body?.proof_data, { required: true });
      if (error) return res.status(400).json({ error });
      if (!repos.listings.submitProof(req.params.id, req.user.id, req.body.proof_data)) {
        // Not theirs, not open, or already approved — none of which a seller can change.
        return res.status(409).json({ error: 'cannot_submit_proof' });
      }
      res.json({ listing: ownerListing(repos.listings.findById(req.params.id), repos) });
    },

    withdraw(req, res) {
      if (!repos.listings.withdrawOwned(req.params.id, req.user.id)) {
        return res.status(404).json({ error: 'listing_not_found' });
      }
      res.status(204).end();
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

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Images arrive as data URLs from the listing form; cap them well under the JSON body limit.
const MAX_IMAGE_CHARS = 3_000_000;

function validateListing(body = {}) {
  if (typeof body.concert_id !== 'string' || !body.concert_id) return 'concert_id_required';
  if (typeof body.title !== 'string' || !body.title.trim()) return 'title_required';
  if (typeof body.category !== 'string' || !body.category.trim()) return 'category_required';
  if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 10) {
    return 'quantity_must_be_1_to_10';
  }
  if (!Number.isInteger(body.price_cents) || body.price_cents < 1) return 'price_must_be_positive';
  if (body.show_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(body.show_date)) return 'invalid_show_date';
  if (body.ticket_numbers != null) {
    const numbers = body.ticket_numbers;
    if (!Array.isArray(numbers) || numbers.length !== body.quantity) {
      return 'one_ticket_number_per_ticket';
    }
    if (!numbers.every((n) => typeof n === 'string' && TICKET_NUMBER.test(n.trim()))) {
      return 'invalid_ticket_number';
    }
  }
  const proofError = validateProof(body.proof_data);
  if (proofError) return proofError;
  if (body.image_url != null) {
    if (typeof body.image_url !== 'string' || !body.image_url.startsWith('data:image/')) {
      return 'image_must_be_a_data_url';
    }
    if (body.image_url.length > MAX_IMAGE_CHARS) return 'image_too_large';
  }
  return null;
}

// Letters, digits, spaces and dashes, as printed on tickets; spaces and dashes match each other.
const TICKET_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/;

/** Proof is a screenshot or PDF of the purchase confirmation, sent as a data URL. */
function validateProof(value, { required = false } = {}) {
  if (value == null) return required ? 'proof_required' : null;
  if (typeof value !== 'string' || !/^data:(image\/[a-z+.-]+|application\/pdf);base64,/.test(value)) {
    return 'proof_must_be_an_image_or_pdf';
  }
  if (value.length > MAX_IMAGE_CHARS) return 'proof_too_large';
  return null;
}

/** What the seller sees of their own listing: the public view plus review progress. */
export function ownerListing(listing, repos) {
  return {
    ...publicListing(listing),
    ticketNumbers: repos ? repos.listings.ticketNumbers(listing.id) : undefined,
    verification: {
      status: listing.verification_status ?? 'none',
      method: listing.verification_method,
      note: listing.review_note,
      reviewedAt: listing.reviewed_at,
      hasProof: listing.has_proof,
    },
  };
}

export function publicListing(listing) {
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
    // The buyer owns these now; publicOrder is only ever sent to the buyer.
    ticketNumbers: repos.listings.ticketNumbers(order.listing_id),
  };
}
