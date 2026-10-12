import { publicUser } from './publicUser.js';
import { decodeTicketImage } from '../services/ticketImages.js';

function cleanListing(listing) {
  if (!listing) return null;
  const { seller_user_id, image_path, seller, verification, ...fields } = listing;
  return { ...fields, seller: publicUser(seller) };
}

/** The seller's (or an operator's) view: the public listing plus review state and ticket numbers. */
export function ownerListing(listing, repos) {
  if (!listing) return null;
  return {
    ...cleanListing(listing),
    verification: listing.verification,
    ticketNumbers: repos.tickets.ticketNumbers(listing.id),
  };
}

/** Ticket-number problems a seller can fix, each reported with the number that caused it. */
const TICKET_NUMBER_ERRORS = {
  duplicate_ticket_number: 400,
  ticket_number_not_issued: 400,
  ticket_category_mismatch: 400,
  ticket_number_already_listed: 409,
};

// Letters, digits, spaces and dashes, as printed on tickets; spaces and dashes match each other.
export const TICKET_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/;

// Proof arrives as a data URL; ~3M chars is about 2MB of file, well under the JSON body limit.
const MAX_PROOF_CHARS = 3_000_000;

/** Proof of purchase: a screenshot or PDF of the order confirmation or e-ticket. */
function validateProof(value, { required = false } = {}) {
  if (value === undefined || value === null) return required ? 'proof_required' : null;
  if (typeof value !== 'string' || !/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/.test(value)) {
    return 'proof_must_be_an_image_or_pdf';
  }
  if (value.length > MAX_PROOF_CHARS) return 'proof_too_large';
  return null;
}

function validate(body, creating) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid_listing';
  if (creating && body.concertId !== undefined) {
    // Listing against an existing concert, which is what lets ticket numbers be
    // checked against that concert's issued list.
    if (typeof body.concertId !== 'string' || !body.concertId) return 'invalid_concert';
    if (body.concert !== undefined) return 'concert_or_concert_id_not_both';
  } else if (creating) {
    const concert = body.concert;
    if (!concert || typeof concert !== 'object' || Array.isArray(concert)) return 'invalid_concert';
    if (typeof concert.artist !== 'string' || !concert.artist.trim()
      || typeof concert.venue !== 'string' || !concert.venue.trim()) return 'invalid_concert';
    const date = concert.event_date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return 'invalid_concert_date';
    if (concert.city !== undefined && (typeof concert.city !== 'string' || !concert.city.trim())) return 'invalid_concert';
  } else if (body.concert !== undefined) return 'concert_not_editable';
  if ((creating || body.priceCents !== undefined)
    && (!Number.isSafeInteger(body.priceCents) || body.priceCents < 0)) return 'invalid_price';
  if ((creating || body.quantity !== undefined)
    && (!Number.isSafeInteger(body.quantity) || body.quantity < 1)) return 'invalid_quantity';
  if ((creating || body.section !== undefined)
    && (typeof body.section !== 'string' || !body.section.trim() || body.section.length > 120)) return 'invalid_section';
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 2000)) return 'invalid_description';
  if (creating && body.ticketNumbers !== undefined) {
    const numbers = body.ticketNumbers;
    if (!Array.isArray(numbers) || numbers.length !== body.quantity) return 'one_ticket_number_per_ticket';
    if (!numbers.every((n) => typeof n === 'string' && TICKET_NUMBER.test(n.trim()))) {
      return 'invalid_ticket_number';
    }
  }
  if (creating) {
    const proofError = validateProof(body.proofData);
    if (proofError) return proofError;
  }
  if (body.imageData !== undefined && body.imageData !== null) {
    try { decodeTicketImage(body.imageData); } catch { return 'invalid_image'; }
  }
  return null;
}

export { cleanListing };

