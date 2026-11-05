import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { concertParticipationEligibility } from '../../shared/concertEligibility.mjs';
import { createTestDb } from '../../server/src/db/connection.js';
import { createApp } from '../../server/src/app.js';
import { makeParty, makeSeeker, makeUser } from './helpers.js';

const concertDay = { event_date: '2030-01-01', event_timezone: 'Asia/Singapore' };
const cutoff = Date.parse('2030-01-01T16:00:00Z');
for (const [name, concert, now, expected, expectedCutoff] of [
  ['future concert', concertDay, '2029-12-01T00:00:00Z', true, cutoff],
  ['Singapore day while UTC still shows yesterday', concertDay, '2029-12-31T16:01:00Z', true, cutoff],
  ['verified performance has not started', { ...concertDay, event_time: '20:00' }, '2030-01-01T11:59:59Z', true, cutoff],
  ['verified performance start is not a finish', { ...concertDay, event_time: '20:00' }, '2030-01-01T12:00:00Z', true, cutoff],
  ['same day after verified start', { ...concertDay, event_time: '20:00' }, '2030-01-01T14:00:00Z', true, cutoff],
  ['date-only day final millisecond', { event_date: '2030-01-01' }, '2030-01-01T15:59:59.999Z', true, cutoff],
  ['doors time is not a finish', { ...concertDay, doors_time: '18:00' }, '2030-01-01T15:00:00Z', true, cutoff],
  ['local day ends', concertDay, '2030-01-01T16:00:00Z', false, cutoff],
  ['historical date', { event_date: '2020-01-01' }, '2030-01-01T00:00:00Z', false, Date.parse('2020-01-01T16:00:00Z')],
  ['overseas day stays current after Singapore midnight', { event_date: '2030-01-01', event_timezone: 'America/New_York', event_time: '20:00' }, '2030-01-02T03:00:00Z', true, Date.parse('2030-01-02T05:00:00Z')],
  ['overseas midnight', { event_date: '2030-01-01', event_timezone: 'America/New_York' }, '2030-01-02T05:00:00Z', false, Date.parse('2030-01-02T05:00:00Z')],
  ['unusable timezone falls back to Singapore', { event_date: '2030-01-01', event_timezone: 'Invalid/Zone' }, '2030-01-01T16:00:00Z', false, cutoff],
]) test(`coordination eligibility: ${name}`, () => {
  const result = concertParticipationEligibility(concert, Date.parse(now));
  assert.equal(result.eligible, expected);
  assert.equal(result.cutoffAt, expectedCutoff);
  assert.equal(result.reason, expected ? null : 'concert_finished');
});

test('coordination eligibility fails closed for missing, invalid and non-finite dates', () => {
  for (const [concert, now] of [[{}, 0], [{ event_date: '2030-02-30' }, 0], [concertDay, NaN]])
    assert.deepEqual(concertParticipationEligibility(concert, now), {
      eligible: false, reason: 'concert_date_unavailable', cutoffAt: null,
    });
});

function fixture(t) {
  const db = createTestDb(), application = createApp({ db, env: { NODE_ENV: 'test' } });
  const { repos, matching } = application;
  let now = Date.parse('2030-01-01T04:00:00Z');
  t.mock.method(Date, 'now', () => now);
  t.after(() => db.close());
  for (const id of ['h1', 'h2', 'direct', 'auto', 'kakiA', 'kakiB', 'kakiC', 'new', 'friend', 'outsider']) {
    repos.users.create(makeUser(id));
    repos.membership.savePreferences(id, { about: ['supper'] });
  }
  repos.concerts.create({ id: 'c1', artist: 'Audit act', city: 'Singapore', venue: 'Hall', ...concertDay });
  for (const [id, host] of [['p1', 'h1'], ['p2', 'h2']]) {
    repos.parties.create(makeParty(id, makeUser(host), { capacity: 3 }));
    repos.membership.configure(host, id, { expectedFriends: 0 });
    repos.membership.publish(host, id);
  }
  for (const user of ['direct', 'auto']) repos.seekers.create(makeSeeker(`s-${user}`, makeUser(user)));
  repos.recommendations.setJoiningMode('direct', 'c1', 'direct');
  for (const user of ['kakiA', 'kakiB', 'kakiC']) repos.participation.join(user, 'c1', 'ga_standing', 'mid');
  repos.kaki.setDecision('kakiA', 'c1', 'kakiB', 'like');
  repos.kaki.setDecision('kakiB', 'c1', 'kakiA', 'like');
  return { ...application, setNow(value) { now = value; }, finish() { now = cutoff; } };
}

test('overseas post-concert feedback opens at the concert local day end, not Singapore midnight', t => {
  const { db, repos, setNow } = fixture(t);
  repos.membership.configure('h1', 'p1', { expectedFriends: 1 });
  const link = repos.membership.invite('h1', 'p1');
  repos.membership.acceptInvite('friend', link.token);
  db.prepare("UPDATE concerts SET event_timezone='America/New_York',event_time='20:00' WHERE id='c1'").run();
  setNow(Date.parse('2030-01-02T03:00:00Z'));
  const feedback = { partyId: 'p1', ratedUserId: 'friend', showedUp: true, rating: 5 };
  assert.throws(() => repos.feedback.submit('h1', feedback), /concert_not_finished/);
  setNow(Date.parse('2030-01-02T05:00:00Z'));
  assert.equal(repos.feedback.submit('h1', feedback).submitted, true);
});
