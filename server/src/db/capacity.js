/** One definition for discovery, matching and operational reservation accounting.
 * Time is evaluated by SQLite, including before the expiration sweep runs. */
import { liveClaimSql } from './hybridMigrations.js';
export function activeReservationSql(alias = 'mp') {
  return `(${alias}.status = 'confirmed' OR (${alias}.status = 'proposed'
    AND ${alias}.expires_at > unixepoch('subsec') * 1000))`;
}
export function reservedPlacesSql(partyIdSql) {
  return `(SELECT COUNT(*) FROM active_seat_claims sc WHERE sc.party_id=${partyIdSql} AND ${liveClaimSql()})`;
}
export function availableCapacitySql(partyAlias='p') {
  return `COALESCE((SELECT gs.stranger_slots FROM group_settings gs WHERE gs.party_id=${partyAlias}.id),${partyAlias}.capacity)`;
}

export function expireJoinRequests(db) {
  const expired = db.prepare(`UPDATE group_join_requests SET status='expired',responded_at=datetime('now')
    WHERE status='pending' AND expires_at <= unixepoch('subsec') * 1000`).run().changes;
  db.prepare(`UPDATE parties SET status='open' WHERE status='matched'
    AND EXISTS(SELECT 1 FROM group_settings WHERE party_id=parties.id)
    AND ${availableCapacitySql('parties')} > ${reservedPlacesSql('parties.id')}`).run();
  return expired;
}
