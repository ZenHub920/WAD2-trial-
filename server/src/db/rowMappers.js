/** Explicit database row shapes shared by the repository modules. */

export function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    display_name: row.display_name,
    email: row.email,
    age_band: row.age_band,
    home_region: row.home_region,
    gender: row.gender,
    companion_gender_pref: row.companion_gender_pref,
    languages: JSON.parse(row.languages_json),
    vibe: JSON.parse(row.vibe_json),
    reliability: row.reliability,
    verified: row.verified,
    // Enumerate fields so private database columns cannot leak through spreads.
    avatar_path: row.avatar_path ?? null,
    ...(Object.hasOwn(row, 'is_operator') ? { is_operator: Boolean(row.is_operator) } : {}),
    created_at: row.created_at,
  };
}

export function mapParty(row) {
  if (!row) return null;
  return {
    id: row.id,
    host_user_id: row.host_user_id,
    concert_id: row.concert_id,

    capacity: row.capacity,

    // Capacity after existing seat claims.
    remaining_capacity: row.remaining_capacity ?? row.capacity,
    queueable_places: row.queueable_places,

    section: row.section,
    spend_band: row.spend_band,
    arrival_plan: row.arrival_plan,
    plans: JSON.parse(row.plans_json),
    strict_age_policy: row.strict_age_policy,
    min_age_band: row.min_age_band,
    // The solver classifier needs both the lower quota and linked requests.
    min_size: row.min_size ?? null,
    notes: row.notes,
    name: row.name ?? null,
    image_path: row.image_path ?? null,
    status: row.status,
    host: row.host_id ? mapUser(prefixed(row, 'host_')) : undefined,
  };
}

export function mapSeeker(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    concert_id: row.concert_id,
    section_pref: row.section_pref,
    spend_band_max: row.spend_band_max,
    arrival_pref: row.arrival_pref,
    plans_wanted: JSON.parse(row.plans_wanted_json),
    strict_age_policy: row.strict_age_policy,
    age_tolerance: row.age_tolerance,
    // All-or-nothing link to another request. Same reason as min_size above.
    linked_request_id: row.linked_request_id ?? null,
    notes: row.notes,
    status: row.status,
    matching_opt_in: row.matching_opt_in === 1,
    joining_mode: row.joining_mode ?? 'algorithm',
    joiningMode: row.joining_mode ?? 'algorithm',
    user: row.user_id_joined ? mapUser(prefixed(row, 'user_')) : undefined,
  };
}

/** Lift `prefix_col` keys out of a joined row into a bare row shape. */
export function prefixed(row, prefix) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
  }
  return out;
}

export const USER_COLUMNS = (alias, prefix) => `
  ${alias}.id                    AS ${prefix}id,
  ${alias}.display_name          AS ${prefix}display_name,
  ${alias}.email                 AS ${prefix}email,
  ${alias}.age_band              AS ${prefix}age_band,
  ${alias}.home_region           AS ${prefix}home_region,
  ${alias}.gender                AS ${prefix}gender,
  ${alias}.companion_gender_pref AS ${prefix}companion_gender_pref,
  ${alias}.languages_json        AS ${prefix}languages_json,
  ${alias}.vibe_json             AS ${prefix}vibe_json,
  ${alias}.reliability           AS ${prefix}reliability,
  ${alias}.verified              AS ${prefix}verified,
  ${alias}.avatar_path           AS ${prefix}avatar_path,
  ${alias}.created_at            AS ${prefix}created_at
`;
