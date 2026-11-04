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
    repos.membership.publish(host, id, { connectOpen: true });
  }
  for (const user of ['direct', 'auto']) repos.seekers.create(makeSeeker(`s-${user}`, makeUser(user)));
  repos.recommendations.setJoiningMode('direct', 'c1', 'direct');
  for (const user of ['kakiA', 'kakiB', 'kakiC']) repos.participation.join(user, 'c1', 'ga_standing', 'mid');
  repos.kaki.setDecision('kakiA', 'c1', 'kakiB', 'like');
  repos.kaki.setDecision('kakiB', 'c1', 'kakiA', 'like');
  return { ...application, setNow(value) { now = value; }, finish() { now = cutoff; } };
}

test('same-day prospective actions remain possible after a verified performance start', t => {
  const { db, repos, matching, setNow } = fixture(t);
  db.prepare("UPDATE concerts SET event_time='20:00' WHERE id='c1'").run();
  setNow(Date.parse('2030-01-01T14:00:00Z'));
  assert.ok(repos.participation.join('new', 'c1', 'ga_standing', 'mid'));
  assert.ok(repos.seekers.create(makeSeeker('s-new', makeUser('new'))));
  assert.ok(repos.kaki.pool('kakiA').concerts.length);
  assert.ok(repos.kaki.setDecision('kakiA', 'c1', 'kakiC', 'like'));
  assert.ok(repos.recommendations.requestJoin('direct', 'p1').id);
  assert.equal(repos.groups.invite('h1', 'p1', 'p2').status, 'pending');
  assert.equal(matching.run('c1', { batchKey: randomUUID() }).empty, false);
  // Creating an upcoming group and planning pre-performance time retain their
  // distinct existing start-time policy; a running show is not an ended day.
  assert.throws(() => repos.parties.create(makeParty('late-group', makeUser('outsider'))), /concert_no_longer_upcoming/);
});

test('authoritative repositories reject new coordination after day end without deleting records', t => {
  const { db, repos, matching, finish } = fixture(t);
  repos.seekers.setStatus('s-direct', 'withdrawn');
  finish();
  for (const operation of [
    () => repos.participation.join('new', 'c1', 'ga_standing', 'mid'),
    () => repos.seekers.create(makeSeeker('s-new', makeUser('new'))),
    () => repos.kaki.setDecision('kakiA', 'c1', 'kakiC', 'like'),
    () => repos.recommendations.requestJoin('direct', 'p1'),
    () => repos.recommendations.setJoiningMode('auto', 'c1', 'algorithm'),
    () => repos.membership.publish('h1', 'p1'),
    () => matching.run('c1', { batchKey: randomUUID() }),
  ]) assert.throws(operation, { message: 'concert_finished', status: 409 });
  assert.equal(repos.groups.reopen('direct', 'c1').error, 'concert_finished');
  assert.equal(repos.groups.addPreference('auto', 'p1').error, 'concert_finished');
  assert.equal(repos.groups.invite('h1', 'p1', 'p2').error, 'concert_finished');
  assert.deepEqual(repos.kaki.pool('kakiA'), { concerts: [], people: [] });
  assert.deepEqual(repos.groups.discover('auto', 'c1'), []);
  assert.deepEqual(repos.recommendations.individual('auto', 'c1'), []);
  assert.deepEqual(repos.groups.connectionCandidates('h1', 'c1', 'p1'), []);
  assert.equal(matching.managedState('c1', 'auto').matching.state, 'idle');
  assert.equal(matching.preview('c1').empty, true);
  assert.ok(repos.participation.find('kakiA', 'c1'));
  assert.equal(repos.participation.mine('kakiA').length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM group_join_requests').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM group_connections').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM match_rounds').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM parties').get().n, 2);
});

test('pending acceptance closes after the concert while rejection and withdrawal stay available', t => {
  const { repos, matching, finish } = fixture(t);
  const direct = repos.recommendations.requestJoin('direct', 'p1');
  const invitation = repos.groups.invite('h1', 'p1', 'p2');
  matching.run('c1', { batchKey: randomUUID() });
  const offer = repos.proposals.forUser('auto', 'c1', ['proposed'])[0];
  assert.ok(offer);
  finish();
  assert.throws(() => repos.recommendations.respond('h1', direct.id, 'accept'), /concert_finished/);
  assert.equal(repos.groups.respond('h2', invitation.id, 'accept').error, 'concert_finished');
  assert.equal(repos.proposals.respond('auto', offer.id, 'accept').error, 'concert_finished');
  assert.equal(repos.recommendations.requests('direct')[0].status, 'pending');
  assert.equal(repos.proposals.forUser('auto', 'c1')[0].status, 'proposed');
  assert.equal(repos.recommendations.respond('direct', direct.id, 'withdraw').status, 'withdrawn');
  assert.equal(repos.groups.respond('h2', invitation.id, 'decline').status, 'declined');
  assert.equal(repos.proposals.respond('auto', offer.id, 'decline').status, 'declined');
  assert.equal(repos.recommendations.setJoiningMode('auto', 'c1', 'direct').joining_mode, 'direct');
});

