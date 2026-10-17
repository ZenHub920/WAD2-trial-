/**
 * Seed the database with a demo dataset.
 *
 *   node src/db/seed.js            -- default demo size
 *   node src/db/seed.js --big      -- larger population, for load demos
 *   node src/db/seed.js --reset    -- drop existing rows first
 *
 * Concerts are invented events at real venue names; all people are synthetic.
 */

import '../config/loadEnv.js';

import { getDb } from './connection.js';
import { createRepositories } from './repositories.js';
import { generateInstance } from '../../bench/generate.js';


const args = new Set(process.argv.slice(2));
const big = args.has('--big');

const db = getDb();
const repos = createRepositories(db);

// The seed is a demo fixture, not a migration: it always starts from an empty
// database so that `npm run seed` is idempotent and safe to re-run. Without this,
// a second run dies on the concerts' UNIQUE primary keys.
// (`--reset` is still accepted for backwards compatibility; it is now the default.)
const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;


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

/**
 * Example tickets for the market, so the cards have something to show.
 * Prices are per lot, in cents. `section` is the category printed on the ticket.
 */
const LISTINGS = [
  {
    concert_id: 'c_seraphina',
    section: 'Cat 3',
    price_cents: 31000, verified: true, minutes_ago: 60,
    description:
      'Selling 1x ticket for 14 Nov. Bought directly from the official site, can transfer ' +
      'the e-ticket through the app.\n- Cat 3, row Z, seat 24\n- Can\'t make it last minute ' +
      'because of a friend\'s wedding. Okay to do PayNow / PayLah, or pay through here.',
  },
  {
    concert_id: 'c_seraphina',
    section: 'VIP 1',
    quantity: 2, price_cents: 124000, verified: true, minutes_ago: 75,
    description:
      'Pair of VIP 1 seats, side by side. Includes the soundcheck pass and the tote. ' +
      'Selling at cost, no markup.',
  },
  {
    concert_id: 'c_kiyoko',
    section: 'Cat 10',
    price_cents: 12000, verified: false, minutes_ago: 58,
    description: 'Balcony seat, great view of the horn section. Will transfer once paid.',
  },
  {
    concert_id: 'c_meridian',
    section: 'Pen A',
    price_cents: 36000, verified: true, minutes_ago: 60 * 24,
    description:
      'Standing pen A, early entry number in the 200s. Selling because I got a better queue ' +
      'number from a friend.',
  },
  {
    concert_id: 'c_seraphina',
    section: 'Cat 4',
    price_cents: 33000, verified: true, minutes_ago: 11,
    description: 'Cat 4 for the Sunday show. Aisle seat, easy in and out.',
  },
  {
    concert_id: 'c_northbound',
    section: 'Stalls',
    quantity: 2, price_cents: 26000, verified: false, minutes_ago: 15,
    description: 'Two stalls seats together. Lovely acoustics this close.',
  },
  {
    concert_id: 'c_halcyon',
    section: 'Circle',
    price_cents: 9800, verified: true, minutes_ago: 60 * 3,
    description: 'Single circle seat. Small room, every seat is a good seat.',
  },
  {
    concert_id: 'c_kiyoko',
    section: 'Cat 1',
    price_cents: 28800, verified: true, minutes_ago: 60 * 5,
    description: 'Front row of Cat 1. Selling because of a work trip.',
  },
  {
    concert_id: 'c_meridian',
    section: 'Pen B',
    price_cents: 21000, verified: false, minutes_ago: 60 * 30,
    description: 'Pen B standing. Can meet at the venue to hand over if you prefer.',
  },
  {
    concert_id: 'c_northbound',
    section: 'Grand Circle',
    price_cents: 8800, verified: true, minutes_ago: 60 * 48,
    description: 'Up high but centred. Bring earplugs.',
  },
  {
    concert_id: 'c_seraphina',
    section: 'Cat 1',
    quantity: 3, price_cents: 87000, verified: true, minutes_ago: 4,
    description:
      'Three Cat 1 seats together for the Sunday show. Our group shrank, so selling all three ' +
      'as one lot. Face value, receipts available.',
  },
  {
    concert_id: 'c_kiyoko',
    section: 'Pit',
    price_cents: 19800, verified: true, minutes_ago: 27,
    description: 'Pit standing. Bring your voice — it is a singalong from the first song.',
  },
  {
    concert_id: 'c_halcyon',
    section: 'Stalls',
    quantity: 2, price_cents: 23600, verified: false, minutes_ago: 60 * 2,
    description: 'Two seats, second row. Will transfer as soon as payment clears.',
  },
  {
    concert_id: 'c_meridian',
    section: 'VIP',
    price_cents: 48000, verified: true, minutes_ago: 60 * 6,
    description:
      'VIP package: soundcheck entry, early merch access and a signed poster. Selling because ' +
      'I am travelling that week.',
  },
  {
    concert_id: 'c_northbound',
    section: 'Dress Circle',
    price_cents: 15500, verified: true, minutes_ago: 60 * 9,
    description: 'Single dress circle seat, centre block. Great sightline to the light rig.',
  },
  {
    concert_id: 'c_seraphina',
    section: 'Cat 6',
    price_cents: 14800, verified: false, minutes_ago: 60 * 20,
    description: 'Upper tier but full stage view. Selling below what I paid.',
  },
  {
    concert_id: 'c_kiyoko',
    section: 'Box',
    quantity: 4, price_cents: 96000, verified: true, minutes_ago: 60 * 36,
    description: 'Private balcony box for four. Best seats in the hall for actually listening.',
  },
  {
    concert_id: 'c_meridian',
    section: 'Pen C',
    price_cents: 16500, verified: true, minutes_ago: 60 * 72,
    description: 'Pen C, late entry. Fine if you just want to be in the room.',
  },
];

