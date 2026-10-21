import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db/connection.js';
import { migrateCommunity } from '../src/db/communityMigrations.js';
import { migrateHybrid } from '../src/db/hybridMigrations.js';
import { createRepositories } from '../src/db/repositories.js';
import { createMatchingService } from '../src/services/matchingService.js';
import { makeUser, makeParty, makeSeeker } from './helpers.js';

function legacyDb(capacity = 2) {
  const db = createTestDb({ hybrid: false });
  const user = db.prepare("INSERT INTO users(id,display_name,age_band,home_region,gender,vibe_json) VALUES(?,?,'21-24','central','f','{}')");
  for (const id of ['host','otherHost','one','two']) user.run(id,id);
  db.exec(`INSERT INTO concerts(id,artist,venue,city,event_date) VALUES('c1','Show','Venue','Singapore','2030-01-01');
    INSERT INTO parties(id,host_user_id,concert_id,capacity,section,spend_band,arrival_plan)
      VALUES('p1','host','c1',${capacity},'ga_standing',2,'mid');
    INSERT INTO seeker_requests(id,user_id,concert_id,section_pref,spend_band_max,arrival_pref)
      VALUES('s1','one','c1','ga_standing',3,'mid'),('s2','two','c1','ga_standing',3,'mid');
    INSERT INTO match_rounds(id,concert_id,is_stable,seeker_count,party_count,total_capacity,feasible_pairs,matched_count,metrics_json,timings_json)
      VALUES('round1','c1',1,2,1,${capacity},2,1,'{}','{}');
    INSERT INTO match_results(id,round_id,seeker_request_id,party_id,outcome)
      VALUES('result1','round1','s1','p1','matched'),('result2','round1','s2','p1','matched');`);
  return db;
}
function oldProposal(db, { id='offer1', seeker='s1', result='result1', status='proposed' } = {}) {
  db.prepare(`INSERT INTO match_proposals(id,round_id,match_result_id,seeker_request_id,party_id,status,expires_at)
    VALUES(?,'round1',?,?,'p1',?,?)`).run(id,result,seeker,status,Date.now()+3600000);
}
function currentDb(capacity = 1) {
  const db = createTestDb(), repos = createRepositories(db);
  for (const id of ['host','otherHost','one','two']) repos.users.create(makeUser(id));
  repos.concerts.create({id:'c1',artist:'Show',venue:'Venue',city:'Singapore',event_date:'2030-01-01'});
  repos.parties.create(makeParty('p1',makeUser('host'),{capacity}));
  for (const id of ['one','two']) repos.seekers.create(makeSeeker(`s_${id}`,makeUser(id),{joining_mode:id==='two'?'direct':'algorithm'}));
  const matching = createMatchingService({db,repos});
  return {db,repos,matching};
}
const claims = db => db.prepare("SELECT * FROM active_seat_claims WHERE status IN('proposed','confirmed') ORDER BY id").all();

test('fresh hybrid migration repeats with foreign keys and legacy-default modes intact', () => {
  const db = createTestDb();
  try {
    const before = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n;
    migrateCommunity(db); migrateHybrid(db); migrateHybrid(db);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n,before);
    assert.equal(db.prepare("PRAGMA table_info(seeker_requests)").all().find(c=>c.name==='joining_mode').dflt_value,"'algorithm'");
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
    assert.equal(db.pragma('foreign_keys',{simple:true}),1);
    assert.deepEqual(claims(db),[]);
  } finally { db.close(); }
});

test('old proposed assignments backfill as reserved offers without confirmation or history changes', () => {
  const db = legacyDb();
  try {
    oldProposal(db);
    const history = db.prepare('SELECT * FROM match_results ORDER BY id').all();
    migrateHybrid(db); migrateHybrid(db);
    assert.equal(claims(db).length,1);
    assert.equal(claims(db)[0].status,'proposed');
    const offer = db.prepare("SELECT * FROM match_proposals WHERE id='offer1'").get();
    assert.equal(offer.status,'proposed');
    assert.equal(offer.host_approved_at,null);
    assert.equal(offer.seeker_approved_at,null);
    assert.deepEqual(db.prepare('SELECT * FROM match_results ORDER BY id').all(),history);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  } finally { db.close(); }
});

