import './config/loadEnv.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const { app } = createApp();

app.listen(port, () => {
  console.log(`Encore API listening on http://localhost:${port}`);
  console.log(`  GET  /api/concerts`);
  console.log(`  GET  /api/concerts/:id/match/preview?baselines=true (trace requires operator)`);
  console.log(`  POST /api/concerts/:id/match (operator only)`);
  console.log(`  GET  /api/rounds/:id/verify (operator only)`);
});
