/** One definition for discovery, matching and operational reservation accounting.
 * Time is evaluated by SQLite, including before the expiration sweep runs. */
export function activeReservationSql(alias = 'mp') {
  return `(${alias}.status = 'confirmed' OR (${alias}.status = 'proposed'
    AND ${alias}.expires_at > unixepoch('subsec') * 1000))`;
}
export function reservedPlacesSql(partyIdSql) {
  // Derive occupied places even before a sweep has promoted a live waiter past
  // an elapsed head. A nonempty queue must never briefly advertise its seat free.
  return `((SELECT COUNT(*) FROM active_seat_claims WHERE party_id=${partyIdSql} AND status='confirmed') +
    MIN((SELECT COUNT(*) FROM active_seat_claims WHERE party_id=${partyIdSql} AND status='proposed'
      AND expires_at>unixepoch('subsec')*1000), MAX(0,${queueablePlacesSql(partyIdSql)})))`;
}
/** Potential admissions still unfilled by confirmed members, including held places.
 * Used for joining the queue; this is not a promise of an immediately free seat. */
export function queueablePlacesSql(partyIdSql) {
  return `(COALESCE((SELECT stranger_slots FROM group_settings WHERE party_id=${partyIdSql}),
    (SELECT capacity FROM parties WHERE id=${partyIdSql})) -
    (SELECT COUNT(*) FROM active_seat_claims WHERE party_id=${partyIdSql} AND status='confirmed'))`;
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
