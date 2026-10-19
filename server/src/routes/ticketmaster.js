import { Router } from 'express';
import { createTicketmasterController } from '../controllers/ticketmasterController.js';

export function createTicketmasterRoutes(db) {
  const router = Router();
  const controller = createTicketmasterController(db);

  router.get('/concerts/external', controller.discover);

  return router;
}
