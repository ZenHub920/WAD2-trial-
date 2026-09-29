/**
 * Seed the database with a demo dataset.
 *
 *   node src/db/seed.js            -- default demo size
 *   node src/db/seed.js --big      -- larger population, for load demos
 *   node src/db/seed.js --reset    -- drop existing rows first
 *
 * Concerts are invented events at real venue names; all people are synthetic.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb } from './connection.js';
import { createRepositories } from './repositories.js';
import { generateInstance } from '../../bench/generate.js';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, '../../data'), { recursive: true });

const args = new Set(process.argv.slice(2));
const big = args.has('--big');

const db = getDb();
const repos = createRepositories(db);

if (args.has('--reset')) {
  db.exec(`
    DELETE FROM match_trace;
    DELETE FROM match_results;
    DELETE FROM match_rounds;
    DELETE FROM attendance_feedback;
    DELETE FROM seeker_requests;
    DELETE FROM parties;
    DELETE FROM blocks;
    DELETE FROM concerts;
    DELETE FROM users;
  `);
  console.log('Cleared existing data.');
}

const CONCERTS = [
  {
    id: 'c_seraphina',
    artist: 'Seraphina Vale',
    tour_name: 'Glasshouse World Tour',
    venue: 'Singapore Indoor Stadium',
    city: 'Singapore',
    event_date: '2026-11-14',
    doors_time: '18:30',
    blurb:
      'Four albums in, Vale finally brings the full string section. Expect the ' +
      'acoustic middle act everyone posts about and a twenty-minute encore.',
  },
  {
    id: 'c_northbound',
    artist: 'Northbound Atlas',
    tour_name: 'Signal Fade',
    venue: 'The Star Theatre',
    city: 'Singapore',
    event_date: '2026-10-25',
    doors_time: '19:00',
    blurb:
      'Post-rock, seated, and loud enough that the seats matter less than you think. ' +
      'Their last Singapore date sold out in eleven minutes.',
  },
  {
    id: 'c_kiyoko',
    artist: 'KIYOKO',
    tour_name: 'Neon Prefecture',
    venue: 'Esplanade Concert Hall',
    city: 'Singapore',
    event_date: '2026-12-06',
    doors_time: '19:30',
    blurb:
      'City-pop revival with a horn section. The pit is a singalong from the first bar; ' +
      'the balcony is where people go to actually listen.',
  },
  {
    id: 'c_halcyon',
    artist: 'Halcyon Drift',
    tour_name: 'Low Tide',
    venue: 'Capitol Theatre',
    city: 'Singapore',
    event_date: '2026-11-02',
    doors_time: '20:00',
    blurb:
      'A small room and a band that plays like it. No support act, no interval, ' +
      'phones discouraged.',
  },
  {
    id: 'c_meridian',
    artist: 'Meridian Youth',
    tour_name: 'Afterglow Asia',
    venue: 'Zepp @ BIGBOX',
    city: 'Singapore',
    event_date: '2027-01-17',
    doors_time: '19:00',
    blurb:
      'Standing only, barrier campers from noon, and a merch queue that is genuinely ' +
      'part of the experience.',
  },
];

const FIRST_NAMES = [
  'Amira', 'Wei Ming', 'Priya', 'Daniel', 'Siti', 'Jun Hao', 'Rachel', 'Arjun',
  'Mei Ling', 'Farhan', 'Chloe', 'Ryan', 'Nadia', 'Zhi Hao', 'Divya', 'Marcus',
  'Yasmin', 'Kai Xuan', 'Tanya', 'Isaac', 'Hui Shan', 'Rizwan', 'Elaine', 'Joel',
  'Aisha', 'Cheng Yu', 'Leela', 'Nathan', 'Serene', 'Haziq', 'Bryan', 'Meera',
];
const LAST_NAMES = [
  'Tan', 'Lim', 'Rahman', 'Nair', 'Wong', 'Kumar', 'Chen', 'Ismail', 'Goh',
  'Menon', 'Ng', 'Hassan', 'Teo', 'Raj', 'Koh', 'Abdullah', 'Lee', 'Pillai',
];

const scale = big
  ? { seekers: 400, parties: 120 }
  : { seekers: 90, parties: 34 };

const instance = generateInstance({
  ...scale,
  seed: 20260929,
  maxCapacity: 4,
  concerts: CONCERTS.length,
});

// Map the generator's synthetic concert ids onto the real ones.
const concertIdMap = new Map(
  instance.concertIds.map((generated, index) => [generated, CONCERTS[index % CONCERTS.length].id]),
);

const insert = db.transaction(() => {
  for (const concert of CONCERTS) {
    if (!repos.concerts.findById(concert.id)) {
      repos.concerts.create({
        ...concert,
        matching_closes_at: `${concert.event_date}T00:00:00`,
      });
    }
  }

  // Co-prime strides over both name lists, so first and last names advance at
  // different rates and the population does not come out as thirty consecutive
  // people sharing a surname.
  let nameIndex = 0;
  const nextName = () => {
    const first = FIRST_NAMES[(nameIndex * 7) % FIRST_NAMES.length];
    const last = LAST_NAMES[(nameIndex * 5) % LAST_NAMES.length];
    nameIndex += 1;
    return `${first} ${last}`;
  };

  for (const user of instance.users) {
    repos.users.create({
      ...user,
      display_name: nextName(),
      email: `${user.id}@example.test`,
    });
  }

  for (const party of instance.parties) {
    repos.parties.create({
      ...party,
      concert_id: concertIdMap.get(party.concert_id),
      notes: null,
    });
  }

  for (const seeker of instance.seekers) {
    repos.seekers.create({
      ...seeker,
      concert_id: concertIdMap.get(seeker.concert_id),
      notes: null,
    });
  }
});

insert();

const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM users)           AS users,
    (SELECT COUNT(*) FROM concerts)        AS concerts,
    (SELECT COUNT(*) FROM parties)         AS parties,
    (SELECT COUNT(*) FROM seeker_requests) AS seekers
`).get();

console.log('Seeded:', counts);
console.log('\nConcerts:');
for (const row of repos.concerts.listWithCounts()) {
  console.log(
    `  ${row.id.padEnd(14)} ${row.artist.padEnd(20)} ` +
    `${String(row.open_parties).padStart(3)} parties / ` +
    `${String(row.open_slots).padStart(3)} slots / ` +
    `${String(row.open_seekers).padStart(3)} seekers`,
  );
}
console.log('\nRun a match round:  curl -X POST localhost:3000/api/concerts/c_seraphina/match');
