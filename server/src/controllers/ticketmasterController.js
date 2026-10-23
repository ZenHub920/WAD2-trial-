import { createConcertProvider } from '../services/concertProvider.js';

export function createTicketmasterController(db, provider = createConcertProvider({db})) {
  return {
    async discover(req, res, next) {
      const keyword = req.query.keyword;
      if (keyword !== undefined && (typeof keyword !== 'string' || keyword.length > 100)) {
        return res.status(400).json({ error: 'invalid_keyword' });
      }
      try {
        res.json(await provider.discover({ keyword: keyword?.trim() }));
      } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
      }
    },
  };
}