test('historical matches, conversations, saved meetup plans, feedback and batch replay retain access', t => {
  const { db, repos, matching, finish } = fixture(t);
  repos.membership.configure('h1', 'p1', { expectedFriends: 1 });
  const friendLink = repos.membership.invite('h1', 'p1');
  repos.membership.acceptInvite('friend', friendLink.token);
  repos.membership.publish('h1', 'p1', { connectOpen: true });
  const connection = repos.groups.invite('h1', 'p1', 'p2');
  assert.equal(repos.groups.respond('h2', connection.id, 'accept').status, 'accepted');
  const conversation = repos.kakiChat.openFor({ concertId: 'c1', me: 'kakiA', other: 'kakiB' });
  repos.kakiChat.addMessage(conversation.id, 'kakiA', 'Saved pair message');
  const board = repos.meetups.create('h1', { partyId: 'p1', title: 'Saved plan',
    startsAt: '2030-01-01T17:00:00+08:00', endsAt: '2030-01-01T18:00:00+08:00' });
  const batchKey = randomUUID(), round = matching.run('c1', { batchKey });
  finish();
  assert.ok(repos.kaki.decisions('kakiA', repos.kaki.people('kakiA'))['c1:kakiB'].mutual);
  assert.equal(repos.kakiChat.openFor({ concertId: 'c1', me: 'kakiA', other: 'kakiB' }).id, conversation.id);
  assert.equal(repos.kakiChat.messagePage(conversation.id).rows.length, 1);
  assert.ok(repos.kakiChat.addMessage(conversation.id, 'kakiB', 'Still authorized after the show'));
  assert.equal(repos.groupChannels.open('p1', 'h1').partyId, 'p1');
  assert.equal(repos.connectionChannels.open(connection.id, 'h2').connectionId, connection.id);
  assert.equal(repos.meetups.detail('h1', board.id).title, 'Saved plan');
  assert.equal(repos.membership.activeGroups('friend')[0].eventTimezone, 'Asia/Singapore');
  assert.equal(repos.groups.hosted('h1')[0].eventTimezone, 'Asia/Singapore');
  assert.equal(repos.groups.hosted('h1')[0].canJoinQueue, false);
  assert.equal(repos.feedback.submit('h1', { partyId: 'p1', ratedUserId: 'friend', showedUp: true, rating: 5 }).submitted, true);
  assert.equal(matching.run('c1', { batchKey }).roundId, round.roundId);
  assert.equal(matching.run('c1', { batchKey }).replayed, true);
  assert.ok(repos.rounds.resultsForRound(round.roundId).length);
  assert.ok(repos.kaki.deleteDecision('kakiA', 'c1', 'kakiB'));
  assert.equal(repos.kakiChat.canChat('kakiA', 'kakiB', 'c1'), false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM conversations').get().n, 1);
});

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

test('direct authenticated API calls cannot forge eligibility and historical reads remain available', async t => {
  const { app, db, repos, finish } = fixture(t);
  const cookies = {};
  for (const id of ['h1', 'h2', 'direct', 'auto', 'kakiA', 'new']) {
    const token = randomBytes(32).toString('hex');
    repos.sessions.create(createHash('sha256').update(token).digest('hex'), id, Date.now() + 7 * 86400000);
    cookies[id] = `encore_session=${token}`;
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const call = async (path, who, method = 'GET', body, extra = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { cookie: cookies[who], 'content-type': 'application/json', 'X-Requested-With': 'Encore', ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  finish();
  for (const [path, who, method, body, extra] of [
    ['/concerts/c1/participation', 'new', 'POST', { sectionPref: 'ga_standing', arrivalPref: 'mid', event_date: '2099-01-01' }],
    ['/concerts/c1/requests', 'new', 'POST', { section_pref: 'ga_standing', spend_band_max: 3, arrival_pref: 'mid', event_date: '2099-01-01' }],
    ['/kaki/decisions/c1/kakiC', 'kakiA', 'PUT', { decision: 'like', event_date: '2099-01-01' }],
    ['/groups/p1/join-requests', 'direct', 'POST', { note: 'A forged future date cannot reopen the event', event_date: '2099-01-01' }],
    ['/group-connections', 'h1', 'POST', { fromPartyId: 'p1', toPartyId: 'p2', event_date: '2099-01-01' }],
    ['/me/concerts/c1/matching', 'auto', 'POST', {}, { 'Idempotency-Key': randomUUID() }],
    ['/groups/p1/publish', 'h1', 'POST', { connectOpen: true }],
  ]) {
    const result = await call(path, who, method, body, extra);
    // Participation validates its compact payload before the authoritative check.
    if (path.endsWith('/participation')) {
      assert.equal(result.status, 400); assert.equal(result.body.error, 'invalid_participation');
      const retry = await call(path, who, method, { sectionPref: 'ga_standing', arrivalPref: 'mid' });
      assert.equal(retry.status, 409); assert.equal(retry.body.error, 'concert_finished');
    } else { assert.equal(result.status, 409, path); assert.equal(result.body.error, 'concert_finished', path); }
  }
  const existing = await call('/concerts/c1/participation', 'kakiA');
  assert.equal(existing.status, 200); assert.equal(existing.body.participation.concertId, 'c1');
  assert.equal((await call('/kaki/matches', 'kakiA')).body.matches.length, 1);
  assert.equal((await call('/groups/discover/c1', 'direct')).body.total, 0);
  const invalidPlan = await call('/meetups', 'h1', 'POST', { partyId: 'p1', title: 'Too late',
    startsAt: '2030-01-02T09:00:00+08:00', endsAt: '2030-01-02T10:00:00+08:00' });
  assert.equal(invalidPlan.status, 400); assert.equal(invalidPlan.body.error, 'meetup_outside_concert_dates');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM group_join_requests').get().n, 0);
});