test('previously confirmed proposals stay confirmed without inventing host approval', () => {
  const db = legacyDb();
  try {
    oldProposal(db,{status:'confirmed'}); migrateCommunity(db); migrateHybrid(db);
    const repos = createRepositories(db), offer = repos.proposals.forUser('one')[0];
    assert.equal(offer.status,'confirmed');
    assert.equal(offer.approvalPolicy,'legacy_confirmed');
    assert.equal(offer.hostApproved,false);
    assert.equal(claims(db)[0].status,'confirmed');
    assert.equal(repos.recommendations.currentMemberships('one')[0].assignmentOrigin,'algorithm');
    migrateCommunity(db); migrateHybrid(db);
    assert.equal(claims(db).length,1);
  } finally { db.close(); }
});

test('legacy pending automatic applications become mutual offers linked to real existing results', () => {
  const db = legacyDb();
  try {
    const expires = Date.now()+3600000;
    db.prepare(`INSERT INTO group_join_requests(id,party_id,user_id,status,expires_at,matching_round_id,created_at)
      VALUES('old_auto','p1','one','pending',?,'round1','2026-10-01 12:00:00')`).run(expires);
    const history = db.prepare('SELECT * FROM match_results ORDER BY id').all();
    migrateHybrid(db);
    const old = db.prepare("SELECT * FROM group_join_requests WHERE id='old_auto'").get();
    const offer = db.prepare("SELECT * FROM match_proposals WHERE legacy_join_request_id='old_auto'").get();
    assert.equal(old.status,'superseded');
    assert.equal(old.resolution_reason,'migrated_to_mutual_proposal');
    assert.equal(offer.match_result_id,'result1');
    assert.equal(offer.expires_at,expires);
    assert.equal(offer.created_at,'2026-10-01 12:00:00');
    assert.deepEqual(db.prepare('SELECT * FROM match_results ORDER BY id').all(),history);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM match_rounds").get().n,1);
    const repos = createRepositories(db);
    assert.equal(repos.proposals.respond('host',offer.id,'accept').status,'proposed');
    assert.equal(repos.membership.active('one','c1'),undefined);
    assert.equal(repos.proposals.respond('one',offer.id,'accept').status,'confirmed');
    assert.equal(claims(db).length,1);
    assert.equal(repos.membership.active('one','c1').source,'proposal');
    migrateHybrid(db);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM match_proposals').get().n,1);
  } finally { db.close(); }
});

test('confirmed historical automatic group memberships retain their origin and one claim', () => {
  const db = legacyDb();
  try {
    db.prepare(`INSERT INTO group_join_requests(id,party_id,user_id,status,expires_at,matching_round_id)
      VALUES('old_accepted','p1','one','accepted',?,'round1')`).run(Date.now()+3600000);
    db.exec("INSERT INTO group_memberships(party_id,user_id,concert_id,source) VALUES('p1','one','c1','join')");
    migrateHybrid(db); migrateHybrid(db);
    assert.equal(claims(db)[0].source,'algorithm');
    assert.equal(claims(db)[0].status,'confirmed');
    assert.equal(db.prepare("SELECT status FROM group_join_requests WHERE id='old_accepted'").get().status,'accepted');
    assert.equal(createRepositories(db).recommendations.currentMemberships('one')[0].assignmentOrigin,'algorithm');
  } finally { db.close(); }
});