/** SQLite's own datetime format, so seeded rows sort alongside datetime('now') rows. */
function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

const scale = big
  ? { seekers: 400, parties: 0 }
  : { seekers: 90, parties: 0 };

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
  db.exec(`
    DELETE FROM meetup_approvals;
    DELETE FROM meetup_comments;
    DELETE FROM meetup_votes;
    DELETE FROM meetup_availability;
    DELETE FROM meetup_places;
    DELETE FROM meetups;
    DELETE FROM group_attendance_feedback;
    DELETE FROM group_join_request_events;
    DELETE FROM group_join_requests;
    DELETE FROM group_friend_invites;
    DELETE FROM group_member_preferences;
    DELETE FROM group_memberships;
    DELETE FROM membership_conflicts;
    DELETE FROM seeker_discovery_preferences;
    DELETE FROM group_settings;
    DELETE FROM group_connections;
    DELETE FROM seeker_party_preferences;
    DELETE FROM notification_preferences;
    DELETE FROM notifications;
    DELETE FROM reports;
    DELETE FROM messages;
    DELETE FROM conversation_reads;
    DELETE FROM conversation_settings;
    DELETE FROM conversations;
    DELETE FROM kaki_decisions;
    DELETE FROM concert_participants;
    DELETE FROM ticket_messages;
    DELETE FROM ticket_conversations;
    DELETE FROM ticket_inquiries;
    DELETE FROM saved_tickets;
    DELETE FROM orders;
    DELETE FROM ticket_numbers;
    DELETE FROM issued_tickets;
    DELETE FROM tickets;
    DELETE FROM sessions;
    DELETE FROM match_proposals;
    DELETE FROM match_declines;
    DELETE FROM match_trace;
    DELETE FROM attendance_feedback;
    DELETE FROM match_results;
    DELETE FROM match_rounds;
    DELETE FROM seeker_requests;
    DELETE FROM parties;
    DELETE FROM blocks;
    DELETE FROM concerts;
    DELETE FROM users;
  `);
  for (const concert of CONCERTS) {
    repos.concerts.create({
      ...concert,
      matching_closes_at: `${concert.event_date}T00:00:00`,
    });
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

  // Each concert's issued ticket list: 20 numbers per section the examples use,
  // e.g. SER-CAT3-0007. Verified examples hold real numbers from it; the rest stay
  // free so a seller can list one and watch it verify automatically.
  const issuedPool = new Map(); // `${concert}|${section}` -> unused numbers
  for (const { concert_id, section } of LISTINGS) {
    const key = `${concert_id}|${section}`;
    if (issuedPool.has(key)) continue;
    const prefix = concert_id.slice(2, 5).toUpperCase();
    const code = section.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const numbers = Array.from({ length: 20 }, (_, i) => `${prefix}-${code}-${String(i + 1).padStart(4, '0')}`);
    repos.issuedTickets.import(concert_id, numbers.map((number) => ({ number, category: section })));
    issuedPool.set(key, numbers);
  }

  LISTINGS.forEach((listing, index) => {
    const pool = issuedPool.get(`${listing.concert_id}|${listing.section}`);
    const quantity = listing.quantity ?? 1;
    repos.tickets.create({
      seller_user_id: instance.users[(index * 11) % instance.users.length].id,
      concertId: listing.concert_id,
      priceCents: listing.price_cents,
      quantity,
      section: listing.section,
      description: listing.description,
      image_path: null,
      ticket_numbers: listing.verified ? pool.splice(0, quantity) : [],
      created_at: minutesAgo(listing.minutes_ago),
    });
  });

  spareTicketNumbers = [...issuedPool].slice(0, 3).map(([key, numbers]) => {
    const [concertId, section] = key.split('|');
    return { concertId, section, number: numbers.at(-1) };
  });
});

let spareTicketNumbers = [];

insert();
if (existing > 0) console.log(`Cleared existing data (${existing} users).`);

const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM users)           AS users,
    (SELECT COUNT(*) FROM concerts)        AS concerts,
    (SELECT COUNT(*) FROM parties)         AS parties,
    (SELECT COUNT(*) FROM seeker_requests) AS seekers,
    (SELECT COUNT(*) FROM tickets)         AS tickets
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
console.log('\nTicket numbers you can list to see automatic verification:');
for (const { concertId, section, number } of spareTicketNumbers) {
  console.log(`  ${concertId.padEnd(14)} ${section.padEnd(8)} ${number}`);
}
console.log('\nPublic match preview:  curl localhost:3000/api/concerts/c_seraphina/match/preview');
console.log('To run a round, register a real account, grant it with npm run operator:grant -- <existing-email>, then POST with its session cookie.');
