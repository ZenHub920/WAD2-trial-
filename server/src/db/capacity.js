/** One definition for discovery, matching and operational reservation accounting.
 * Time is evaluated by SQLite, including before the expiration sweep runs. */
export function activeReservationSql(alias = 'mp') {
  return `(${alias}.status = 'confirmed' OR (${alias}.status = 'proposed'
    AND ${alias}.expires_at > unixepoch('subsec') * 1000))`;
}
export function reservedPlacesSql(partyIdSql) {
  return `((SELECT COUNT(*) FROM match_proposals mp WHERE mp.party_id=${partyIdSql} AND ${activeReservationSql()})
    + (SELECT COUNT(*) FROM group_memberships gm WHERE gm.party_id=${partyIdSql} AND gm.source='join' AND gm.status='active'))`;
}
export function availableCapacitySql(partyAlias='p') {
  return `COALESCE((SELECT gs.stranger_slots FROM group_settings gs WHERE gs.party_id=${partyAlias}.id),${partyAlias}.capacity)`;
}
