import '../config/loadEnv.js';
import { getDb, closeDb } from './connection.js';
import { importTicketmasterConcerts } from './ticketmasterConcerts.js';
import { searchTicketmaster } from '../services/ticketmaster.js';

try {
  const concerts = await searchTicketmaster();
  const db = getDb();
  console.log(`Imported ${importTicketmasterConcerts(db, concerts)} upcoming Singapore concerts from Ticketmaster.`);
} catch (error) {
  console.error(`Concert sync failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  closeDb();
}
