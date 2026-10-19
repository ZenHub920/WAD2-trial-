import { searchTicketmaster } from '../services/ticketmaster.js';
import { importTicketmasterConcerts } from '../db/ticketmasterConcerts.js';

export function createTicketmasterController(db) {
  return {
    async discover(req, res, next) {
      if (!process.env.TICKETMASTER_API_KEY) {
        return res.status(503).json({ error: 'concert_provider_not_configured' });
      }
      const keyword = req.query.keyword;
      if (keyword !== undefined && (typeof keyword !== 'string' || keyword.length > 100)) {
        return res.status(400).json({ error: 'invalid_keyword' });
      }
      let events;
      try {
        events = await searchTicketmaster({ keyword: keyword?.trim() });
      } catch {
        return res.status(502).json({ error: 'concert_provider_unavailable' });
      }
      try {
        importTicketmasterConcerts(db, events);
        res.json({ events });
      } catch (error) {
        next(error);
      }
    },
  };
}
