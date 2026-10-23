import { individualProfile } from './discoveryPreferences.js';
import { dealbreakerHit } from './traitScoring.js';

/** Read fresh account answers: changing a veto must close an existing chat immediately. */
export function createKakiPreferenceGate(db) {
  const answers = db.prepare(`SELECT p.answers_json FROM users u
    LEFT JOIN user_group_preferences p ON p.user_id=u.id WHERE u.id=?`);
  const empty = { about: [], wants: [], avoid: [] };
  function profile(userId) {
    const row = answers.get(userId);
    if (!row) return null;
    try { return individualProfile(row.answers_json ? JSON.parse(row.answers_json) : empty); }
    catch { return null; } // Corrupt stored preferences cannot silently bypass a hard constraint.
  }
  return (firstId, secondId) => {
    const first = profile(firstId), second = profile(secondId);
    return Boolean(first && second && !dealbreakerHit(first, second) && !dealbreakerHit(second, first));
  };
}
