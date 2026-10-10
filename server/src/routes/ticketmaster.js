import { Router } from 'express';
import { discoverTicketmaster } from '../controllers/ticketmasterController.js';

export function createTicketmasterRoutes() {
  const router = Router();

  router.get('/concerts/external', discoverTicketmaster);

  return router;
}
