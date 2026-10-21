import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories.js';
import { createMatchingService } from '../src/services/matchingService.js';
import { makeUser, makeParty, makeSeeker } from './helpers.js';

function fixture(capacity = 1, managed = false) {
  const db = createTestDb(), repos = createRepositories(db);
  for (const id of ['host', 'directA', 'directB', 'autoA', 'autoB']) repos.users.create(makeUser(id));
  repos.concerts.create({ id: 'c1', artist: 'Show', venue: 'Venue', city: 'Singapore', event_date: '2030-01-01' });
  repos.parties.create(makeParty('p1', makeUser('host'), { capacity }));
  for (const id of ['directA', 'directB', 'autoA', 'autoB']) {
    repos.seekers.create(makeSeeker(`s_${id}`, makeUser(id), { joining_mode: 'direct' }));
    if (managed) repos.recommendations.savePersonal(id, 'c1', { about: ['singalong'], wants: ['supper'] });
  }
  if (managed) {
    repos.membership.configure('host', 'p1', { strangerPlaces: capacity });
    repos.membership.saveAnswers('host', 'p1', { about: ['singalong'], wants: ['supper'] });
    repos.membership.publish('host', 'p1');
  }
  const matching = createMatchingService({ db, repos });
  let batch = 0;
  const offer = user => {
    repos.recommendations.setJoiningMode(user, 'c1', 'algorithm');
    const round = matching.run('c1', { batchKey: `queue_batch_${++batch}` });
    assert.equal(round.empty, false);
    const proposal = repos.proposals.forUser(user).find(p => p.role === 'seeker' && p.status === 'proposed');
    assert.ok(proposal);
    return { ...proposal, round };
  };
  const application = user => repos.recommendations.requests(user, { scope: 'own' }).find(r => r.status === 'pending');
  const proposal = user => repos.proposals.forUser(user).find(p => p.role === 'seeker');
  const claims = () => db.prepare("SELECT * FROM active_seat_claims WHERE status IN('proposed','confirmed') ORDER BY queue_order").all();
  const remaining = () => repos.parties.findById('p1').remaining_capacity;
  return { db, repos, matching, offer, application, proposal, claims, remaining };
}

test('mixed requests share FIFO and a rejected head transfers its seat to the automatic offer', () => {
  const f = fixture();
  try {
    const direct = f.repos.recommendations.requestJoin('directA', 'p1');
    const automatic = f.offer('autoA');
    const waiting = f.repos.recommendations.requestJoin('directB', 'p1');
    assert.deepEqual(f.claims().map(c => [c.source, c.seat_held]), [['direct', 1], ['algorithm', 0], ['direct', 0]]);
    assert.equal(f.remaining(), 0);
    assert.equal(f.proposal('autoA').queuePosition, 2);
    assert.equal(f.proposal('autoA').queueStatus, 'waiting');
    assert.equal(f.proposal('autoA').canHostRespond, false);
    for (const who of ['host', 'autoA'])
      assert.equal(f.repos.proposals.respond(who, automatic.id, 'accept').error, 'request_waiting_in_queue');
    assert.equal(f.proposal('autoA').hostApproved, false);
    assert.equal(f.proposal('autoA').seekerApproved, false);
    assert.throws(() => f.db.prepare(`UPDATE match_proposals SET host_approved_at=datetime('now'),
      seeker_approved_at=datetime('now'),status='confirmed' WHERE id=?`).run(automatic.id), /request_waiting_in_queue/);
    for (const column of ['host_approved_at', 'seeker_approved_at'])
      assert.throws(() => f.db.prepare(`UPDATE match_proposals SET ${column}=datetime('now') WHERE id=?`)
        .run(automatic.id), /request_waiting_in_queue/);

    f.repos.recommendations.respond('host', direct.id, 'reject');
    assert.equal(f.remaining(), 0);
    assert.equal(f.proposal('autoA').queuePosition, 1);
    assert.equal(f.proposal('autoA').seatReserved, true);
    assert.equal(f.repos.proposals.respond('host', automatic.id, 'accept').status, 'proposed');
    assert.equal(f.repos.membership.active('autoA', 'c1'), undefined);
    assert.equal(f.repos.proposals.respond('autoA', automatic.id, 'accept').status, 'confirmed');
    assert.equal(f.repos.membership.active('autoA', 'c1').source, 'proposal');
    assert.equal(f.remaining(), 0);
    const cleared = f.db.prepare('SELECT status,resolution_reason FROM group_join_requests WHERE id=?').get(waiting.id);
    assert.deepEqual(cleared, { status: 'superseded', resolution_reason: 'group_full' });
    assert.equal(f.repos.groups.seeker('directB', 'c1').status, 'open');
    assert.equal(f.claims().length, 1);
    assert.equal(f.matching.reverify(automatic.round.roundId).verified, true);
  } finally { f.db.close(); }
});

