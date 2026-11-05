/**
 * Local test accounts for simulating companions and groups.
 *
 *   npm run seed:test-accounts        (from server/)
 *
 * Creates test3 … test10 (test1 and test2 already exist and are left alone),
 * each with a generated face picture, a vibe, and saved preferences, then sets
 * up the scenarios below. Re-running is safe: accounts and groups that already
 * exist are skipped. A backup of the database is written first.
 *
 * Every new account signs in with TEST_PASSWORD, e.g. test3@gmail.com.
 *
 * COMPANION FINDER, Joji (Arena @ EXPO, 21 Nov 2026)
 *   test3, test4, test5, test6 have joined the finder.
 *   test4 has already liked test3, so test3 liking test4 is an instant match.
 *   test5 marks "early queue" as a dealbreaker and test6 enjoys queueing
 *   early, so neither can like the other (both cards still show in the deck).
 *   test7 has no picture: the Join button stays disabled until one is added.
 *
 * GROUPS, Bruno Mars (18 Apr 2027)
 *   test1 hosts "test1" and test2 hosts "test2": both already existed.
 *   test8 hosts "Front-row crew" with friend test9: published, two places
 *   for strangers.
 *   test10 is looking for a group (picks one directly): sees the groups and
 *   can apply; test8 approves or declines.
 */
import '../config/loadEnv.js';
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './connection.js';
import { createRepositories } from './repositories.js';
import { hashPassword } from '../services/passwords.js';

export const TEST_PASSWORD = 'EncoreTest123!';
const COMPANION_CONCERT = 'tm_Z8ymWIMJlyZziZ77Fk'; // Joji, 2026-11-21
const GROUP_CONCERT = 'tm_Z8ymWIMJlyZziZ7a67'; // Bruno Mars, 2027-04-18
const here = dirname(fileURLToPath(import.meta.url));
const avatarDir = process.env.ENCORE_AVATAR_DIR ?? join(here, '../../data/avatars');

const PLANS = { pre_meetup: true, post_supper: true, merch_run: false, transport_share: true };
const ACCOUNTS = [
  { n: 3, name: 'Aisha', gender: 'f', bg: [124, 92, 255], skin: [241, 194, 160], about: ['singalong', 'post_supper', 'phone_light'], wants: ['singalong'], avoid: ['quiet'], vibe: { singalong: 4, photography: 2, dancing: 3, quiet: 0, queue_early: 2, merch: 1 } },
  { n: 4, name: 'Ben', gender: 'm', bg: [36, 112, 90], skin: [224, 172, 125], about: ['singalong', 'post_supper', 'transport_share'], wants: ['post_supper'], avoid: [], vibe: { singalong: 3, photography: 1, dancing: 3, quiet: 1, queue_early: 1, merch: 2 } },
  { n: 5, name: 'Chloe', gender: 'f', bg: [179, 50, 95], skin: [255, 219, 187], about: ['dancing', 'photography'], wants: ['dancing'], avoid: ['early_queue'], dealbreakers: ['early_queue'], vibe: { singalong: 2, photography: 4, dancing: 4, quiet: 0, queue_early: 0, merch: 1 } },
  { n: 6, name: 'Daniel', gender: 'm', bg: [230, 140, 30], skin: [198, 134, 66], about: ['early_queue', 'merch_run', 'pre_food'], wants: ['early_queue'], avoid: [], vibe: { singalong: 2, photography: 2, dancing: 1, quiet: 2, queue_early: 4, merch: 4 } },
  { n: 7, name: 'Emily', gender: 'f', picture: false, about: ['quiet', 'hearing_protection'], wants: ['quiet'], avoid: ['dancing'], vibe: { singalong: 1, photography: 1, dancing: 0, quiet: 4, queue_early: 1, merch: 0 } },
  { n: 8, name: 'Farhan', gender: 'm', bg: [29, 155, 240], skin: [141, 85, 36], about: ['pre_meetup', 'singalong', 'group_photos'], wants: ['singalong'], avoid: [], vibe: { singalong: 4, photography: 3, dancing: 2, quiet: 1, queue_early: 3, merch: 2 } },
  { n: 9, name: 'Grace', gender: 'f', bg: [90, 60, 160], skin: [255, 205, 148], about: ['pre_meetup', 'group_photos', 'post_supper'], wants: ['group_photos'], avoid: [], vibe: { singalong: 3, photography: 4, dancing: 2, quiet: 1, queue_early: 2, merch: 1 } },
  { n: 10, name: 'Hiro', gender: 'm', bg: [20, 17, 27], skin: [234, 192, 134], about: ['singalong', 'public_transport', 'pre_meetup'], wants: ['pre_meetup'], avoid: [], vibe: { singalong: 3, photography: 1, dancing: 2, quiet: 1, queue_early: 2, merch: 1 } },
];