test('overbooked old data aborts the whole upgrade and restores foreign-key enforcement', () => {
  const db = legacyDb(1);
  try {
    oldProposal(db); oldProposal(db,{id:'offer2',seeker:'s2',result:'result2'});
    const history = db.prepare('SELECT * FROM match_results ORDER BY id').all();
    assert.throws(()=>migrateHybrid(db),/hybrid_capacity_reconciliation_required/);
    assert.equal(db.pragma('foreign_keys',{simple:true}),1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='active_seat_claims'").get().n,0);
    assert.equal(db.prepare('PRAGMA table_info(seeker_requests)').all().some(c=>c.name==='joining_mode'),false);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM match_proposals').get().n,2);
    assert.deepEqual(db.prepare('SELECT * FROM match_results ORDER BY id').all(),history);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  } finally { db.close(); }
});

test('orphan historical stranger memberships require deliberate reconciliation', () => {
  const db = legacyDb();
  try {
    db.exec("INSERT INTO group_memberships(party_id,user_id,concert_id,source) VALUES('p1','one','c1','join')");
    assert.throws(()=>migrateHybrid(db),/hybrid_membership_reconciliation_required/);
    assert.equal(db.prepare("SELECT status FROM group_memberships WHERE user_id='one'").get().status,'active');
    assert.equal(db.pragma('foreign_keys',{simple:true}),1);
  } finally { db.close(); }
});

test('legacy direct applications can select direct mode without erasing their pending choice', () => {
  const db = legacyDb();
  try {
    db.prepare(`INSERT INTO group_join_requests(id,party_id,user_id,status,expires_at)
      VALUES('manual','p1','one','pending',?)`).run(Date.now()+3600000);
    migrateHybrid(db);
    const repos = createRepositories(db);
    assert.equal(repos.groups.seeker('one','c1').joining_mode,'algorithm');
    repos.recommendations.setJoiningMode('one','c1','direct');
    assert.equal(db.prepare("SELECT status FROM group_join_requests WHERE id='manual'").get().status,'pending');
    assert.throws(()=>repos.recommendations.setJoiningMode('one','c1','algorithm'),/withdraw_pending_applications_first/);
    assert.equal(claims(db).length,0);
  } finally { db.close(); }
});

test('the database prevents direct and algorithm sources from taking the same last seat', () => {
  const {db,repos,matching} = currentDb();
  try {
    const app = repos.recommendations.requestJoin('two','p1');
    matching.run('c1',{batchKey:'last-seat'});
    const offer = repos.proposals.forUser('one')[0];
    assert.equal(claims(db).length,1);
    assert.throws(()=>db.prepare("UPDATE group_join_requests SET status='accepted' WHERE id=?").run(app.id),/seat_capacity_exceeded/);
    assert.equal(db.prepare('SELECT status FROM group_join_requests WHERE id=?').get(app.id).status,'pending');
    assert.equal(repos.proposals.respond('host',offer.id,'decline').status,'declined');
    repos.recommendations.respond('host',app.id,'accept');
    assert.equal(claims(db).length,1);
    assert.equal(claims(db)[0].source,'direct');
    assert.equal(repos.parties.findById('p1').remaining_capacity,0);
  } finally { db.close(); }
});

test('failed final approval rolls back its approval, membership and notification writes', () => {
  const {db,repos,matching} = currentDb();
  try {
    matching.run('c1',{batchKey:'approval-rollback'});
    const offer = repos.proposals.forUser('one')[0];
    repos.proposals.respond('one',offer.id,'accept');
    const notices = db.prepare('SELECT COUNT(*) n FROM notifications').get().n;
    db.exec("CREATE TRIGGER refuse_final_member BEFORE INSERT ON group_memberships WHEN NEW.source='proposal' BEGIN SELECT RAISE(ABORT,'test_membership_refused'); END");
    assert.throws(()=>repos.proposals.respond('host',offer.id,'accept'),/test_membership_refused/);
    const row = db.prepare('SELECT * FROM match_proposals WHERE id=?').get(offer.id);
    assert.equal(row.status,'proposed'); assert.equal(row.host_approved_at,null); assert.ok(row.seeker_approved_at);
    assert.equal(claims(db)[0].status,'proposed');
    assert.equal(repos.membership.active('one','c1'),undefined);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n,notices);
    db.exec('DROP TRIGGER refuse_final_member');
    assert.equal(repos.proposals.respond('host',offer.id,'accept').status,'confirmed');
  } finally { db.close(); }
});

