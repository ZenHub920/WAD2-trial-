import { randomUUID } from "node:crypto";
import { communityError } from "./membershipRepository.js";
import { expireJoinRequests } from "./capacity.js";
import {
  validateAnswers,
  individualProfile,
  compareProfiles,
  withoutRetired,
} from "../services/discoveryPreferences.js";
import { checkFeasibility, scorePair } from "../matching/compatibility.js";
export function createRecommendationRepo(db, repos) {
  const personal = (user, concert) =>
    individualProfile(
      JSON.parse(
        db
          .prepare(
            "SELECT answers_json FROM seeker_discovery_preferences WHERE user_id=? AND concert_id=?",
          )
          .get(user, concert)?.answers_json ??
          '{"about":[],"wants":[],"avoid":[]}',
      ),
    );
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
  const rankIndividual = (user, card) => {
    const p = repos.parties.findById(card.id),
      s = repos.groups.seeker(user, p.concert_id);
    const profile = repos.membership.profile(p.id);
    const concepts = compareProfiles(personal(user, p.concert_id), profile);
    const base = s ? scorePair(s, aggregateParty(p)) : null;
    return {
      ...card,
      compatibility: base
        ? Math.round(
            ((0.6 * (base.seekerToParty + base.partyToSeeker)) / 2 +
              0.4 * concepts.score) *
              10000,
          ) / 10000
        : null,
      reasons: concepts.reasons,
      confidence: concepts.confidence,
      profile,
      requiresHostApproval: true,
      automaticPlacementAvailable: repos.membership.settings(p.id)
        ? repos.groups.automaticPlacementEligible(user, p)
        : true,
    };
  };
  return {
    personal,
    visible,
    aggregateParty,
    feasible,
    expire: db.transaction(() => expireJoinRequests(db)).immediate,
    answers(user, concert) {
      return withoutRetired(JSON.parse(
        db
          .prepare(
            "SELECT answers_json FROM seeker_discovery_preferences WHERE user_id=? AND concert_id=?",
          )
          .get(user, concert)?.answers_json ??
          '{"about":[],"wants":[],"avoid":[]}',
      ));
    },
    savePersonal: db.transaction((user, concert, input) => {
      if (!repos.concerts.findById(concert))
        throw communityError("concert_not_found", 404);
      const answers = validateAnswers(input);
      const previous = db.prepare(
        "SELECT answers_json FROM seeker_discovery_preferences WHERE user_id=? AND concert_id=?",
      ).get(user, concert)?.answers_json;
      const serialized = JSON.stringify(answers);
      db.prepare(
        `INSERT INTO seeker_discovery_preferences VALUES(?,?,?) ON CONFLICT(user_id,concert_id) DO UPDATE SET answers_json=excluded.answers_json`,
      ).run(user, concert, serialized);
      if (previous !== serialized)
        // A missing version means consent must be renewed, even if answers are later restored.
        db.prepare(`UPDATE group_join_requests SET group_version=NULL WHERE user_id=? AND status='pending'
          AND party_id IN(SELECT id FROM parties WHERE concert_id=?)`).run(user, concert);
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
    requestJoin: db.transaction((user, id, { matchingRoundId = null } = {}) => {
      repos.proposals.expire();
      repos.recommendations.expire();
      const p = repos.membership.party(id);
      if (
        db
          .prepare(
            "SELECT 1 FROM group_join_requests j JOIN parties p ON p.id=j.party_id WHERE j.user_id=? AND p.concert_id=? AND j.status='pending'",
          )
          .get(user, p.concert_id)
      )
        throw communityError("withdraw_current_join_request_first");
      repos.membership.ensureFree(user, p.concert_id, id);
      if (repos.membership.member(user, id) || p.host_user_id === user)
        throw communityError("already_group_member");
      const s = repos.groups.seeker(user, p.concert_id);
      if (!s || s.status !== "open")
        throw communityError("open_seeker_request_required");
      if (matchingRoundId && (
        !s.matching_opt_in ||
        !repos.membership.settings(id) ||
        !db.prepare("SELECT 1 FROM match_rounds WHERE id=? AND concert_id=?").get(matchingRoundId, p.concert_id)
      ))
        throw communityError("automatic_matching_consent_required");
      if (
        repos.membership.settings(id) &&
        !db
          .prepare(
            "SELECT 1 FROM seeker_discovery_preferences WHERE user_id=? AND concert_id=?",
          )
          .get(user, p.concert_id)
      )
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
        !visible(p) ||
        !feasible(user, p) ||
        p.status !== "open" ||
        p.remaining_capacity < 1
      )
        throw communityError("group_unavailable");
      if (
        repos.proposals
          .declinedPairsForConcert(p.concert_id)
          .has(`${s.id}|${id}`)
      )
        throw communityError("previously_declined");
      const requestId = `gj_${randomUUID()}`;
      const inserted = db
        .prepare(
          `INSERT INTO group_join_requests(id,party_id,user_id,status,expires_at,group_version,preferences_json,matching_round_id) VALUES(?,?,?,'pending',?,?,?,?)
        ON CONFLICT(party_id,user_id) DO UPDATE SET status='pending',expires_at=excluded.expires_at,responded_at=NULL,group_version=excluded.group_version,preferences_json=excluded.preferences_json,matching_round_id=excluded.matching_round_id
        WHERE group_join_requests.status IN('withdrawn','expired') RETURNING id`,
        )
        .get(
          requestId,
          id,
          user,
          Date.now() + 48 * 3600000,
          repos.membership.settings(id)?.version ?? 0,
          JSON.stringify(repos.recommendations.answers(user, p.concert_id)),
          matchingRoundId,
        );
      if (!inserted) throw communityError("join_request_already_exists");
      if (!matchingRoundId)
        db.prepare("UPDATE seeker_requests SET matching_opt_in=0 WHERE id=?").run(s.id);
      return { id: inserted.id, status: "pending" };
    }).immediate,
    requests(user) {
      repos.recommendations.expire();
      return db
        .prepare(
          `SELECT j.id,j.party_id AS partyId,j.user_id AS userId,u.display_name AS seekerName,p.host_user_id AS hostId,
        p.concert_id AS concertId,c.artist,h.display_name AS hostName,p.section,j.status,j.expires_at AS expiresAt,
        j.created_at AS createdAt,j.matching_round_id AS matchingRoundId,j.preferences_json FROM group_join_requests j
        JOIN parties p ON p.id=j.party_id JOIN users u ON u.id=j.user_id JOIN users h ON h.id=p.host_user_id JOIN concerts c ON c.id=p.concert_id
        WHERE j.user_id=? OR p.host_user_id=? ORDER BY j.created_at DESC,j.id`,
        )
        .all(user, user)
        .map(({ preferences_json, ...r }) => {
          const seeker = repos.users.findById(r.userId);
          return {
            ...r,
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
    respond: db.transaction((user, id, action) => {
      if (!["accept", "reject", "withdraw"].includes(action))
        throw communityError("invalid_decision", 400);
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
        if (
          (!j.matching_round_id ? live.status !== "open" : !["open", "matched"].includes(live.status)) ||
          live.remaining_capacity + (j.matching_round_id ? 1 : 0) < 1 ||
          !visible(live) ||
          !feasible(j.user_id, live)
        )
          throw communityError("group_unavailable");
        repos.membership.ensureFree(j.user_id, p.concert_id, p.id);
        const request = repos.groups.seeker(j.user_id, p.concert_id);
        if (
          !request ||
          request.status !== "open" ||
          db
            .prepare(
              "SELECT 1 FROM match_proposals WHERE seeker_request_id=? AND (status='confirmed' OR(status='proposed' AND expires_at>?))",
            )
            .get(request.id, Date.now())
        )
          throw communityError("active_matching_proposal_exists");
        // Replace this request's reservation with one membership in the same transaction.
        db.prepare(
          "UPDATE group_join_requests SET status='accepted',responded_at=datetime('now') WHERE id=?",
        ).run(id);
        repos.membership.attach(p, j.user_id, "join");
        const answers = db
          .prepare(
            "SELECT answers_json FROM seeker_discovery_preferences WHERE user_id=? AND concert_id=?",
          )
          .get(j.user_id, p.concert_id);
        if (answers)
          db.prepare(
            `INSERT INTO group_member_preferences(party_id,user_id,answers_json) VALUES(?,?,?)
          ON CONFLICT(party_id,user_id) DO UPDATE SET answers_json=excluded.answers_json`,
          ).run(p.id, j.user_id, answers.answers_json);
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
        "UPDATE group_join_requests SET status=?,responded_at=datetime('now') WHERE id=? AND status='pending'",
      ).run(status, id);
      if (action === "withdraw")
        db.prepare("UPDATE seeker_requests SET matching_opt_in=0 WHERE user_id=? AND concert_id=?")
          .run(j.user_id, p.concert_id);
      if (action === "accept" && !j.matching_round_id)
        db.prepare(
          "UPDATE group_settings SET version=version+1 WHERE party_id=?",
        ).run(p.id);
      repos.recommendations.expire();
      return { id, status };
    }).immediate,
  };
}
