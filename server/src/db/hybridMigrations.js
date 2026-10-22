/** Shared seat ledger for direct admissions and algorithm offers.
 * Source rows retain their history; triggers maintain the ledger in the same write transaction. */
const nowSql = "unixepoch('subsec') * 1000";
export const liveClaimSql = (alias = 'sc') =>
  `(${alias}.status='confirmed' OR (${alias}.status='proposed' AND ${alias}.expires_at>${nowSql}))`;
export const heldClaimSql = (alias = 'sc') => `(${alias}.seat_held=1 AND ${liveClaimSql(alias)})`;
// Replace our definitions on upgrade too: IF NOT EXISTS alone would leave old
// deployments using the non-queue reservation rules. Other feature triggers stay.
const hybridTriggers = [
  'mutual_proposal_insert_guard','mutual_proposal_update_guard','automatic_application_insert_guard',
  'seat_claim_insert_guard','seat_claim_update_guard','seat_claim_no_delete','seat_claim_created','seat_claim_changed',
  'proposal_expired_claims_before_insert','application_expired_claims_before_insert','application_expired_claims_before_accept',
  'proposal_seat_created','proposal_seat_changed','proposal_seat_identity_guard','application_seat_created','application_seat_changed',
  'application_seat_identity_guard','seat_capacity_party_guard','seat_capacity_settings_guard','reserved_seeker_cannot_host',
  'reserved_seeker_host_update','seat_capacity_settings_delete','membership_seat_assignment_guard','membership_seat_update_guard',
  'stranger_membership_claim_insert','stranger_membership_claim_update','membership_seat_left','party_seats_cancelled',
  'joining_mode_guard','application_fifo_accept','proposal_fifo_confirm','proposal_fifo_approval',
  'queue_party_capacity_changed','queue_settings_created','queue_settings_changed','queue_settings_deleted',
];

function upgradeApplications(db) {
  const original = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='group_join_requests'").get().sql;
  if (!original.includes("'superseded'") || /UNIQUE\s*\(\s*party_id\s*,\s*user_id\s*\)/i.test(original)) {
    // Preserve dependent event rows and triggers while replacing only the old status/unique constraints.
    const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND instr(sql,'group_join_requests')>0").all();
    const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='group_join_requests' AND sql IS NOT NULL").all();
    for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`);
    const upgraded = original
      .replace(/CREATE TABLE(?: IF NOT EXISTS)?\s+["`\[]?group_join_requests["`\]]?/i, 'CREATE TABLE group_join_requests_hybrid')
      .replace(/CHECK\s*\(\s*status\s+IN\s*\([^)]*\)\s*\)/i,
        "CHECK(status IN ('pending','accepted','rejected','withdrawn','expired','superseded','cancelled'))")
      .replace(/,\s*UNIQUE\s*\(\s*party_id\s*,\s*user_id\s*\)/i, '');
    db.exec(upgraded);
    const columns = db.prepare('PRAGMA table_info(group_join_requests)').all().map(c => `"${c.name.replaceAll('"','""')}"`).join(',');
    db.exec(`INSERT INTO group_join_requests_hybrid(${columns}) SELECT ${columns} FROM group_join_requests;
      DROP TABLE group_join_requests;
      ALTER TABLE group_join_requests_hybrid RENAME TO group_join_requests;`);
    for (const index of indexes) db.exec(index.sql);
    for (const trigger of triggers) db.exec(trigger.sql);
  }
  const columns = new Set(db.prepare('PRAGMA table_info(group_join_requests)').all().map(c => c.name));
  for (const [name, definition] of [
    ['seeker_request_id', 'TEXT REFERENCES seeker_requests(id)'],
    ['application_note', "TEXT NOT NULL DEFAULT '' CHECK(length(application_note)<=500)"],
    ['responded_by', 'TEXT REFERENCES users(id)'],
    ['resolution_reason', 'TEXT'],
  ]) if (!columns.has(name)) db.exec(`ALTER TABLE group_join_requests ADD COLUMN ${name} ${definition}`);
  db.exec(`UPDATE group_join_requests SET seeker_request_id=(
    SELECT s.id FROM seeker_requests s JOIN parties p ON p.concert_id=s.concert_id
    WHERE p.id=group_join_requests.party_id AND s.user_id=group_join_requests.user_id)
    WHERE seeker_request_id IS NULL AND status IN('pending','accepted');
    UPDATE group_join_requests SET status='cancelled',responded_at=COALESCE(responded_at,datetime('now')),
      resolution_reason=COALESCE(resolution_reason,'legacy_membership_ended') WHERE status='accepted' AND (
      EXISTS(SELECT 1 FROM group_memberships gm WHERE gm.party_id=group_join_requests.party_id
        AND gm.user_id=group_join_requests.user_id AND gm.status='left') OR
      EXISTS(SELECT 1 FROM parties p WHERE p.id=group_join_requests.party_id AND p.status='cancelled'));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_group_application ON group_join_requests(party_id,user_id)
      WHERE status IN('pending','accepted');
    CREATE INDEX IF NOT EXISTS idx_applications_seeker ON group_join_requests(seeker_request_id,status);`);
}

