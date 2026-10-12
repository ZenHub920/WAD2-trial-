import '../config/loadEnv.js';
import { getDb, closeDb } from './connection.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || process.argv.length !== 3) {
  console.error('Usage: npm run operator:grant -- <existing-email>');
  process.exitCode = 1;
} else {
  try {
    const db = getDb();
    const update = db.prepare('UPDATE users SET is_operator = 1 WHERE lower(email) = ?').run(email);
    if (!update.changes) {
      console.error(`No existing account for ${email}`);
      process.exitCode = 1;
    } else {
      console.log(`Operator granted to ${email}`);
    }
  } finally {
    closeDb();
  }
}
