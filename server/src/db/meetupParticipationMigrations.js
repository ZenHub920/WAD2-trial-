/** Additive participation metadata. Empty legacy selections are not responses. */
export function migrateMeetupParticipation(db) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS meetup_availability_responses(
      meetup_id TEXT NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN('available','unavailable','unanswered')),
      responded_at INTEGER,
      PRIMARY KEY(meetup_id,user_id));
    CREATE TABLE IF NOT EXISTS meetup_confirmation_context(
      meetup_id TEXT PRIMARY KEY REFERENCES meetups(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,confirmed_at INTEGER NOT NULL,
      participant_ids_json TEXT NOT NULL CHECK(json_valid(participant_ids_json)));`);
    // Existing intervals prove a response, but not when it was submitted.
    // Explicit newer responses, including unavailable, remain untouched.
    db.exec(`INSERT OR IGNORE INTO meetup_availability_responses(meetup_id,user_id,status,responded_at)
      SELECT DISTINCT meetup_id,user_id,'available',NULL FROM meetup_availability`);
  }).immediate();
}