test('claim identity, expiry, source consistency and reserved-person hosting have database defenses', () => {
  const {db,repos,matching} = currentDb();
  try {
    matching.run('c1',{batchKey:'ledger-guards'});
    const claim = claims(db)[0];
    assert.throws(()=>db.prepare('UPDATE active_seat_claims SET expires_at=expires_at+10000 WHERE id=?').run(claim.id),/claim_source_invalid/);
    assert.throws(()=>db.prepare("UPDATE active_seat_claims SET status='released' WHERE id=?").run(claim.id),/claim_source_still_active/);
    assert.throws(()=>db.prepare('DELETE FROM active_seat_claims WHERE id=?').run(claim.id),/claim_history_required/);
    assert.throws(()=>repos.parties.create(makeParty('newHost',makeUser('one'))),/seeker_already_reserved/);
    db.prepare(`INSERT INTO parties(id,host_user_id,concert_id,capacity,section,spend_band,arrival_plan,status)
      VALUES('oldHost','one','c1',1,'ga_standing',2,'mid','cancelled')`).run();
    assert.throws(()=>db.prepare("UPDATE parties SET status='open' WHERE id='oldHost'").run(),/seeker_already_reserved/);
    assert.throws(()=>db.prepare("UPDATE seeker_requests SET joining_mode='direct' WHERE id='s_one'").run(),/active_seat_claim_exists/);
  } finally { db.close(); }
});

test('group cancellation releases both-approval offers without deleting source or result history', () => {
  const {db,repos,matching} = currentDb();
  try {
    matching.run('c1',{batchKey:'cancel-pending'});
    const offer = repos.proposals.forUser('one')[0];
    repos.proposals.respond('one',offer.id,'accept');
    const history = db.prepare('SELECT * FROM match_results').all();
    repos.membership.cancel('host','p1');
    assert.equal(claims(db).length,0);
    assert.equal(db.prepare('SELECT status FROM match_proposals WHERE id=?').get(offer.id).status,'cancelled');
    assert.equal(repos.groups.seeker('one','c1').status,'open');
    assert.deepEqual(db.prepare('SELECT * FROM match_results').all(),history);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM active_seat_claims').get().n,1);
  } finally { db.close(); }
});

test('a corrupted released ledger row cannot hide a still-active source during migration', () => {
  const {db,matching} = currentDb();
  try {
    matching.run('c1',{batchKey:'corrupt-ledger'});
    db.exec("DROP TRIGGER seat_claim_update_guard; UPDATE active_seat_claims SET status='released'");
    assert.throws(()=>migrateHybrid(db),/hybrid_claim_reconciliation_required/);
    assert.equal(db.prepare('SELECT status FROM match_proposals').get().status,'proposed');
    assert.equal(db.pragma('foreign_keys',{simple:true}),1);
  } finally { db.close(); }
});

test('historical ended direct memberships remain history and no longer block a new application', () => {
  const db = legacyDb();
  try {
    db.prepare(`INSERT INTO group_join_requests(id,party_id,user_id,status,expires_at)
      VALUES('ended','p1','one','accepted',?)`).run(Date.now()+3600000);
    db.exec("INSERT INTO group_memberships(party_id,user_id,concert_id,source,status,left_at) VALUES('p1','one','c1','join','left','2026-10-01 12:00:00')");
    migrateHybrid(db);
    const ended = db.prepare("SELECT * FROM group_join_requests WHERE id='ended'").get();
    assert.equal(ended.status,'cancelled');
    assert.equal(ended.resolution_reason,'legacy_membership_ended');
    assert.equal(claims(db).length,0);
    const repos = createRepositories(db);
    repos.recommendations.setJoiningMode('one','c1','direct');
    assert.equal(repos.recommendations.requestJoin('one','p1').status,'pending');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM group_join_requests').get().n,2);
  } finally { db.close(); }
});
