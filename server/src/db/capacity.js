/** One definition for discovery, matching and operational reservation accounting.
 * Time is evaluated by SQLite, including before the expiration sweep runs. */
export function activeReservationSql(alias = 'mp') {
  return `(${alias}.status = 'confirmed' OR (${alias}.status = 'proposed'
    AND ${alias}.expires_at > unixepoch('subsec') * 1000))`;
}
