// Standalone browser-test harness. Never imported by the production server.
// Uses an in-memory database, loopback binding and no environment-file loading.
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createApp } from '../src/app.js';
import { createTestDb } from '../src/db/connection.js';
import { makeUser, makeParty, makeSeeker } from '../test/helpers.js';

const directory = mkdtempSync(join(tmpdir(), 'encore-e2e-'));
const db = createTestDb();
const env = { NODE_ENV: 'test', APP_ORIGIN: 'http://127.0.0.1:5175',
  ONEMAP_TOKEN: 'synthetic-browser-test-token', LTA_ACCOUNT_KEY: 'synthetic-browser-test-key' };
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
async function testProvider(url) {
  const target = new URL(url);
  if (target.pathname.endsWith('/common/elastic/search')) return json({ results: [{ SEARCHVAL: 'SINGAPORE INDOOR STADIUM', ADDRESS: '2 STADIUM WALK', LATITUDE: '1.3028', LONGITUDE: '103.8743' }] });
  if (target.pathname.endsWith('/getNearestMrtStops')) {
    const venue = Number(target.searchParams.get('latitude')) > 1.3;
    return json(venue ? [{ id: 'CC6', name: 'STADIUM MRT STATION', lat: 1.3028, lon: 103.875, road: 'Stadium Walk' }]
      : [{ id: 'EW13|NS25', name: 'CITY HALL MRT STATION', lat: 1.293, lon: 103.852, road: 'North Bridge Road' }]);
  }
  if (target.pathname.endsWith('/getNearestBusStops')) {
    const venue = Number(target.searchParams.get('latitude')) > 1.3;
    return json([{ id: venue ? '80199' : '04167', name: venue ? 'Singapore Indoor Stadium bus stop' : 'City Hall bus stop', lat: venue ? 1.3025 : 1.2932, lon: venue ? 103.874 : 103.8522 }]);
  }
  if (target.pathname.endsWith('/TrainServiceAlerts')) return json({ value: { Status: 1, Message: [], AffectedSegments: [] } });
  if (target.pathname.endsWith('/PCDRealTime')) return json({ value: [
    { Station: 'CC6', CrowdLevel: 'h', StartTime: new Date().toISOString() },
    { Station: 'EW13', CrowdLevel: 'l', StartTime: new Date().toISOString() },
    { Station: 'NS1', CrowdLevel: 'h', StartTime: new Date().toISOString() },
  ] });
  if (target.pathname.endsWith('/v3/BusArrival')) return json({ Services: [{ ServiceNo: '11', NextBus: { Load: 'LSD' }, NextBus2: { Load: 'SEA' } }] });
  if (target.pathname.endsWith('/public/routingsvc/route')) return json({}); // Exercise the real unavailable-route fallback.
  return new Response('{}', { status: 503 });
}
const application = createApp({
  db, env, imageDir: join(directory, 'tickets'), avatarDir: join(directory, 'avatars'),
  mailer: { send: async () => {} },
  // Controlled public transport fixtures; route/weather fallback remains real.
  // No external network request or real provider credential is used.
  fetchImpl: testProvider,
  webPush: { setVapidDetails() {}, sendNotification: async () => ({ statusCode: 201 }) },
  ratePolicies: {},
});
const { app, repos } = application;
const harness = express();
harness.use(express.json());
let sequence = 0;
harness.post('/__test/fixture', (req, res, next) => {
  try {
    const suffix = String(++sequence), concertId = `e2e_concert_${suffix}`;
    const users = Object.fromEntries(['hostA', 'hostB', 'friendA', 'friendB', 'seeker', 'outsider']
      .map(who => [who, `${who}_${suffix}`]));
    const sessions = {};
    for (const [who, id] of Object.entries(users)) {
      repos.users.create(makeUser(id, { display_name: who, email: `${id}@example.test` }));
      repos.membership.savePreferences(id, { about: ['supper', 'singalong'], wants: ['supper'], avoid: [] });
      const token = randomBytes(32).toString('hex');
      repos.sessions.create(createHash('sha256').update(token).digest('hex'), id, Date.now() + 3600000);
      sessions[who] = token;
    }
    repos.concerts.create({ id: concertId, artist: `Test concert ${suffix}`, venue: 'Singapore Indoor Stadium', city: 'Singapore', event_date: '2030-01-01' });
    const parties = { a: `e2e_a_${suffix}`, b: `e2e_b_${suffix}` };
    for (const [key, host, friend, name] of [['a', 'hostA', 'friendA', 'Supper crew'], ['b', 'hostB', 'friendB', 'Singalong crew']]) {
      repos.parties.create(makeParty(parties[key], makeUser(users[host]), { concert_id: concertId, capacity: 2 }));
      db.prepare('UPDATE parties SET name=? WHERE id=?').run(`${name} ${suffix}`, parties[key]);
      repos.membership.configure(users[host], parties[key], { expectedFriends: 1, strangerPlaces: 2 });
      repos.membership.acceptInvite(users[friend], repos.membership.invite(users[host], parties[key]).token);
      repos.membership.publish(users[host], parties[key], { connectOpen: true });
    }
    repos.seekers.create(makeSeeker(`e2e_seeker_${suffix}`, makeUser(users.seeker), { concert_id: concertId }));
    repos.recommendations.setJoiningMode(users.seeker, concertId, req.body?.mode ?? 'direct');
    res.json({ concertId, parties, users, sessions, suffix });
  } catch (error) { next(error); }
});
harness.post('/__test/round', (req, res, next) => {
  try { res.json(application.matching.run(req.body.concertId, { batchKey: `browser-${req.body.concertId}` })); }
  catch (error) { next(error); }
});
harness.use(app);
const server = harness.listen(3105, '127.0.0.1', () => console.log('Disposable E2E API listening on 127.0.0.1:3105'));
function stop() {
  application.delivery.stop();
  server.closeAllConnections();
  server.close(() => { db.close(); rmSync(directory, { recursive: true, force: true }); process.exit(0); });
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
