import { publicUser } from './publicUser.js';
import { decodeTicketImage } from '../services/ticketImages.js';

function cleanListing(listing) {
  if (!listing) return null;
  const { seller_user_id, image_path, seller, ...fields } = listing;
  return { ...fields, seller: publicUser(seller) };
}

function validate(body, creating) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid_listing';
  if (creating) {
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
  if (body.imageData !== undefined && body.imageData !== null) {
    try { decodeTicketImage(body.imageData); } catch { return 'invalid_image'; }
  }
  return null;
}

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
      res.json({ listings: repos.tickets.forSeller(req.user.id).map(cleanListing) });
    },
    create(req, res) {
      const error = validate(req.body, true);
      if (error) return res.status(400).json({ error });
      let imagePath = null;
      try {
        if (req.body.imageData) imagePath = images.save(req.body.imageData);
        const { concert } = req.body;
        const listing = repos.tickets.create({
          seller_user_id: req.user.id,
          concert: {
            artist: concert.artist.trim(), venue: concert.venue.trim(),
            city: concert.city?.trim() || 'Singapore', event_date: concert.event_date,
          },
          priceCents: req.body.priceCents, quantity: req.body.quantity,
          section: req.body.section.trim(), description: req.body.description?.trim() ?? '',
          image_path: imagePath,
        });
        res.status(201).json({ listing: cleanListing(listing) });
      } catch (err) {
        images.remove(imagePath);
        throw err;
      }
    },
    update(req, res) {
      const current = repos.tickets.findById(req.params.id);
      if (!current || current.seller_user_id !== req.user.id || current.status !== 'active') {
        return res.status(404).json({ error: 'listing_not_found' });
      }
      const error = validate(req.body, false);
      if (error) return res.status(400).json({ error });
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
      res.json({ listing: cleanListing(listing) });
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
