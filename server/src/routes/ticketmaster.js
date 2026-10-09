import { Router } from 'express';
import { searchTicketmaster } from '../services/ticketmaster.js';

export function createTicketmasterRoutes() {
  const router = Router();

  router.get('/concerts/external', async (req, res) => {
    if (!process.env.TICKETMASTER_API_KEY) {
      return res.status(503).json({ error: 'concert_provider_not_configured' });
    }
    const keyword = req.query.keyword;
    if (keyword !== undefined && (typeof keyword !== 'string' || keyword.length > 100)) {
      return res.status(400).json({ error: 'invalid_keyword' });
    }
    try {
      const events = await searchTicketmaster({ keyword: keyword?.trim() });
      res.json({ events });
    } catch {
      res.status(502).json({ error: 'concert_provider_unavailable' });
    }
  });

  return router;
}
