import { randomUUID } from "node:crypto";
import { communityError } from "./membershipRepository.js";
export function migrateFeedback(db) {
  db.transaction(() =>
    db.exec(`CREATE TABLE IF NOT EXISTS group_attendance_feedback(
  id TEXT PRIMARY KEY,party_id TEXT NOT NULL REFERENCES parties(id),concert_id TEXT NOT NULL REFERENCES concerts(id),
  rater_user_id TEXT NOT NULL REFERENCES users(id),rated_user_id TEXT NOT NULL REFERENCES users(id),
  showed_up INTEGER NOT NULL CHECK(showed_up IN(0,1)),rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),comment TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(concert_id,rater_user_id,rated_user_id),CHECK(rater_user_id<>rated_user_id));
  DROP VIEW IF EXISTS user_reliability;
  CREATE VIEW user_reliability AS WITH all_feedback AS (
   SELECT id,rated_user_id,showed_up,rating FROM attendance_feedback
   UNION ALL SELECT id,rated_user_id,showed_up,rating FROM group_attendance_feedback
  ) SELECT u.id user_id,COUNT(f.id) ratings_count,COALESCE(AVG(f.showed_up),1.0) show_rate,
   COALESCE(AVG(f.rating)/5.0,0.75) mean_rating,
   ROUND((COUNT(f.id)*COALESCE(AVG(f.showed_up)*0.5+(AVG(f.rating)/5.0)*0.5,0.75)+3*0.75)/(COUNT(f.id)+3.0),4) derived_reliability
  FROM users u LEFT JOIN all_feedback f ON f.rated_user_id=u.id GROUP BY u.id;`),
  ).immediate();
}
export function createFeedbackRepo(db, repos) {
  const event = (partyId) =>
    db
      .prepare(
        `SELECT p.*,c.event_date FROM parties p JOIN concerts c ON c.id=p.concert_id WHERE p.id=?`,
      )
      .get(partyId);
  const end = (p) =>
    Date.parse(`${p.event_date.slice(0, 10)}T23:59:59.999+08:00`);
  const eligibleMember = (user, p) => {
    const cutoff = end(p);
    if (
      p.host_user_id === user &&
      Date.parse(`${p.created_at.replace(" ", "T")}Z`) <= cutoff
    )
      return true;
    const membership = db
      .prepare("SELECT * FROM group_memberships WHERE party_id=? AND user_id=?")
      .get(p.id, user);
    if (
      membership &&
      Date.parse(`${membership.joined_at.replace(" ", "T")}Z`) <= cutoff &&
      (!membership.left_at ||
        Date.parse(`${membership.left_at.replace(" ", "T")}Z`) > cutoff)
    )
      return true;
    return Boolean(
      db
        .prepare(
          `SELECT 1 FROM match_proposals mp JOIN seeker_requests s ON s.id=mp.seeker_request_id
    WHERE mp.party_id=? AND s.user_id=? AND mp.status='confirmed' AND datetime(mp.created_at)<=datetime(?)`,
        )
        .get(p.id, user, new Date(cutoff).toISOString()),
    );
  };
  const alreadyRated = (user, target, concert) =>
    Boolean(
      db
        .prepare(
          `SELECT 1 FROM group_attendance_feedback WHERE rater_user_id=? AND rated_user_id=? AND concert_id=?
  UNION ALL SELECT 1 FROM attendance_feedback f JOIN match_rounds r ON r.id=f.round_id WHERE f.rater_user_id=? AND f.rated_user_id=? AND r.concert_id=?`,
        )
        .get(user, target, concert, user, target, concert),
    );
  return {
    submit: db.transaction((user, input = {}) => {
      if (
        typeof input.ratedUserId !== "string" ||
        input.ratedUserId === user ||
        typeof input.showedUp !== "boolean" ||
        !Number.isInteger(input.rating) ||
        input.rating < 1 ||
        input.rating > 5 ||
        (input.comment !== undefined &&
          (typeof input.comment !== "string" || input.comment.length > 500))
      )
        throw communityError("invalid_feedback", 400);
      if (
        Boolean(input.partyId) === Boolean(input.roundId) ||
        [input.partyId, input.roundId].some(
          (v) => v !== undefined && typeof v !== "string",
        )
      )
        throw communityError("one_feedback_context_required", 400);
      let partyId = input.partyId;
      if (input.roundId) {
        const row = db
          .prepare(
            `SELECT p.id FROM parties p JOIN match_proposals mp ON mp.party_id=p.id JOIN seeker_requests s ON s.id=mp.seeker_request_id
     WHERE mp.round_id=? AND mp.status='confirmed' AND (p.host_user_id=? OR s.user_id=?)
     AND (p.host_user_id=? OR EXISTS(SELECT 1 FROM match_proposals other JOIN seeker_requests os ON os.id=other.seeker_request_id
       WHERE other.party_id=p.id AND other.status='confirmed' AND os.user_id=?))`,
          )
          .get(input.roundId, user, user, input.ratedUserId, input.ratedUserId);
        partyId = row?.id;
      }
      const p = partyId ? event(partyId) : null;
      if (
        !p ||
        !eligibleMember(user, p) ||
        !eligibleMember(input.ratedUserId, p)
      )
        throw communityError("feedback_participants_required", 403);
      if (!Number.isFinite(end(p)) || Date.now() <= end(p))
        throw communityError("concert_not_finished");
      if (alreadyRated(user, input.ratedUserId, p.concert_id))
        throw communityError("feedback_already_submitted");
      const id = `fb_${randomUUID()}`;
      if (input.roundId)
        db.prepare(
          "INSERT INTO attendance_feedback(id,round_id,rater_user_id,rated_user_id,showed_up,rating,comment) VALUES(?,?,?,?,?,?,?)",
        ).run(
          id,
          input.roundId,
          user,
          input.ratedUserId,
          input.showedUp ? 1 : 0,
          input.rating,
          input.comment?.trim() ?? "",
        );
      else
        db.prepare(
          "INSERT INTO group_attendance_feedback(id,party_id,concert_id,rater_user_id,rated_user_id,showed_up,rating,comment) VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          id,
          p.id,
          p.concert_id,
          user,
          input.ratedUserId,
          input.showedUp ? 1 : 0,
          input.rating,
          input.comment?.trim() ?? "",
        );
      repos.users.refreshReliability(input.ratedUserId);
      if (
        db
          .prepare(
            "SELECT enabled FROM notification_preferences WHERE user_id=? AND category='feedback'",
          )
          .get(input.ratedUserId)?.enabled !== 0
      )
        db.prepare(
          "INSERT INTO notifications(id,user_id,category,event_key,title,resource_path) VALUES(?,?,'feedback',?,'Post-concert feedback was received','/feedback')",
        ).run(randomUUID(), input.ratedUserId, `feedback:${id}`);
      return { id, submitted: true };
    }).immediate,
    opportunities(user) {
      const result = [];
      for (const p of db
        .prepare(
          "SELECT p.*,c.event_date,c.artist FROM parties p JOIN concerts c ON c.id=p.concert_id",
        )
        .all()) {
        if (Date.now() <= end(p) || !eligibleMember(user, p)) continue;
        const users = [
          ...new Set([
            p.host_user_id,
            ...db
              .prepare("SELECT user_id FROM group_memberships WHERE party_id=?")
              .all(p.id)
              .map((r) => r.user_id),
            ...db
              .prepare(
                "SELECT s.user_id FROM match_proposals mp JOIN seeker_requests s ON s.id=mp.seeker_request_id WHERE mp.party_id=? AND mp.status='confirmed'",
              )
              .all(p.id)
              .map((r) => r.user_id),
          ]),
        ];
        for (const target of users)
          if (
            target !== user &&
            eligibleMember(target, p) &&
            !alreadyRated(user, target, p.concert_id)
          )
            result.push({
              partyId: p.id,
              concertId: p.concert_id,
              artist: p.artist,
              ratedUserId: target,
              name: repos.users.findById(target).display_name,
            });
      }
      return result;
    },
    mine(user) {
      return db
        .prepare(
          `SELECT id,rater_user_id AS raterUserId,rated_user_id AS ratedUserId,showed_up AS showedUp,rating,comment,created_at AS createdAt
    FROM group_attendance_feedback WHERE rater_user_id=? OR rated_user_id=?
    UNION ALL SELECT id,rater_user_id,rated_user_id,showed_up,rating,comment,created_at FROM attendance_feedback WHERE rater_user_id=? OR rated_user_id=?
    ORDER BY createdAt DESC`,
        )
        .all(user, user, user, user);
    },
  };
}
