import './config/loadEnv.js';
import { createApp } from './app.js';
import { closeDb } from './db/connection.js';

const port = Number(process.env.PORT ?? 3000);
const { app, delivery, security } = createApp();

const server = app.listen(port, () => {
  if (process.env.ENABLE_BACKGROUND_JOBS !== 'false')
    delivery.start({ intervalMs: Math.max(1000, Number(process.env.BACKGROUND_JOB_INTERVAL_MS) || 15000) });
  console.log(`Encore API listening on http://localhost:${port}`);
  console.log(`  GET  /api/concerts`);
  console.log(`  GET  /api/concerts/:id/match/preview?baselines=true (trace requires operator)`);
  console.log(`  POST /api/concerts/:id/match (operator only)`);
  console.log(`  GET  /api/rounds/:id/verify (operator only)`);
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await delivery.stop();
  await security.close();
  closeDb();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
