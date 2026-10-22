import { randomUUID } from "node:crypto";
import { communityError } from "./membershipRepository.js";
import { expireJoinRequests, queueablePlacesSql } from "./capacity.js";
import { queueInfo } from "./admissionQueue.js";
import {
  validateAnswers,
  individualProfile,
  compareProfiles,
  withoutRetired,
} from "../services/discoveryPreferences.js";
import { checkFeasibility, scorePair } from "../matching/compatibility.js";
import { groupImageUrl } from "../controllers/groupIdentityController.js";
export function createRecommendationRepo(db, repos) {
  const maxPendingDirectApplications = 1;
  const EMPTY = '{"about":[],"wants":[],"avoid":[]}';
  /** Concert-specific answers if any were saved, otherwise the user's own. */
  const answersJson = (user, concert) =>
    db.prepare("SELECT answers_json FROM seeker_discovery_preferences WHERE user_id=? AND concert_id=?")
      .get(user, concert)?.answers_json ??
    db.prepare("SELECT answers_json FROM user_group_preferences WHERE user_id=?").get(user)?.answers_json ??
    null;
  const personal = (user, concert) =>
    individualProfile(JSON.parse(answersJson(user, concert) ?? EMPTY));
  /** Writes already-validated answers for one concert. */
  const storePersonal = (user, concert, serialized) => {
    const previous = answersJson(user, concert);
    db.prepare(
      `INSERT INTO seeker_discovery_preferences VALUES(?,?,?) ON CONFLICT(user_id,concert_id) DO UPDATE SET answers_json=excluded.answers_json`,
    ).run(user, concert, serialized);
    if (previous !== serialized)
      // A missing version means consent must be renewed, even if answers are later restored.
      db.prepare(`UPDATE group_join_requests SET group_version=NULL WHERE user_id=? AND status='pending'
        AND party_id IN(SELECT id FROM parties WHERE concert_id=?)`).run(user, concert);
  };
  const visible = (p) => {
    const s = repos.membership.settings(p.id);
    return !s || Boolean(s.published);
  };
  const aggregateParty = (p) => {
    const users = db
      .prepare(
        `SELECT u.vibe_json,u.languages_json,u.reliability FROM group_memberships m JOIN users u ON u.id=m.user_id WHERE m.party_id=? AND m.status='active'`,
      )
      .all(p.id);
    if (!users.length) return p;
    const vibe = {};
    for (const u of users)
      for (const [key, value] of Object.entries(JSON.parse(u.vibe_json)))
        vibe[key] = (vibe[key] ?? 0) + value / users.length;
    return {
      ...p,
      host: {
        ...p.host,
        vibe,
        languages: [
          ...new Set(users.flatMap((u) => JSON.parse(u.languages_json))),
        ],
        reliability:
          users.reduce((n, u) => n + u.reliability, 0) / users.length,
      },
    };
  };
  const feasible = (user, p) => {
    const seeker = repos.groups.seeker(user, p.concert_id);
    if (!seeker) return false;
    const members = db
      .prepare(
        `SELECT u.id FROM group_memberships m JOIN users u ON u.id=m.user_id WHERE m.party_id=? AND m.status='active'`,
      )
      .all(p.id);
    const blocklist = repos.users.blocklist();
    if (!checkFeasibility(seeker, p, { blocklist }).feasible) return false;
    for (const member of members) {
      const u = repos.users.findById(member.id);
      if (
        !checkFeasibility(
          seeker,
          { ...p, host_user_id: u.id, host: u },
          { blocklist },
        ).feasible
      )
        return false;
    }
    return true;
  };
  // Discovery and both sides of the matching engine use this same scorer.
  const pairScore = (seeker, p) => {
    if (!repos.membership.settings(p.id)) return scorePair(seeker, p);
    const base = scorePair(seeker, aggregateParty(p));
    const discovery = compareProfiles(personal(seeker.user_id, p.concert_id), repos.membership.profile(p.id));
    return {
      ...base,
      seekerToParty: 0.6 * base.seekerToParty + 0.4 * discovery.seekerScore,
      partyToSeeker: 0.6 * base.partyToSeeker + 0.4 * discovery.groupScore,
      discovery,
    };
  };
  const rankIndividual = (user, card) => {
    const p = repos.parties.findById(card.id),
      s = repos.groups.seeker(user, p.concert_id);
    const profile = repos.membership.profile(p.id);
    const concepts = compareProfiles(personal(user, p.concert_id), profile);
    const base = s ? pairScore(s, p) : null;
    return {
      ...card,
      compatibility: base
        ? Math.round(
            ((base.seekerToParty + base.partyToSeeker) / 2) *
              10000,
          ) / 10000
        : null,
      reasons: concepts.reasons,
      confidence: concepts.confidence,
      profile,
      requiresHostApproval: true,
      directRequiresHostApproval: true,
      automaticRequiresSeekerApproval: true,
      automaticPlacementAvailable: repos.groups.automaticPlacementEligible(user, p),
    };
  };
  return {
    personal,
    storePersonal,
    hasAnswers: (user, concert) => answersJson(user, concert) !== null,
    visible,
    aggregateParty,
    feasible,
    pairScore,
    maxPendingDirectApplications,
    expire: db.transaction(() => expireJoinRequests(db)).immediate,
    answers(user, concert) {
      return withoutRetired(JSON.parse(answersJson(user, concert) ?? EMPTY));
    },
    savePersonal: db.transaction((user, concert, input) => {
      if (!repos.concerts.findById(concert))
        throw communityError("concert_not_found", 404);
      const answers = validateAnswers(input);
      storePersonal(user, concert, JSON.stringify(answers));
      return answers;
    }).immediate,
    individual(user, concert) {
      repos.proposals.expire();
      repos.recommendations.expire();
      const request = repos.groups.seeker(user, concert);
      if (
        repos.membership.active(user, concert) ||
        (request && request.status !== "open")
      ) return [];
      return repos.groups
        .discover(user, concert)
        .filter((card) => visible(repos.parties.findById(card.id)))
        .filter(
          (card) =>
            !request ||
            feasible(user, repos.parties.findById(card.id)),
        )
        .map((card) => rankIndividual(user, card))
        .sort(
          (a, b) =>
            (b.compatibility ?? -1) - (a.compatibility ?? -1) ||
            a.id.localeCompare(b.id),
        );
    },
    groups(user, concert, source) {
      const candidates = repos.groups.connectionCandidates(
        user,
        concert,
        source,
      );
      if (candidates.error)
        throw communityError(candidates.error, candidates.status);
      const from = repos.parties.findById(source);
      const sourceProfile = repos.membership.profile(source);
      return candidates
        .map((c) => {
          const result = compareProfiles(
            sourceProfile,
            repos.membership.profile(c.id),
          );
          const target = repos.parties.findById(c.id);
          const logistics =
            [
              from.section === target.section,
              from.arrival_plan === target.arrival_plan,
              from.spend_band === target.spend_band,
            ].filter(Boolean).length / 3;
          return {
            ...c,
            compatibility:
              Math.round((0.7 * result.score + 0.3 * logistics) * 10000) /
              10000,
            reasons: result.reasons,
            confidence: result.confidence,
          };
        })
        .sort(
          (a, b) =>
            b.compatibility - a.compatibility || a.id.localeCompare(b.id),
        );
    },
    setJoiningMode: db.transaction((user, concert, mode) => {
      if (!["direct", "algorithm"].includes(mode)) throw communityError("invalid_joining_mode", 400);
      if (!repos.concerts.findById(concert)) throw communityError("concert_not_found", 404);
      repos.proposals.expire();
      repos.recommendations.expire();
      const seeker = repos.groups.seeker(user, concert);
      if (!seeker) throw communityError("seeker_request_not_found", 404);
      const changing = seeker.joining_mode !== mode;
      if (changing) {
        if (mode === "algorithm" && db.prepare(`SELECT 1 FROM group_join_requests j JOIN parties p ON p.id=j.party_id
          WHERE j.user_id=? AND p.concert_id=? AND j.status='pending'`).get(user, concert))
          throw communityError("withdraw_pending_applications_first");
        if (db.prepare(`SELECT 1 FROM active_seat_claims WHERE seeker_request_id=?
          AND (status='confirmed' OR (status='proposed' AND expires_at>?))`).get(seeker.id, Date.now()))
          throw communityError("active_seat_claim_exists");
        repos.membership.ensureFree(user, concert, "");
        if (seeker.status !== "open") throw communityError("open_seeker_request_required");
      }
      // Choosing an algorithm mode explicitly enrols an open, unassigned seeker.
      // Re-selecting the current mode never resolves a real offer or membership.
      db.prepare(`UPDATE seeker_requests SET joining_mode=?,matching_opt_in=? WHERE id=?`)
        .run(mode, mode === "algorithm" && seeker.status === "open" ? 1 : 0, seeker.id);
      const result = repos.groups.seeker(user, concert);
      return { ...result, user: undefined, maxPendingDirectApplications };
    }).immediate,
    requestJoin: db.transaction((user, id, input = {}) => {
      repos.proposals.expire();
      repos.recommendations.expire();
      const p = repos.membership.party(id);
      // A pending application owns a queue position and marks enrollment matched.
      // Report that application before checking general assignments.
      const pending = db.prepare(`SELECT j.party_id FROM group_join_requests j JOIN parties p ON p.id=j.party_id
        WHERE j.user_id=? AND p.concert_id=? AND j.status='pending' AND j.matching_round_id IS NULL`)
        .get(user, p.concert_id);
      if (pending) throw communityError(pending.party_id === id
        ? "join_request_already_exists" : "pending_application_limit_reached");
      repos.membership.ensureFree(user, p.concert_id, id);
      if (repos.membership.member(user, id) || p.host_user_id === user)
        throw communityError("already_group_member");
      const s = repos.groups.seeker(user, p.concert_id);
      if (!s || s.status !== "open")
        throw communityError("open_seeker_request_required");
      if (s.joining_mode !== "direct") throw communityError("direct_joining_mode_required");
      if (!input || Array.isArray(input) || typeof input !== "object"
        || (input.note !== undefined && typeof input.note !== "string")
        || (input.note?.length ?? 0) > 500)
        throw communityError("invalid_application_note", 400);
      const note = input.note?.trim() ?? "";
      if (db.prepare(`SELECT 1 FROM group_join_requests WHERE party_id=? AND user_id=?
        AND status IN('pending','accepted')`).get(id, user))
        throw communityError("join_request_already_exists");
      if (repos.membership.settings(id) && !answersJson(user, p.concert_id))
        throw communityError("save_discovery_preferences_first");
      if (
        db
          .prepare(
            "SELECT 1 FROM match_proposals WHERE seeker_request_id=? AND (status='confirmed' OR(status='proposed' AND expires_at>?))",
          )
          .get(s.id, Date.now())
      )
        throw communityError("active_matching_proposal_exists");
      if (
        db.prepare("SELECT 1 FROM tickets WHERE source_party_id=?").get(id) ||
        !visible(p) ||
        !feasible(user, p) ||
        !["open", "matched"].includes(p.status) ||
        db.prepare(`SELECT ${queueablePlacesSql("@id")} n`).get({ id }).n < 1
      )
        throw communityError("group_unavailable");
      if (
        repos.proposals
          .declinedPairsForConcert(p.concert_id)
          .has(`${s.id}|${id}`)
      )
        throw communityError("previously_declined");
      const requestId = `gj_${randomUUID()}`;
      db
        .prepare(
          `INSERT INTO group_join_requests(id,party_id,user_id,seeker_request_id,status,expires_at,
            group_version,preferences_json,application_note) VALUES(?,?,?,?,'pending',?,?,?,?)`,
        )
        .run(
          requestId,
          id,
          user,
          s.id,
          Date.now() + 48 * 3600000,
          repos.membership.settings(id)?.version ?? 0,
          JSON.stringify(repos.recommendations.answers(user, p.concert_id)),
          note,
        );
      return { id: requestId, status: "pending", ...queueInfo(db, { joinRequestId: requestId }) };
    }).immediate,
    requests(user, { scope = "all", concertId } = {}) {
      if (!["all", "own", "hosted"].includes(scope)) throw communityError("invalid_request_scope", 400);
      repos.proposals.expire();
      repos.recommendations.expire();
      return db
        .prepare(
          `SELECT j.id,j.party_id AS partyId,j.user_id AS userId,u.display_name AS seekerName,p.host_user_id AS hostId,
        p.concert_id AS concertId,c.artist,h.display_name AS hostName,p.name AS groupName,p.image_path AS imagePath,p.section,j.status,j.expires_at AS expiresAt,
        j.created_at AS createdAt,j.responded_at AS respondedAt,j.matching_round_id AS matchingRoundId,
        j.application_note AS applicationNote,j.responded_by AS respondedBy,j.resolution_reason AS resolutionReason,j.preferences_json FROM group_join_requests j
        JOIN parties p ON p.id=j.party_id JOIN users u ON u.id=j.user_id JOIN users h ON h.id=p.host_user_id JOIN concerts c ON c.id=p.concert_id
        WHERE ((? IN('all','own') AND j.user_id=?) OR (? IN('all','hosted') AND p.host_user_id=?))
          AND (? IS NULL OR p.concert_id=?) ORDER BY j.created_at DESC,j.rowid DESC`,
        )
        .all(scope, user, scope, user, concertId ?? null, concertId ?? null)
        .map(({ preferences_json, imagePath, ...r }) => {
          const seeker = repos.users.findById(r.userId);
          const party = repos.parties.findById(r.partyId);
          const request = repos.groups.seeker(r.userId, r.concertId);
          const scored = request ? pairScore(request, party) : null;
          return {
            ...r,
            ...queueInfo(db, { joinRequestId: r.id }),
            imageUrl: groupImageUrl(imagePath),
            legacyAutomatic: Boolean(r.matchingRoundId),
            compatibility: scored ? Math.round((scored.seekerToParty + scored.partyToSeeker) * 5000) / 10000 : null,
            reasons: scored?.discovery?.reasons ?? [],
            remainingCapacity: party.remaining_capacity,
            seeker: {
              id: seeker.id,
              displayName: seeker.display_name,
              ageBand: seeker.age_band,
              languages: seeker.languages,
              vibe: seeker.vibe,
              reliability: seeker.reliability,
            },
            preferences: preferences_json ? JSON.parse(preferences_json) : null,
          };
        });
    },
    currentMemberships(user) {
      repos.proposals.expire();
      return repos.membership.activeGroups(user).map((attendance) => {
        const p = repos.parties.findById(attendance.id);
        const claim = db.prepare(`SELECT source FROM active_seat_claims a JOIN seeker_requests s
          ON s.id=a.seeker_request_id WHERE s.user_id=? AND a.party_id=? AND a.status='confirmed'`).get(user, p.id);
        return {
          ...attendance,
          partyId: p.id,
          assignmentOrigin: claim?.source ?? (attendance.source === "proposal" ? "algorithm" : attendance.source === "join" ? "direct" : attendance.source),
          assignmentStatus: "confirmed",
          host: { id: p.host_user_id, displayName: p.host.display_name },
          group: { id: p.id, name: p.name, imageUrl: groupImageUrl(p.image_path),
            section: p.section, spendBand: p.spend_band, arrivalPlan: p.arrival_plan, notes: p.notes, status: p.status },
          remainingCapacity: p.remaining_capacity,
          members: db.prepare(`SELECT u.id,u.display_name AS name,m.source FROM group_memberships m JOIN users u ON u.id=m.user_id
            WHERE m.party_id=? AND m.status='active' ORDER BY m.joined_at,u.id`).all(p.id),
        };
      });
    },
    respond: db.transaction((user, id, action) => {
      if (action === "decline") action = "reject";
      if (!["accept", "reject", "withdraw"].includes(action))
        throw communityError("invalid_decision", 400);
      repos.proposals.expire();
      repos.recommendations.expire();
      const j = db
        .prepare("SELECT * FROM group_join_requests WHERE id=?")
        .get(id);
      if (!j) throw communityError("request_not_found", 404);
      const p = repos.membership.party(j.party_id);
      if (action === "withdraw" ? j.user_id !== user : p.host_user_id !== user)
        throw communityError("request_not_found", 404);
      if (j.status !== "pending" || j.expires_at <= Date.now())
        throw communityError("request_not_pending");
      if (action !== "withdraw" && !queueInfo(db, { joinRequestId: j.id }).canHostRespond)
        throw communityError("request_waiting_in_queue");
      if (action === "accept") {
        if (
          j.group_version == null ||
          !j.preferences_json ||
          j.preferences_json !== JSON.stringify(repos.recommendations.answers(j.user_id, p.concert_id))
        )
          throw communityError("preferences_changed_withdraw_and_resubmit");
        if (
          j.group_version !== (repos.membership.settings(p.id)?.version ?? 0)
        )
          throw communityError("group_changed_withdraw_and_resubmit");
        repos.proposals.expire();
        const live = repos.parties.findById(p.id);
        const ownClaim = db.prepare(`SELECT id FROM active_seat_claims
          WHERE join_request_id=? AND party_id=? AND user_id=? AND source=?
          AND status='proposed' AND seat_held=1 AND expires_at>?`).get(j.id, p.id, j.user_id,
            j.matching_round_id ? "algorithm" : "direct", Date.now());
        if (!ownClaim) throw communityError("claim_source_invalid");
        if (
          !["open", "matched"].includes(live.status) ||
          live.remaining_capacity + 1 < 1 ||
          !visible(live) ||
          !feasible(j.user_id, live)
        )
          throw communityError("group_unavailable");
        repos.membership.ensureFree(j.user_id, p.concert_id, p.id);
        const request = repos.groups.seeker(j.user_id, p.concert_id);
        if (request?.joining_mode !== (j.matching_round_id ? "algorithm" : "direct"))
          throw communityError("joining_mode_changed");
        if (request && repos.proposals.declinedPairsForConcert(p.concert_id).has(`${request.id}|${p.id}`))
          throw communityError("previously_declined");
        if (
          !request ||
          !["open", "matched"].includes(request.status) ||
          db
            .prepare(
              "SELECT 1 FROM match_proposals WHERE seeker_request_id=? AND (status='confirmed' OR(status='proposed' AND expires_at>?))",
            )
            .get(request.id, Date.now())
        )
          throw communityError("active_matching_proposal_exists");
        // Confirm the same reserved claim; membership never consumes another seat.
        db.prepare(
          "UPDATE group_join_requests SET status='accepted',responded_at=datetime('now'),responded_by=? WHERE id=?",
        ).run(user, id);
        repos.membership.attach(p, j.user_id, "join");
        const answers = answersJson(j.user_id, p.concert_id);
        if (answers)
          db.prepare(
            `INSERT INTO group_member_preferences(party_id,user_id,answers_json) VALUES(?,?,?)
          ON CONFLICT(party_id,user_id) DO UPDATE SET answers_json=excluded.answers_json`,
          ).run(p.id, j.user_id, answers);
        // Explicit choice ends the automatic placement request; no second acceptance.
        db.prepare(
          "UPDATE seeker_requests SET status='matched',matching_opt_in=0 WHERE user_id=? AND concert_id=?",
        ).run(j.user_id, p.concert_id);
        if (
          repos.parties.findById(p.id).remaining_capacity === 0 &&
          !db.prepare(`SELECT 1 FROM group_join_requests WHERE party_id=? AND matching_round_id IS NOT NULL
            AND status='pending' AND expires_at > unixepoch('subsec') * 1000`).get(p.id)
        )
          repos.parties.setStatus(p.id, "matched");
      }
      const status = {
        accept: "accepted",
        reject: "rejected",
        withdraw: "withdrawn",
      }[action];
      if (action === "reject") {
        const seeker = repos.groups.seeker(j.user_id, p.concert_id);
        if (seeker)
          db.prepare(
            "INSERT OR IGNORE INTO match_declines(seeker_request_id,party_id) VALUES(?,?)",
          ).run(seeker.id, p.id);
      }
      db.prepare(
        "UPDATE group_join_requests SET status=?,responded_at=datetime('now'),responded_by=? WHERE id=? AND status='pending'",
      ).run(status, user, id);
      // Admissions advance the queue without changing its agreed policy version.
      // Explicit settings and member preference edits still renew consent.
      repos.recommendations.expire();
      return { id, status, ...queueInfo(db, { joinRequestId: id }) };
    }).immediate,
  };
}