function upgradeApprovals(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(match_proposals)').all().map(c => c.name));
  for (const name of ['seeker_approved_at','host_approved_at'])
    if (!columns.has(name)) db.exec(`ALTER TABLE match_proposals ADD COLUMN ${name} TEXT`);
  if (!columns.has('legacy_join_request_id'))
    db.exec('ALTER TABLE match_proposals ADD COLUMN legacy_join_request_id TEXT REFERENCES group_join_requests(id)');
  if (!columns.has('resolution_reason')) db.exec('ALTER TABLE match_proposals ADD COLUMN resolution_reason TEXT');
  if (!columns.has('approval_policy')) {
    db.exec("ALTER TABLE match_proposals ADD COLUMN approval_policy TEXT NOT NULL DEFAULT 'mutual' CHECK(approval_policy IN('mutual','legacy_confirmed'))");
    // Keep existing confirmed memberships, explicitly labelled as the earlier policy.
    // Do not invent evidence that their hosts approved under the new policy.
    db.exec(`UPDATE match_proposals SET approval_policy='legacy_confirmed',
      seeker_approved_at=${columns.has('confirmed_at') ? 'COALESCE(confirmed_at,created_at)' : 'created_at'} WHERE status='confirmed'`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_legacy_application ON match_proposals(legacy_join_request_id) WHERE legacy_join_request_id IS NOT NULL');
  const pending = db.prepare(`SELECT gj.*,p.concert_id FROM group_join_requests gj JOIN parties p ON p.id=gj.party_id
    WHERE gj.matching_round_id IS NOT NULL AND gj.status='pending' AND gj.expires_at>${nowSql}`).all();
  for (const request of pending) {
    const result = db.prepare(`SELECT mr.id FROM match_results mr JOIN match_rounds r ON r.id=mr.round_id
      WHERE mr.round_id=? AND mr.party_id=? AND mr.seeker_request_id=? AND mr.outcome='matched' AND r.concert_id=?`)
      .get(request.matching_round_id,request.party_id,request.seeker_request_id,request.concert_id);
    if (!result || db.prepare('SELECT 1 FROM match_proposals WHERE match_result_id=?').get(result.id))
      throw new Error(`hybrid_legacy_offer_reconciliation_required:${request.id}`);
    if (db.prepare("SELECT 1 FROM match_proposals WHERE seeker_request_id=? AND status IN('proposed','confirmed')")
      .get(request.seeker_request_id)) throw new Error(`hybrid_legacy_offer_reconciliation_required:${request.id}`);
    db.prepare(`UPDATE group_join_requests SET status='superseded',responded_at=datetime('now'),
      resolution_reason='migrated_to_mutual_proposal' WHERE id=?`).run(request.id);
    // The actual round/result already exists. Only its operational offer changes form.
    db.prepare(`INSERT INTO match_proposals(id,round_id,match_result_id,seeker_request_id,party_id,status,expires_at,created_at,legacy_join_request_id)
      VALUES(?,?,?,?,?,'proposed',?,?,?)`).run(`mp_legacy_${request.id}`,request.matching_round_id,result.id,
        request.seeker_request_id,request.party_id,request.expires_at,request.created_at,request.id);
  }
}

function installClaimTriggers(db) {
  const guard = `
    SELECT RAISE(ABORT,'claim_source_invalid') WHERE NOT EXISTS(
      SELECT 1 FROM seeker_requests s JOIN parties p ON p.id=NEW.party_id
      WHERE s.id=NEW.seeker_request_id AND s.user_id=NEW.user_id AND s.concert_id=NEW.concert_id
        AND p.concert_id=NEW.concert_id AND p.host_user_id<>NEW.user_id);
    SELECT RAISE(ABORT,'claim_source_invalid') WHERE NEW.status IN('proposed','confirmed') AND (
      (NEW.proposal_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM match_proposals mp JOIN match_results mr ON mr.id=mp.match_result_id
        JOIN match_rounds r ON r.id=mp.round_id
        WHERE mp.id=NEW.proposal_id AND mp.seeker_request_id=NEW.seeker_request_id AND mp.party_id=NEW.party_id
          AND mr.round_id=mp.round_id AND mr.party_id=mp.party_id AND mr.seeker_request_id=mp.seeker_request_id
          AND mr.outcome='matched' AND r.concert_id=NEW.concert_id AND NEW.source='algorithm'
          AND mp.status=NEW.status AND mp.expires_at IS NEW.expires_at AND (mp.status='confirmed' OR mp.expires_at>${nowSql})))
      OR (NEW.join_request_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM group_join_requests gj WHERE gj.id=NEW.join_request_id
          AND gj.party_id=NEW.party_id AND gj.user_id=NEW.user_id AND gj.seeker_request_id=NEW.seeker_request_id AND gj.expires_at IS NEW.expires_at
          AND ((gj.matching_round_id IS NULL AND NEW.source='direct') OR (gj.matching_round_id IS NOT NULL AND NEW.source='algorithm'))
          AND ((gj.status='accepted' AND NEW.status='confirmed') OR
            (gj.status='pending' AND gj.expires_at>${nowSql} AND NEW.status='proposed')))));
    SELECT RAISE(ABORT,'request_waiting_in_queue') WHERE NEW.status='confirmed' AND NEW.seat_held<>1;
    SELECT RAISE(ABORT,'seat_capacity_exceeded') WHERE NEW.status='proposed' AND
      (SELECT COUNT(*) FROM active_seat_claims WHERE party_id=NEW.party_id AND status='confirmed') >=
      (SELECT COALESCE(gs.stranger_slots,p.capacity) FROM parties p LEFT JOIN group_settings gs ON gs.party_id=p.id WHERE p.id=NEW.party_id);
    SELECT RAISE(ABORT,'request_waiting_in_queue') WHERE NEW.status='proposed' AND NEW.seat_held=1 AND
      (SELECT COUNT(*) FROM active_seat_claims sc WHERE sc.party_id=NEW.party_id AND sc.id<>NEW.id
        AND (sc.status='confirmed' OR(sc.status='proposed' AND sc.expires_at>${nowSql} AND sc.queue_order<NEW.queue_order))) >=
      (SELECT COALESCE(gs.stranger_slots,p.capacity) FROM parties p LEFT JOIN group_settings gs ON gs.party_id=p.id WHERE p.id=NEW.party_id);
    SELECT RAISE(ABORT,'claim_assignment_conflict') WHERE NEW.status IN('proposed','confirmed') AND (
      EXISTS(SELECT 1 FROM parties WHERE id=NEW.party_id AND status='cancelled') OR
      EXISTS(SELECT 1 FROM tickets WHERE source_party_id=NEW.party_id) OR
      EXISTS(SELECT 1 FROM group_memberships WHERE user_id=NEW.user_id AND concert_id=NEW.concert_id
        AND status='active' AND party_id<>NEW.party_id) OR
      EXISTS(SELECT 1 FROM parties WHERE host_user_id=NEW.user_id AND concert_id=NEW.concert_id AND status<>'cancelled'));
    SELECT RAISE(ABORT,'seeker_already_reserved') WHERE NEW.status IN('proposed','confirmed') AND EXISTS(
      SELECT 1 FROM active_seat_claims sc WHERE sc.user_id=NEW.user_id AND sc.concert_id=NEW.concert_id
        AND sc.id<>NEW.id AND ${liveClaimSql()});
    SELECT RAISE(ABORT,'seat_capacity_exceeded') WHERE NEW.seat_held=1 AND NEW.status IN('proposed','confirmed') AND
      (SELECT COUNT(*) FROM active_seat_claims sc WHERE sc.party_id=NEW.party_id AND sc.id<>NEW.id AND ${heldClaimSql()}) >=
      (SELECT COALESCE(gs.stranger_slots,p.capacity) FROM parties p LEFT JOIN group_settings gs ON gs.party_id=p.id WHERE p.id=NEW.party_id);
  `;
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS application_fifo_accept BEFORE UPDATE OF status ON group_join_requests
      WHEN NEW.status='accepted' AND OLD.status<>'accepted' BEGIN
      SELECT RAISE(ABORT,'request_waiting_in_queue') WHERE NOT EXISTS(
        SELECT 1 FROM active_seat_claims sc WHERE sc.join_request_id=NEW.id AND sc.status='proposed'
          AND sc.seat_held=1 AND sc.expires_at>${nowSql} AND NOT EXISTS(
            SELECT 1 FROM active_seat_claims prior WHERE prior.party_id=sc.party_id AND prior.status='proposed'
              AND prior.expires_at>${nowSql} AND prior.queue_order<sc.queue_order)); END;
    CREATE TRIGGER IF NOT EXISTS proposal_fifo_confirm BEFORE UPDATE OF status ON match_proposals
      WHEN NEW.status='confirmed' AND OLD.status<>'confirmed' BEGIN
      SELECT RAISE(ABORT,'request_waiting_in_queue') WHERE NOT EXISTS(
        SELECT 1 FROM active_seat_claims sc WHERE sc.proposal_id=NEW.id AND sc.status='proposed'
          AND sc.seat_held=1 AND sc.expires_at>${nowSql} AND NOT EXISTS(
            SELECT 1 FROM active_seat_claims prior WHERE prior.party_id=sc.party_id AND prior.status='proposed'
              AND prior.expires_at>${nowSql} AND prior.queue_order<sc.queue_order)); END;
    CREATE TRIGGER IF NOT EXISTS proposal_fifo_approval BEFORE UPDATE OF host_approved_at,seeker_approved_at ON match_proposals
      WHEN (NEW.host_approved_at IS NOT NULL AND NEW.host_approved_at IS NOT OLD.host_approved_at)
        OR (NEW.seeker_approved_at IS NOT NULL AND NEW.seeker_approved_at IS NOT OLD.seeker_approved_at) BEGIN
      SELECT RAISE(ABORT,'request_waiting_in_queue') WHERE NOT EXISTS(
        SELECT 1 FROM active_seat_claims sc WHERE sc.proposal_id=NEW.id AND sc.status='proposed'
          AND sc.seat_held=1 AND sc.expires_at>${nowSql} AND NOT EXISTS(
            SELECT 1 FROM active_seat_claims prior WHERE prior.party_id=sc.party_id AND prior.status='proposed'
              AND prior.expires_at>${nowSql} AND prior.queue_order<sc.queue_order)); END;
    CREATE TRIGGER IF NOT EXISTS mutual_proposal_insert_guard BEFORE INSERT ON match_proposals BEGIN
      SELECT RAISE(ABORT,'mutual_approval_required') WHERE NEW.approval_policy<>'mutual' OR
        (NEW.status='confirmed' AND (NEW.host_approved_at IS NULL OR NEW.seeker_approved_at IS NULL)); END;
    CREATE TRIGGER IF NOT EXISTS mutual_proposal_update_guard BEFORE UPDATE ON match_proposals BEGIN
      SELECT RAISE(ABORT,'approval_policy_immutable') WHERE NEW.approval_policy<>OLD.approval_policy;
      SELECT RAISE(ABORT,'mutual_approval_required') WHERE NEW.status='confirmed' AND NEW.approval_policy='mutual'
        AND (NEW.host_approved_at IS NULL OR NEW.seeker_approved_at IS NULL); END;
    CREATE TRIGGER IF NOT EXISTS automatic_application_insert_guard BEFORE INSERT ON group_join_requests
      WHEN NEW.matching_round_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'automatic_matches_require_mutual_proposals'); END;
    CREATE TRIGGER IF NOT EXISTS seat_claim_insert_guard BEFORE INSERT ON active_seat_claims BEGIN ${guard} END;
    CREATE TRIGGER IF NOT EXISTS seat_claim_update_guard BEFORE UPDATE ON active_seat_claims BEGIN
      SELECT RAISE(ABORT,'claim_identity_immutable') WHERE NEW.id<>OLD.id OR NEW.seeker_request_id<>OLD.seeker_request_id
        OR NEW.user_id<>OLD.user_id OR NEW.concert_id<>OLD.concert_id OR NEW.party_id<>OLD.party_id OR NEW.source<>OLD.source
        OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.join_request_id IS NOT OLD.join_request_id OR NEW.queue_order<>OLD.queue_order;
      SELECT RAISE(ABORT,'claim_source_still_active') WHERE NEW.status='released' AND (
        EXISTS(SELECT 1 FROM match_proposals mp WHERE mp.id=NEW.proposal_id AND
          (mp.status='confirmed' OR(mp.status='proposed' AND mp.expires_at>${nowSql}))) OR
        EXISTS(SELECT 1 FROM group_join_requests gj WHERE gj.id=NEW.join_request_id AND
          (gj.status='accepted' OR(gj.status='pending' AND gj.expires_at>${nowSql})))
      );
      SELECT RAISE(ABORT,'request_waiting_in_queue') WHERE NEW.status='confirmed' AND OLD.status<>'confirmed' AND EXISTS(
        SELECT 1 FROM active_seat_claims sc WHERE sc.party_id=NEW.party_id AND sc.id<>NEW.id
          AND sc.status='proposed' AND sc.expires_at>${nowSql} AND sc.queue_order<NEW.queue_order);
      ${guard}
    END;
    CREATE TRIGGER IF NOT EXISTS seat_claim_no_delete BEFORE DELETE ON active_seat_claims BEGIN
      SELECT RAISE(ABORT,'claim_history_required'); END;
  `);
  const promote = partyId => `
    UPDATE active_seat_claims SET seat_held=1 WHERE party_id=${partyId} AND status='proposed'
      AND expires_at>${nowSql} AND seat_held=0
      AND (SELECT COUNT(*) FROM active_seat_claims occupied WHERE occupied.party_id=${partyId}
        AND (occupied.status='confirmed' OR(occupied.status='proposed' AND occupied.expires_at>${nowSql}
          AND occupied.queue_order<active_seat_claims.queue_order))) <
        (SELECT COALESCE(gs.stranger_slots,p.capacity) FROM parties p LEFT JOIN group_settings gs ON gs.party_id=p.id WHERE p.id=${partyId});`;
  const refresh = `
    ${promote('NEW.party_id')}
    UPDATE seeker_requests SET status='matched' WHERE id=NEW.seeker_request_id AND NEW.status IN('proposed','confirmed');
    UPDATE seeker_requests SET status='open' WHERE id=NEW.seeker_request_id AND status='matched' AND NEW.status='released'
      AND NOT EXISTS(SELECT 1 FROM active_seat_claims sc WHERE sc.seeker_request_id=NEW.seeker_request_id AND ${liveClaimSql()})
      AND NOT EXISTS(SELECT 1 FROM group_memberships gm JOIN parties p ON p.id=gm.party_id
        WHERE gm.user_id=NEW.user_id AND gm.concert_id=NEW.concert_id AND gm.status='active' AND p.status<>'cancelled');
    UPDATE parties SET status=CASE WHEN
      (SELECT COUNT(*) FROM active_seat_claims sc WHERE sc.party_id=NEW.party_id AND ${heldClaimSql()}) >=
      COALESCE((SELECT stranger_slots FROM group_settings WHERE party_id=NEW.party_id),capacity)
      THEN 'matched' ELSE 'open' END WHERE id=NEW.party_id AND status<>'cancelled';
    UPDATE group_join_requests SET status='superseded',responded_at=datetime('now')
      WHERE NEW.status='confirmed' AND user_id=NEW.user_id AND status='pending' AND id IS NOT NEW.join_request_id
        AND party_id IN(SELECT id FROM parties WHERE concert_id=NEW.concert_id);
    UPDATE group_join_requests SET status='superseded',responded_at=datetime('now'),resolution_reason='group_full'
      WHERE NEW.status='confirmed' AND party_id=NEW.party_id AND status='pending' AND
        (SELECT COUNT(*) FROM active_seat_claims WHERE party_id=NEW.party_id AND status='confirmed')>=
          (SELECT COALESCE(gs.stranger_slots,p.capacity) FROM parties p LEFT JOIN group_settings gs ON gs.party_id=p.id WHERE p.id=NEW.party_id);
    UPDATE match_proposals SET status='cancelled',resolution_reason='group_full'
      WHERE NEW.status='confirmed' AND party_id=NEW.party_id AND status='proposed' AND
        (SELECT COUNT(*) FROM active_seat_claims WHERE party_id=NEW.party_id AND status='confirmed')>=
          (SELECT COALESCE(gs.stranger_slots,p.capacity) FROM parties p LEFT JOIN group_settings gs ON gs.party_id=p.id WHERE p.id=NEW.party_id);
    -- SQLite suppresses re-entry of a source trigger while it is already on the
    -- stack. Synchronize cascaded terminal sources explicitly before reopening.
    UPDATE active_seat_claims SET status='released',seat_held=0,released_at=datetime('now')
      WHERE party_id=NEW.party_id AND status='proposed' AND (
        (join_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM group_join_requests gj
          WHERE gj.id=active_seat_claims.join_request_id AND gj.status='pending' AND gj.expires_at>${nowSql})) OR
        (proposal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM match_proposals mp
          WHERE mp.id=active_seat_claims.proposal_id AND mp.status='proposed' AND mp.expires_at>${nowSql})));
    UPDATE seeker_requests SET status='open' WHERE status='matched' AND id IN(
      SELECT seeker_request_id FROM active_seat_claims WHERE party_id=NEW.party_id)
      AND NOT EXISTS(SELECT 1 FROM active_seat_claims sc WHERE sc.seeker_request_id=seeker_requests.id AND ${liveClaimSql()})
      AND NOT EXISTS(SELECT 1 FROM group_memberships gm JOIN parties p ON p.id=gm.party_id
        WHERE gm.user_id=seeker_requests.user_id AND gm.concert_id=seeker_requests.concert_id
          AND gm.status='active' AND p.status<>'cancelled');
  `;
  db.exec(`CREATE TRIGGER IF NOT EXISTS seat_claim_created AFTER INSERT ON active_seat_claims BEGIN ${refresh} END;
    CREATE TRIGGER IF NOT EXISTS seat_claim_changed AFTER UPDATE ON active_seat_claims BEGIN ${refresh} END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS queue_party_capacity_changed AFTER UPDATE OF capacity ON parties BEGIN ${promote('NEW.id')} END;
    CREATE TRIGGER IF NOT EXISTS queue_settings_created AFTER INSERT ON group_settings BEGIN ${promote('NEW.party_id')} END;
    CREATE TRIGGER IF NOT EXISTS queue_settings_changed AFTER UPDATE OF stranger_slots ON group_settings BEGIN ${promote('NEW.party_id')} END;
    CREATE TRIGGER IF NOT EXISTS queue_settings_deleted AFTER DELETE ON group_settings BEGIN ${promote('OLD.party_id')} END;`);
  const expireClaims = `UPDATE active_seat_claims SET status='released',seat_held=0,released_at=datetime('now')
    WHERE status='proposed' AND expires_at<=${nowSql};`;
  const expireSources = `
    UPDATE match_proposals SET status='expired' WHERE status='proposed' AND expires_at<=${nowSql};
    UPDATE group_join_requests SET status='expired',responded_at=datetime('now') WHERE status='pending' AND expires_at<=${nowSql};
    ${expireClaims}`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS proposal_expired_claims_before_insert BEFORE INSERT ON match_proposals BEGIN
    ${expireSources} END;
    CREATE TRIGGER IF NOT EXISTS application_expired_claims_before_insert BEFORE INSERT ON group_join_requests BEGIN
    ${expireSources} END;
    CREATE TRIGGER IF NOT EXISTS application_expired_claims_before_accept BEFORE UPDATE OF status ON group_join_requests
      WHEN NEW.status='accepted' BEGIN
        UPDATE group_join_requests SET status='expired',responded_at=datetime('now')
          WHERE status='pending' AND expires_at<=${nowSql} AND id<>NEW.id;
        ${expireClaims} END;`);
  const heldForNew = `(SELECT CASE WHEN (SELECT COUNT(*) FROM active_seat_claims sc
    WHERE sc.party_id=NEW.party_id AND ${liveClaimSql()}) <
    COALESCE((SELECT stranger_slots FROM group_settings WHERE party_id=NEW.party_id),(SELECT capacity FROM parties WHERE id=NEW.party_id))
    THEN 1 ELSE 0 END)`;
  const nextOrder = '(SELECT COALESCE(MAX(queue_order),0)+1 FROM active_seat_claims)';
  const proposalValues = `SELECT 'proposal:'||NEW.id,NEW.seeker_request_id,s.user_id,s.concert_id,NEW.party_id,'algorithm',
    NEW.id,NULL,NEW.status,NEW.expires_at,${heldForNew},${nextOrder} FROM seeker_requests s WHERE s.id=NEW.seeker_request_id`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS proposal_seat_created AFTER INSERT ON match_proposals
    WHEN NEW.status='confirmed' OR(NEW.status='proposed' AND NEW.expires_at>${nowSql}) BEGIN
      INSERT INTO active_seat_claims(id,seeker_request_id,user_id,concert_id,party_id,source,proposal_id,join_request_id,status,expires_at,seat_held,queue_order)
        ${proposalValues}; END;
    CREATE TRIGGER IF NOT EXISTS proposal_seat_changed AFTER UPDATE OF status,expires_at ON match_proposals BEGIN
      UPDATE active_seat_claims SET status=CASE WHEN NEW.status='confirmed' THEN 'confirmed'
          WHEN NEW.status='proposed' AND NEW.expires_at>${nowSql} THEN 'proposed' ELSE 'released' END,
        seat_held=CASE WHEN NEW.status='confirmed' THEN 1 WHEN NEW.status='proposed' AND NEW.expires_at>${nowSql} THEN seat_held ELSE 0 END,
        expires_at=NEW.expires_at,released_at=CASE WHEN NEW.status IN('confirmed','proposed') AND NEW.expires_at>${nowSql}
          OR NEW.status='confirmed' THEN NULL ELSE datetime('now') END WHERE proposal_id=NEW.id;
      INSERT INTO active_seat_claims(id,seeker_request_id,user_id,concert_id,party_id,source,proposal_id,join_request_id,status,expires_at,seat_held,queue_order)
        ${proposalValues} AND (NEW.status='confirmed' OR(NEW.status='proposed' AND NEW.expires_at>${nowSql}))
          AND NOT EXISTS(SELECT 1 FROM active_seat_claims WHERE proposal_id=NEW.id); END;
    CREATE TRIGGER IF NOT EXISTS proposal_seat_identity_guard BEFORE UPDATE OF seeker_request_id,party_id,round_id,match_result_id ON match_proposals
      WHEN NEW.seeker_request_id<>OLD.seeker_request_id OR NEW.party_id<>OLD.party_id OR NEW.round_id<>OLD.round_id OR NEW.match_result_id<>OLD.match_result_id
      BEGIN SELECT RAISE(ABORT,'claim_identity_immutable'); END;`);
  const applicationValues = `SELECT 'application:'||NEW.id,NEW.seeker_request_id,NEW.user_id,p.concert_id,NEW.party_id,
    CASE WHEN NEW.matching_round_id IS NULL THEN 'direct' ELSE 'algorithm' END,NULL,NEW.id,
    CASE WHEN NEW.status='accepted' THEN 'confirmed' ELSE 'proposed' END,NEW.expires_at,${heldForNew},${nextOrder}
    FROM parties p WHERE p.id=NEW.party_id`;
  for (const [name, event] of [['created','INSERT'],['changed','UPDATE OF status,expires_at']]) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS application_seat_${name} AFTER ${event} ON group_join_requests BEGIN
      UPDATE active_seat_claims SET status=CASE WHEN NEW.status='accepted' THEN 'confirmed'
        WHEN NEW.status='pending' AND NEW.expires_at>${nowSql} THEN 'proposed'
        ELSE 'released' END,expires_at=NEW.expires_at,
        seat_held=CASE WHEN NEW.status='accepted' THEN 1 WHEN NEW.status='pending' AND NEW.expires_at>${nowSql} THEN seat_held ELSE 0 END,
        released_at=CASE WHEN NEW.status='accepted' OR(NEW.status='pending' AND NEW.expires_at>${nowSql})
          THEN NULL ELSE datetime('now') END WHERE join_request_id=NEW.id;
      INSERT INTO active_seat_claims(id,seeker_request_id,user_id,concert_id,party_id,source,proposal_id,join_request_id,status,expires_at,seat_held,queue_order)
        ${applicationValues} AND (NEW.status='accepted' OR(NEW.status='pending' AND NEW.expires_at>${nowSql}))
        AND NOT EXISTS(SELECT 1 FROM active_seat_claims WHERE join_request_id=NEW.id); END;`);
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS application_seat_identity_guard BEFORE UPDATE OF party_id,user_id,seeker_request_id,matching_round_id ON group_join_requests
      WHEN NEW.party_id<>OLD.party_id OR NEW.user_id<>OLD.user_id OR NEW.seeker_request_id IS NOT OLD.seeker_request_id
        OR NEW.matching_round_id IS NOT OLD.matching_round_id BEGIN SELECT RAISE(ABORT,'claim_identity_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS seat_capacity_party_guard BEFORE UPDATE OF capacity ON parties WHEN
      COALESCE((SELECT stranger_slots FROM group_settings WHERE party_id=NEW.id),NEW.capacity) <
      (SELECT COUNT(*) FROM active_seat_claims sc WHERE sc.party_id=NEW.id AND ${heldClaimSql()})
      BEGIN SELECT RAISE(ABORT,'seat_capacity_exceeded'); END;
    CREATE TRIGGER IF NOT EXISTS seat_capacity_settings_guard BEFORE UPDATE OF stranger_slots ON group_settings WHEN
      COALESCE(NEW.stranger_slots,(SELECT capacity FROM parties WHERE id=NEW.party_id)) <
      (SELECT COUNT(*) FROM active_seat_claims sc WHERE sc.party_id=NEW.party_id AND ${heldClaimSql()})
      BEGIN SELECT RAISE(ABORT,'seat_capacity_exceeded'); END;
    CREATE TRIGGER IF NOT EXISTS reserved_seeker_cannot_host BEFORE INSERT ON parties WHEN NEW.status<>'cancelled' AND EXISTS(
      SELECT 1 FROM active_seat_claims sc WHERE sc.user_id=NEW.host_user_id AND sc.concert_id=NEW.concert_id AND ${liveClaimSql()})
      BEGIN SELECT RAISE(ABORT,'seeker_already_reserved'); END;
    CREATE TRIGGER IF NOT EXISTS reserved_seeker_host_update BEFORE UPDATE OF status,host_user_id,concert_id ON parties
      WHEN NEW.status<>'cancelled' AND EXISTS(SELECT 1 FROM active_seat_claims sc WHERE sc.user_id=NEW.host_user_id
        AND sc.concert_id=NEW.concert_id AND sc.party_id<>NEW.id AND ${liveClaimSql()})
      BEGIN SELECT RAISE(ABORT,'seeker_already_reserved'); END;
    CREATE TRIGGER IF NOT EXISTS seat_capacity_settings_delete BEFORE DELETE ON group_settings WHEN
      (SELECT capacity FROM parties WHERE id=OLD.party_id) <
      (SELECT COUNT(*) FROM active_seat_claims sc WHERE sc.party_id=OLD.party_id AND ${heldClaimSql()})
      BEGIN SELECT RAISE(ABORT,'seat_capacity_exceeded'); END;
    CREATE TRIGGER IF NOT EXISTS membership_seat_assignment_guard BEFORE INSERT ON group_memberships WHEN NEW.status='active' AND EXISTS(
      SELECT 1 FROM active_seat_claims sc WHERE sc.user_id=NEW.user_id AND sc.concert_id=NEW.concert_id
        AND sc.party_id<>NEW.party_id AND ${liveClaimSql()}) BEGIN SELECT RAISE(ABORT,'seeker_already_reserved'); END;
    CREATE TRIGGER IF NOT EXISTS membership_seat_update_guard BEFORE UPDATE OF party_id,user_id,concert_id,status ON group_memberships
      WHEN NEW.status='active' AND EXISTS(SELECT 1 FROM active_seat_claims sc WHERE sc.user_id=NEW.user_id
        AND sc.concert_id=NEW.concert_id AND sc.party_id<>NEW.party_id AND ${liveClaimSql()})
      BEGIN SELECT RAISE(ABORT,'seeker_already_reserved'); END;
    CREATE TRIGGER IF NOT EXISTS stranger_membership_claim_insert BEFORE INSERT ON group_memberships
      WHEN NEW.status='active' AND NEW.source IN('join','proposal') AND NOT EXISTS(
        SELECT 1 FROM active_seat_claims sc WHERE sc.user_id=NEW.user_id AND sc.party_id=NEW.party_id AND sc.status='confirmed')
      BEGIN SELECT RAISE(ABORT,'confirmed_seat_claim_required'); END;
    CREATE TRIGGER IF NOT EXISTS stranger_membership_claim_update BEFORE UPDATE OF source,status,party_id,user_id ON group_memberships
      WHEN NEW.status='active' AND NEW.source IN('join','proposal') AND NOT EXISTS(
        SELECT 1 FROM active_seat_claims sc WHERE sc.user_id=NEW.user_id AND sc.party_id=NEW.party_id AND sc.status='confirmed')
      BEGIN SELECT RAISE(ABORT,'confirmed_seat_claim_required'); END;
    CREATE TRIGGER IF NOT EXISTS membership_seat_left AFTER UPDATE OF status ON group_memberships WHEN NEW.status='left' AND OLD.status='active' BEGIN
      UPDATE group_join_requests SET status='cancelled',responded_at=datetime('now')
        WHERE party_id=NEW.party_id AND user_id=NEW.user_id AND status='accepted';
      UPDATE match_proposals SET status='cancelled' WHERE party_id=NEW.party_id AND status IN('proposed','confirmed')
        AND seeker_request_id IN(SELECT id FROM seeker_requests WHERE user_id=NEW.user_id);
    END;
    CREATE TRIGGER IF NOT EXISTS party_seats_cancelled AFTER UPDATE OF status ON parties WHEN NEW.status='cancelled' AND OLD.status<>'cancelled' BEGIN
      UPDATE group_join_requests SET status='cancelled',responded_at=datetime('now') WHERE party_id=NEW.id AND status IN('pending','accepted');
      UPDATE match_proposals SET status='cancelled' WHERE party_id=NEW.id AND status IN('proposed','confirmed');
      UPDATE seeker_requests SET status='open' WHERE status='matched' AND id IN(SELECT seeker_request_id FROM active_seat_claims WHERE party_id=NEW.id)
        AND NOT EXISTS(SELECT 1 FROM active_seat_claims sc WHERE sc.seeker_request_id=seeker_requests.id AND ${liveClaimSql()});
    END;
    CREATE TRIGGER IF NOT EXISTS joining_mode_guard BEFORE UPDATE OF joining_mode ON seeker_requests WHEN NEW.joining_mode<>OLD.joining_mode BEGIN
      SELECT RAISE(ABORT,'active_seat_claim_exists') WHERE EXISTS(SELECT 1 FROM active_seat_claims sc WHERE sc.seeker_request_id=NEW.id AND ${liveClaimSql()});
      SELECT RAISE(ABORT,'pending_applications_exist') WHERE NEW.joining_mode='algorithm' AND EXISTS(SELECT 1 FROM group_join_requests gj WHERE gj.seeker_request_id=NEW.id
        AND gj.status='pending' AND gj.expires_at>${nowSql}); END;
  `);
}

export function migrateHybrid(db) {
  if (db.inTransaction) throw new Error('hybrid_migration_requires_outer_transaction');
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const name of hybridTriggers) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
      if (!db.prepare('PRAGMA table_info(seeker_requests)').all().some(c => c.name==='joining_mode'))
        db.exec("ALTER TABLE seeker_requests ADD COLUMN joining_mode TEXT NOT NULL DEFAULT 'algorithm' CHECK(joining_mode IN ('direct','algorithm'))");
      upgradeApplications(db);
      const invalidApplication = db.prepare(`SELECT gj.id FROM group_join_requests gj WHERE
        (gj.status IN('pending','accepted') AND gj.seeker_request_id IS NULL) OR
        (gj.status='accepted' AND NOT EXISTS(SELECT 1 FROM group_memberships gm WHERE gm.party_id=gj.party_id
          AND gm.user_id=gj.user_id AND gm.status='active')) LIMIT 1`).get();
      if (invalidApplication) throw new Error(`hybrid_application_reconciliation_required:${invalidApplication.id}`);
      upgradeApprovals(db);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_direct_application ON group_join_requests(seeker_request_id)
        WHERE status='pending' AND matching_round_id IS NULL;`);
      const upgradingQueue = !db.prepare('PRAGMA table_info(active_seat_claims)').all().some(c=>c.name==='queue_order');
      db.exec(`CREATE TABLE IF NOT EXISTS active_seat_claims(
        id TEXT PRIMARY KEY,seeker_request_id TEXT NOT NULL REFERENCES seeker_requests(id),user_id TEXT NOT NULL REFERENCES users(id),
        concert_id TEXT NOT NULL REFERENCES concerts(id),party_id TEXT NOT NULL REFERENCES parties(id),
        source TEXT NOT NULL CHECK(source IN('algorithm','direct')),proposal_id TEXT UNIQUE REFERENCES match_proposals(id),
        join_request_id TEXT UNIQUE REFERENCES group_join_requests(id),status TEXT NOT NULL CHECK(status IN('proposed','confirmed','released')),
        expires_at INTEGER,created_at TEXT NOT NULL DEFAULT(datetime('now')),released_at TEXT,
        seat_held INTEGER NOT NULL DEFAULT 1 CHECK(seat_held IN(0,1)),queue_order INTEGER NOT NULL DEFAULT 0,
        CHECK((proposal_id IS NOT NULL AND join_request_id IS NULL AND source='algorithm') OR(proposal_id IS NULL AND join_request_id IS NOT NULL)),
        CHECK(status<>'proposed' OR expires_at IS NOT NULL));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_seat_per_request ON active_seat_claims(seeker_request_id) WHERE status IN('proposed','confirmed');
        CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_seat_per_user_concert ON active_seat_claims(user_id,concert_id) WHERE status IN('proposed','confirmed');
        CREATE INDEX IF NOT EXISTS idx_claim_party_status ON active_seat_claims(party_id,status,expires_at);`);
      const claimColumns = new Set(db.prepare('PRAGMA table_info(active_seat_claims)').all().map(c=>c.name));
      if (!claimColumns.has('seat_held')) db.exec('ALTER TABLE active_seat_claims ADD COLUMN seat_held INTEGER NOT NULL DEFAULT 1 CHECK(seat_held IN(0,1))');
      if (!claimColumns.has('queue_order')) db.exec('ALTER TABLE active_seat_claims ADD COLUMN queue_order INTEGER NOT NULL DEFAULT 0');
      const unclaimed = db.prepare(`SELECT gm.party_id,gm.user_id FROM group_memberships gm WHERE gm.status='active' AND (
        (gm.source='join' AND NOT EXISTS(SELECT 1 FROM group_join_requests gj WHERE gj.party_id=gm.party_id AND gj.user_id=gm.user_id AND gj.status='accepted'))
        OR(gm.source='proposal' AND NOT EXISTS(SELECT 1 FROM match_proposals mp JOIN seeker_requests s ON s.id=mp.seeker_request_id
          WHERE mp.party_id=gm.party_id AND s.user_id=gm.user_id AND mp.status='confirmed'))) LIMIT 1`).get();
      if (unclaimed) throw new Error(`hybrid_membership_reconciliation_required:${unclaimed.party_id}:${unclaimed.user_id}`);
      const rows = db.prepare(`SELECT 'proposal:'||mp.id id,mp.seeker_request_id,s.user_id,s.concert_id,mp.party_id,'algorithm' source,
        mp.id proposal_id,NULL join_request_id,mp.status,mp.expires_at,mp.created_at queue_created_at
        FROM match_proposals mp JOIN seeker_requests s ON s.id=mp.seeker_request_id
        WHERE mp.status='confirmed' OR(mp.status='proposed' AND mp.expires_at>${nowSql})
        UNION ALL SELECT 'application:'||gj.id,gj.seeker_request_id,gj.user_id,p.concert_id,gj.party_id,
        CASE WHEN gj.matching_round_id IS NULL THEN 'direct' ELSE 'algorithm' END,NULL,gj.id,
        CASE WHEN gj.status='accepted' THEN 'confirmed' ELSE 'proposed' END,gj.expires_at,gj.created_at
        FROM group_join_requests gj JOIN parties p ON p.id=gj.party_id
        WHERE (gj.status='pending' AND gj.expires_at>${nowSql}) OR
          (gj.status='accepted' AND EXISTS(SELECT 1 FROM group_memberships gm WHERE gm.party_id=gj.party_id AND gm.user_id=gj.user_id AND gm.status='active'))
        ORDER BY queue_created_at,id`).all();
      const seekers = new Set(), counts = new Map();
      for (const row of rows) {
        const party = db.prepare(`SELECT p.*,COALESCE(gs.stranger_slots,p.capacity) slots FROM parties p
          LEFT JOIN group_settings gs ON gs.party_id=p.id WHERE p.id=?`).get(row.party_id);
        const key = `${row.user_id}|${row.concert_id}`;
        const seeker = db.prepare('SELECT user_id,concert_id FROM seeker_requests WHERE id=?').get(row.seeker_request_id);
        const resultValid = !row.proposal_id || db.prepare(`SELECT 1 FROM match_proposals mp JOIN match_results mr ON mr.id=mp.match_result_id
          JOIN match_rounds r ON r.id=mp.round_id WHERE mp.id=? AND mr.round_id=mp.round_id AND mr.seeker_request_id=mp.seeker_request_id
          AND mr.party_id=mp.party_id AND mr.outcome='matched' AND r.concert_id=?`).get(row.proposal_id,row.concert_id);
        if (!seeker || seeker.user_id!==row.user_id || seeker.concert_id!==row.concert_id || !resultValid || seekers.has(key)
          || !party || party.host_user_id===row.user_id || party.concert_id!==row.concert_id || party.status==='cancelled'
          || db.prepare('SELECT 1 FROM tickets WHERE source_party_id=?').get(row.party_id)
          || db.prepare("SELECT 1 FROM parties WHERE host_user_id=? AND concert_id=? AND status<>'cancelled'").get(row.user_id,row.concert_id)
          || db.prepare("SELECT 1 FROM group_memberships WHERE user_id=? AND concert_id=? AND party_id<>? AND status='active'").get(row.user_id,row.concert_id,row.party_id))
          throw new Error(`hybrid_assignment_reconciliation_required:${row.id}`);
        seekers.add(key);
        const count = (counts.get(row.party_id)??0)+(row.status==='confirmed'?1:0);
        if (count>party.slots) throw new Error(`hybrid_capacity_reconciliation_required:${row.party_id}`);
        counts.set(row.party_id,count);
      }
      db.prepare(`UPDATE active_seat_claims SET status='released',seat_held=0,released_at=datetime('now') WHERE status='proposed' AND expires_at<=${nowSql}`).run();
      const ids = new Set(rows.map(row => row.id));
      for (const claim of db.prepare(`SELECT sc.id FROM active_seat_claims sc WHERE ${liveClaimSql()}`).all())
        if (!ids.has(claim.id)) throw new Error(`hybrid_claim_reconciliation_required:${claim.id}`);
      const insert = db.prepare(`INSERT OR IGNORE INTO active_seat_claims(id,seeker_request_id,user_id,concert_id,party_id,source,proposal_id,join_request_id,status,expires_at,queue_order,seat_held)
        VALUES(@id,@seeker_request_id,@user_id,@concert_id,@party_id,@source,@proposal_id,@join_request_id,@status,@expires_at,@queue_order,@seat_held)`);
      let nextOrder = db.prepare('SELECT COALESCE(MAX(queue_order),0) n FROM active_seat_claims').get().n;
      const orders = new Map();
      if (upgradingQueue) {
        const history = db.prepare(`SELECT sc.id,COALESCE(mp.created_at,gj.created_at,sc.created_at) queue_created_at
          FROM active_seat_claims sc LEFT JOIN match_proposals mp ON mp.id=sc.proposal_id
          LEFT JOIN group_join_requests gj ON gj.id=sc.join_request_id`).all();
        const all = new Map(history.map(row=>[row.id,row]));
        for (const row of rows) all.set(row.id,row);
        nextOrder=0;
        for (const row of [...all.values()].sort((a,b)=>a.queue_created_at.localeCompare(b.queue_created_at)||a.id.localeCompare(b.id)))
          orders.set(row.id,++nextOrder);
        for (const [id,order] of orders) db.prepare('UPDATE active_seat_claims SET queue_order=? WHERE id=?').run(order,id);
      }
      for (const row of rows) {
        const existing = db.prepare('SELECT * FROM active_seat_claims WHERE id=?').get(row.id);
        if (existing && Object.keys(row).filter(key=>key!=='queue_created_at').some(key => existing[key] !== row[key]))
          throw new Error(`hybrid_claim_reconciliation_required:${row.id}`);
        row.queue_order=existing?.queue_order ?? orders.get(row.id) ?? ++nextOrder;
        row.seat_held=row.status==='confirmed'?1:0;
        insert.run(row);
        if (!db.prepare('SELECT 1 FROM active_seat_claims WHERE id=?').get(row.id))
          throw new Error(`hybrid_claim_reconciliation_required:${row.id}`);
      }
      // A queue entry owns the seeker's intent, but only the earliest entries up
      // to the number of unconfirmed places own physical seats.
      db.exec(`UPDATE active_seat_claims SET seat_held=CASE WHEN status='confirmed' THEN 1 ELSE 0 END;
        UPDATE active_seat_claims SET seat_held=1 WHERE status='proposed' AND expires_at>${nowSql}
          AND (SELECT COUNT(*) FROM active_seat_claims prior WHERE prior.party_id=active_seat_claims.party_id
            AND (prior.status='confirmed' OR(prior.status='proposed' AND prior.expires_at>${nowSql}
              AND prior.queue_order<active_seat_claims.queue_order))) <
            (SELECT COALESCE(gs.stranger_slots,p.capacity) FROM parties p LEFT JOIN group_settings gs ON gs.party_id=p.id
              WHERE p.id=active_seat_claims.party_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_queue_order ON active_seat_claims(queue_order);
        UPDATE seeker_requests SET joining_mode='direct',matching_opt_in=0 WHERE id IN(
          SELECT seeker_request_id FROM active_seat_claims sc WHERE sc.source='direct' AND ${liveClaimSql()});
        UPDATE seeker_requests SET status='matched' WHERE id IN(
          SELECT seeker_request_id FROM active_seat_claims sc WHERE ${liveClaimSql()});
        UPDATE seeker_requests SET status='open' WHERE status='matched' AND id IN(SELECT seeker_request_id FROM active_seat_claims)
          AND NOT EXISTS(SELECT 1 FROM active_seat_claims sc WHERE sc.seeker_request_id=seeker_requests.id AND ${liveClaimSql()})
          AND NOT EXISTS(SELECT 1 FROM group_memberships gm JOIN parties p ON p.id=gm.party_id
            WHERE gm.user_id=seeker_requests.user_id AND gm.concert_id=seeker_requests.concert_id AND gm.status='active' AND p.status<>'cancelled');
        UPDATE parties SET status=CASE WHEN (SELECT COUNT(*) FROM active_seat_claims sc WHERE sc.party_id=parties.id AND ${heldClaimSql()})>=
          COALESCE((SELECT stranger_slots FROM group_settings WHERE party_id=parties.id),capacity) THEN 'matched' ELSE 'open' END
          WHERE status<>'cancelled';`);
      installClaimTriggers(db);
      // A deployment can already contain a confirmed-full group plus older
      // unanswered applications. Apply the same terminal cleanup as admission.
      db.exec(`UPDATE group_join_requests SET status='superseded',responded_at=datetime('now'),resolution_reason='group_full'
        WHERE status='pending' AND (SELECT COUNT(*) FROM active_seat_claims sc
          WHERE sc.party_id=group_join_requests.party_id AND sc.status='confirmed') >=
          (SELECT COALESCE(gs.stranger_slots,p.capacity) FROM parties p LEFT JOIN group_settings gs ON gs.party_id=p.id
            WHERE p.id=group_join_requests.party_id);
        UPDATE match_proposals SET status='cancelled',resolution_reason='group_full'
        WHERE status='proposed' AND (SELECT COUNT(*) FROM active_seat_claims sc
          WHERE sc.party_id=match_proposals.party_id AND sc.status='confirmed') >=
          (SELECT COALESCE(gs.stranger_slots,p.capacity) FROM parties p LEFT JOIN group_settings gs ON gs.party_id=p.id
            WHERE p.id=match_proposals.party_id);`);
      const violations = db.pragma('foreign_key_check');
      if (violations.length) throw new Error('hybrid_foreign_key_reconciliation_required');
    }).immediate();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}
