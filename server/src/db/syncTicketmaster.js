import '../config/loadEnv.js';
import { getDb, closeDb } from './connection.js';
import { createConcertProvider } from '../services/concertProvider.js';

try {
  const db = getDb();
  const result = await createConcertProvider({ db }).sync();
  console.log(`Refreshed ${result.count} upcoming Singapore concerts from Ticketmaster.`);
} catch (error) {
  console.error(`Concert sync failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  closeDb();
}