test('automatic batches queue behind older offers without rewriting their saved results', () => {
  const f = fixture();
  try {
    const first = f.offer('autoA');
    const direct = f.repos.recommendations.requestJoin('directA', 'p1');
    const before = f.db.prepare('SELECT * FROM match_results WHERE round_id=?').all(first.round.roundId);
    const last = f.offer('autoB');
    assert.deepEqual(f.claims().map(c => c.user_id), ['autoA', 'directA', 'autoB']);
    assert.equal(f.proposal('autoB').queuePosition, 3);
    assert.equal(f.proposal('autoB').seatReserved, false);
    assert.equal(f.repos.proposals.respond('host', last.id, 'decline').error, 'request_waiting_in_queue');
    assert.equal(f.repos.proposals.respond('autoB', last.id, 'decline').status, 'declined');
    assert.equal(f.remaining(), 0);
    f.repos.recommendations.respond('directA', direct.id, 'withdraw');
    assert.equal(f.remaining(), 0);
    assert.equal(f.repos.proposals.respond('autoA', first.id, 'decline').status, 'declined');
    assert.equal(f.remaining(), 1);
    assert.deepEqual(f.db.prepare('SELECT * FROM match_results WHERE round_id=?').all(first.round.roundId), before);
    assert.equal(f.matching.reverify(first.round.roundId).verified, true);
    assert.equal(f.matching.reverify(last.round.roundId).verified, true);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM group_memberships WHERE source=\'proposal\'').get().n, 0);
  } finally { f.db.close(); }
});

test('expiry of a direct head promotes a waiting automatic offer before approval', () => {
  const f = fixture();
  try {
    const direct = f.repos.recommendations.requestJoin('directA', 'p1');
    const automatic = f.offer('autoA');
    f.db.prepare('UPDATE group_join_requests SET expires_at=? WHERE id=?').run(Date.now() - 1000, direct.id);
    assert.equal(f.repos.proposals.respond('autoA', automatic.id, 'accept').status, 'proposed');
    assert.equal(f.proposal('autoA').hostApproved, false);
    assert.equal(f.proposal('autoA').seekerApproved, true);
    assert.equal(f.proposal('autoA').queuePosition, 1);
    assert.equal(f.remaining(), 0);
    assert.equal(f.repos.proposals.respond('host', automatic.id, 'accept').status, 'confirmed');
    assert.equal(f.repos.groups.seeker('directA', 'c1').status, 'open');
  } finally { f.db.close(); }
});

test('multiple places retain FIFO approvals and routine admissions do not invalidate the next request', () => {
  const f = fixture(2, true);
  try {
    const first = f.repos.recommendations.requestJoin('directA', 'p1');
    const second = f.repos.recommendations.requestJoin('directB', 'p1');
    const automatic = f.offer('autoA');
    assert.deepEqual(f.claims().map(c => c.seat_held), [1, 1, 0]);
    assert.equal(f.remaining(), 0);
    assert.throws(() => f.repos.recommendations.respond('host', second.id, 'accept'), /request_waiting_in_queue/);
    f.repos.recommendations.respond('host', first.id, 'accept');
    assert.equal(f.remaining(), 0);
    assert.equal(f.application('directB').queuePosition, 1);
    assert.equal(f.repos.proposals.respond('autoA', automatic.id, 'accept').error, 'request_waiting_in_queue');
    f.repos.recommendations.respond('host', second.id, 'accept');
    assert.equal(f.repos.membership.active('directB', 'c1').source, 'join');
    assert.equal(f.proposal('autoA').status, 'cancelled');
    assert.equal(f.repos.groups.seeker('autoA', 'c1').status, 'open');
    assert.equal(f.repos.proposals.declinedPairsForConcert('c1').has('s_autoA|p1'), false);
    assert.equal(f.claims().filter(c => c.status === 'confirmed').length, 2);
    assert.equal(f.remaining(), 0);
  } finally { f.db.close(); }
});

test('a partially approved automatic head keeps priority until its applicant withdraws', () => {
  const f = fixture();
  try {
    const automatic = f.offer('autoA');
    assert.equal(f.repos.proposals.respond('host', automatic.id, 'accept').status, 'proposed');
    const direct = f.repos.recommendations.requestJoin('directA', 'p1');
    assert.equal(f.application('directA').queueStatus, 'waiting');
    assert.throws(() => f.repos.recommendations.respond('host', direct.id, 'accept'), /request_waiting_in_queue/);
    assert.equal(f.repos.proposals.respond('autoA', automatic.id, 'decline').status, 'declined');
    assert.equal(f.remaining(), 0);
    assert.equal(f.application('directA').queueStatus, 'held');
    assert.equal(f.repos.recommendations.respond('host', direct.id, 'accept').status, 'accepted');
    assert.equal(f.repos.membership.active('directA', 'c1').source, 'join');
  } finally { f.db.close(); }
});

test('waiting candidates cannot enter another automatic round and keep their original deadline', () => {
  const f = fixture();
  try {
    f.repos.recommendations.requestJoin('directA', 'p1');
    const automatic = f.offer('autoA');
    assert.equal(f.repos.groups.seeker('autoA', 'c1').status, 'matched');
    assert.throws(() => f.repos.recommendations.setJoiningMode('autoA', 'c1', 'direct'), /active_seat_claim_exists/);
    const again = f.matching.run('c1', { batchKey: 'no_duplicate_waiting' });
    assert.equal(again.empty, true);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM match_proposals WHERE seeker_request_id=?').get('s_autoA').n, 1);
    assert.equal(f.proposal('autoA').expiresAt, automatic.expiresAt);
    assert.deepEqual(f.db.pragma('foreign_key_check'), []);
  } finally { f.db.close(); }
});