/** A 128px cartoon face: coloured backdrop, head, two eyes and a smile. */
function facePng(bg, skin) {
  const size = 128, row = size * 4 + 1, raw = Buffer.alloc(row * size);
  const dark = [40, 30, 30];
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - 64, dy = y - 66, r = Math.hypot(dx, dy);
      let c = bg;
      if (r < 44) c = skin;
      if (Math.hypot(x - 48, y - 56) < 6 || Math.hypot(x - 80, y - 56) < 6) c = dark;
      const smile = Math.hypot(x - 64, y - 70);
      if (y > 78 && smile > 18 && smile < 23) c = dark;
      raw.set([...c, 255], y * row + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const db = getDb();
const repos = createRepositories(db);
const step = (label, fn) => {
  try { const result = fn(); console.log(`ok    ${label}`); return result; }
  catch (error) { console.log(`skip  ${label}: ${error.message}`); return null; }
};

try {
  const backup = join(here, `../../data/encore.backup-before-test-accounts-${Date.now()}.db`);
  await db.backup(backup);
  console.log(`Backup written to ${backup}`);
  mkdirSync(avatarDir, { recursive: true });

  const ids = {};
  for (const account of ACCOUNTS) {
    const email = `test${account.n}@gmail.com`;
    const existing = repos.users.findByEmail(email);
    if (existing) { ids[account.n] = existing.id; console.log(`exists ${email}`); continue; }
    const user = repos.users.create({
      display_name: account.name, email, password_hash: hashPassword(TEST_PASSWORD),
      age_band: '21-24', home_region: 'central', gender: account.gender,
      languages: ['en'], vibe: account.vibe, reliability: 0.8,
    });
    ids[account.n] = user.id;
    db.prepare('UPDATE users SET about_saved = 1 WHERE id = ?').run(user.id);
    if (account.picture !== false) {
      const file = `test-account-${account.n}.png`;
      writeFileSync(join(avatarDir, file), facePng(account.bg, account.skin));
      repos.users.setAvatar(user.id, file);
    }
    repos.membership.savePreferences(user.id, {
      about: account.about, wants: account.wants, avoid: account.avoid, dealbreakers: account.dealbreakers ?? [],
    });
    console.log(`created ${email} (${account.name})`);
  }

  // Companion finder: four people in, one like already waiting for test3.
  for (const n of [3, 4, 5, 6]) {
    step(`test${n} joins the companion finder for Joji`, () =>
      repos.participation.join(ids[n], COMPANION_CONCERT, 'ga_standing', n === 6 ? 'early_queue' : 'mid'));
  }
  step('test4 likes test3', () => {
    if (!repos.kaki.setDecision(ids[4], COMPANION_CONCERT, ids[3], 'like')) throw new Error('not eligible');
  });

  // Groups: test8 hosts a published crew with friend test9.
  const hasGroup = (user) => db.prepare(`SELECT p.id FROM group_memberships m JOIN parties p ON p.id=m.party_id
    WHERE m.user_id=? AND p.concert_id=? AND m.status='active' AND p.status<>'cancelled'`).get(user, GROUP_CONCERT);
  if (!hasGroup(ids[8])) {
    step('test8 creates "Front-row crew" with test9 for Bruno Mars', () => {
      const party = repos.parties.create({
        host_user_id: ids[8], concert_id: GROUP_CONCERT, capacity: 4, section: 'category_1', spend_band: 2,
        arrival_plan: 'mid', plans: PLANS, name: 'Front-row crew', notes: 'Dinner before, then singing every word.',
      });
      repos.membership.configure(ids[8], party.id, { expectedFriends: 1, strangerPlaces: 2 });
      repos.membership.acceptInvite(ids[9], repos.membership.invite(ids[8], party.id).token);
      repos.membership.publish(ids[8], party.id);
    });
  } else console.log('exists "Front-row crew"');

  // test10 is looking for a group and picks one directly.
  step('test10 looks for a Bruno Mars group', () => {
    if (!repos.groups.seeker(ids[10], GROUP_CONCERT)) {
      repos.seekers.create({
        user_id: ids[10], concert_id: GROUP_CONCERT, section_pref: 'category_1', spend_band_max: 3,
        arrival_pref: 'mid', plans_wanted: PLANS, joining_mode: 'direct',
      });
    }
    repos.recommendations.setJoiningMode(ids[10], GROUP_CONCERT, 'direct');
  });
  step('test10 can see groups to join', () => {
    const { groups } = repos.recommendations.individualDiscovery(ids[10], GROUP_CONCERT);
    console.log(`      ${groups.map((g) => g.name).join(', ') || 'none'}`);
  });
} finally {
  closeDb();
}
