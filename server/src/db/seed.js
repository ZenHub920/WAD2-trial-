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

// The seed is a demo fixture, not a migration: it always starts from an empty
// database so that `npm run seed` is idempotent and safe to re-run. Without this,
// a second run dies on the concerts' UNIQUE primary keys.
// (`--reset` is still accepted for backwards compatibility; it is now the default.)
const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

db.exec(`
  DELETE FROM ticket_orders;
  DELETE FROM ticket_listings;
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

if (existing > 0) {
  console.log(`Cleared existing data (${existing} users).`);
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

const DEMO_BUYER_ID = 'u_demo_buyer';

/** Resale listings for the ticket market. Prices are per lot, in cents. */
const LISTINGS = [
  {
    concert_id: 'c_seraphina',
    title: 'Seraphina Vale Glasshouse Tour Singapore 14 Nov Cat 3',
    category: 'Cat 3', show_date: '2026-11-14', seat_row: 'Z', seat_numbers: '24',
    price_cents: 31000, verified: true, minutes_ago: 60,
    description:
      'Selling 1x ticket for 14 Nov. Bought directly from the official site, can transfer ' +
      'the e-ticket through the app.\n- Cat 3, row Z, seat 24\n- Can\'t make it last minute ' +
      'because of a friend\'s wedding. Okay to do PayNow / PayLah, or pay through here.',
  },
  {
    concert_id: 'c_seraphina',
    title: 'Seraphina Vale Glasshouse Tour Singapore VIP 1',
    category: 'VIP 1', show_date: '2026-11-14', seat_row: 'B', seat_numbers: '11, 12',
    quantity: 2, price_cents: 124000, verified: true, minutes_ago: 75,
    description:
      'Pair of VIP 1 seats, side by side. Includes the soundcheck pass and the tote. ' +
      'Selling at cost, no markup.',
  },
  {
    concert_id: 'c_kiyoko',
    title: 'KIYOKO Neon Prefecture Singapore Cat 10',
    category: 'Cat 10', show_date: '2026-12-06', seat_row: 'K', seat_numbers: '7',
    price_cents: 12000, verified: false, minutes_ago: 58,
    description: 'Balcony seat, great view of the horn section. Will transfer once paid.',
  },
  {
    concert_id: 'c_meridian',
    title: 'Meridian Youth Afterglow Asia Standing Pen A',
    category: 'Pen A', show_date: '2027-01-17',
    price_cents: 36000, verified: true, minutes_ago: 60 * 24,
    description:
      'Standing pen A, early entry number in the 200s. Selling because I got a better queue ' +
      'number from a friend.',
  },
  {
    concert_id: 'c_seraphina',
    title: 'Seraphina Vale Glasshouse Tour Singapore 15 Nov Cat 4',
    category: 'Cat 4', show_date: '2026-11-15', seat_row: 'P', seat_numbers: '3',
    price_cents: 33000, verified: true, minutes_ago: 11,
    description: 'Cat 4 for the Sunday show. Aisle seat, easy in and out.',
  },
  {
    concert_id: 'c_northbound',
    title: 'Northbound Atlas Signal Fade Stalls Row F',
    category: 'Stalls', show_date: '2026-10-25', seat_row: 'F', seat_numbers: '18, 19',
    quantity: 2, price_cents: 26000, verified: false, minutes_ago: 15,
    description: 'Two stalls seats together. Lovely acoustics this close.',
  },
  {
    concert_id: 'c_halcyon',
    title: 'Halcyon Drift Low Tide Capitol Theatre Circle',
    category: 'Circle', show_date: '2026-11-02', seat_row: 'C', seat_numbers: '9',
    price_cents: 9800, verified: true, minutes_ago: 60 * 3,
    description: 'Single circle seat. Small room, every seat is a good seat.',
  },
  {
    concert_id: 'c_kiyoko',
    title: 'KIYOKO Neon Prefecture Singapore Cat 1',
    category: 'Cat 1', show_date: '2026-12-06', seat_row: 'A', seat_numbers: '30',
    price_cents: 28800, verified: true, minutes_ago: 60 * 5,
    description: 'Front row of Cat 1. Selling because of a work trip.',
  },
  {
    concert_id: 'c_meridian',
    title: 'Meridian Youth Afterglow Asia Standing Pen B',
    category: 'Pen B', show_date: '2027-01-17',
    price_cents: 21000, verified: false, minutes_ago: 60 * 30,
    description: 'Pen B standing. Can meet at the venue to hand over if you prefer.',
  },
  {
    concert_id: 'c_northbound',
    title: 'Northbound Atlas Signal Fade Grand Circle',
    category: 'Grand Circle', show_date: '2026-10-25', seat_row: 'M', seat_numbers: '2',
    price_cents: 8800, verified: true, minutes_ago: 60 * 48,
    description: 'Up high but centred. Bring earplugs.',
  },
];

/** SQLite's own datetime format, so seeded rows sort alongside datetime('now') rows. */
function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

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

  // The ticket market's buyer. There is no auth, so the client acts as this user.
  repos.users.create({
    id: DEMO_BUYER_ID,
    display_name: 'Demo Buyer',
    email: `${DEMO_BUYER_ID}@example.test`,
    age_band: '21-24',
    home_region: 'central',
    gender: 'nb',
    vibe: { singalong: 3, photography: 2, dancing: 3, quiet: 2, queue_early: 2, merch: 3 },
    verified: true,
  });

  // Sellers are drawn from the synthetic population with a stride, so the market
  // does not show the same handful of people the matching pages lead with.
  LISTINGS.forEach((listing, index) => {
    repos.listings.create({
      ...listing,
      seller_user_id: instance.users[(index * 11) % instance.users.length].id,
      created_at: minutesAgo(listing.minutes_ago),
    });
  });
});

insert();

const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM users)           AS users,
    (SELECT COUNT(*) FROM concerts)        AS concerts,
    (SELECT COUNT(*) FROM parties)         AS parties,
    (SELECT COUNT(*) FROM seeker_requests) AS seekers,
    (SELECT COUNT(*) FROM ticket_listings) AS listings
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
