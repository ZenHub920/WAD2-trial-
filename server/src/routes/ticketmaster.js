import { Router } from 'express';
import { createTicketmasterController } from '../controllers/ticketmasterController.js';

export function createTicketmasterRoutes(db, provider) {
  const router = Router();
  const controller = createTicketmasterController(db, provider);

  router.get('/concerts/external', controller.discover);

  return router;
}