export function createTicketController(repos, images) {
  return {
    list(req, res) {
      res.json({ listings: repos.tickets.list().map(cleanListing) });
    },
    detail(req, res) {
      const listing = repos.tickets.findById(req.params.id);
      if (!listing) return res.status(404).json({ error: 'listing_not_found' });
      res.json({ listing: cleanListing(listing) });
    },
    mine(req, res) {
      res.json({ listings: repos.tickets.forSeller(req.user.id).map((l) => ownerListing(l, repos)) });
    },
    create(req, res) {
      const error = validate(req.body, true);
      if (error) return res.status(400).json({ error });
      if (req.body.concertId && !repos.concerts.findById(req.body.concertId)) {
        return res.status(400).json({ error: 'concert_not_found' });
      }
      let imagePath = null;
      try {
        if (req.body.imageData) imagePath = images.save(req.body.imageData);
        const { concert } = req.body;
        const listing = repos.tickets.create({
          seller_user_id: req.user.id,
          concertId: req.body.concertId,
          concert: concert && {
            artist: concert.artist.trim(), venue: concert.venue.trim(),
            city: concert.city?.trim() || 'Singapore', event_date: concert.event_date,
          },
          priceCents: req.body.priceCents, quantity: req.body.quantity,
          section: req.body.section.trim(), description: req.body.description?.trim() ?? '',
          image_path: imagePath,
          ticket_numbers: req.body.ticketNumbers ?? [],
          proof_data: req.body.proofData ?? null,
        });
        res.status(201).json({ listing: ownerListing(listing, repos) });
      } catch (err) {
        images.remove(imagePath);
        const status = TICKET_NUMBER_ERRORS[err.code];
        if (!status) throw err;
        res.status(status).json({ error: err.code, ticketNumber: err.detail });
      }
    },
    update(req, res) {
      const current = repos.tickets.findById(req.params.id);
      if (!current || current.seller_user_id !== req.user.id || current.status !== 'active') {
        return res.status(404).json({ error: 'listing_not_found' });
      }
      const error = validate(req.body, false);
      if (error) return res.status(400).json({ error });
      // Ticket numbers are one per ticket, so the count is fixed once numbers are attached.
      if (req.body.quantity !== undefined && req.body.quantity !== current.quantity
        && repos.tickets.ticketNumbers(current.id).length) {
        return res.status(400).json({ error: 'quantity_locked_by_ticket_numbers' });
      }
      let imagePath = current.image_path;
      let listing;
      try {
        if (req.body.imageData === null) imagePath = null;
        else if (req.body.imageData !== undefined) imagePath = images.save(req.body.imageData);
        listing = repos.tickets.updateOwned(current.id, req.user.id, {
          priceCents: req.body.priceCents ?? current.priceCents,
          quantity: req.body.quantity ?? current.quantity,
          section: req.body.section?.trim() ?? current.section,
          description: req.body.description?.trim() ?? current.description,
          image_path: imagePath,
        });
        if (!listing) {
          if (imagePath !== current.image_path) images.remove(imagePath);
          return res.status(404).json({ error: 'listing_not_found' });
        }
      } catch (err) {
        if (imagePath !== current.image_path) images.remove(imagePath);
        throw err;
      }
      if (imagePath !== current.image_path) images.remove(current.image_path);
      res.json({ listing: ownerListing(listing, repos) });
    },
    /** Seller uploads proof of purchase for one of their active listings. */
    submitProof(req, res) {
      const error = validateProof(req.body?.proofData, { required: true });
      if (error) return res.status(400).json({ error });
      if (!repos.tickets.submitProof(req.params.id, req.user.id, req.body.proofData)) {
        // Not theirs, not active, or already approved — none of which a seller can change.
        return res.status(409).json({ error: 'cannot_submit_proof' });
      }
      res.json({ listing: ownerListing(repos.tickets.findById(req.params.id), repos) });
    },
    delete(req, res) {
      const current = repos.tickets.findById(req.params.id);
      if (!current || current.seller_user_id !== req.user.id || !repos.tickets.deleteOwned(current.id, req.user.id)) {
        return res.status(404).json({ error: 'listing_not_found' });
      }
      images.remove(current.image_path);
      res.status(204).end();
    },
  };
}
