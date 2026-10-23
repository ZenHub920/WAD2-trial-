import { averageTraits, deriveTraits, validateQuiz } from "./preferenceQuiz.js";
import { dealbreakerHit, scoreTraits } from "./traitScoring.js";

export const CONCEPTS = [
  {
    id: "post_supper",
    label: "Food after the concert",
    aliases: [
      "supper",
      "late night makan",
      "post concert food",
      "get food after the show",
      "supper buddies",
    ],
  },
  {
    id: "pre_meetup",
    label: "Meet before the concert",
    aliases: ["pre show meetup", "meet beforehand", "pre concert meetup"],
  },
  {
    id: "merch_run",
    label: "Merchandise shopping",
    aliases: ["merch", "merch queue", "buy merch", "merch hunting"],
  },
  {
    id: "transport_share",
    label: "Share transport",
    aliases: ["carpool", "share a ride", "travel together"],
  },
  {
    id: "singalong",
    label: "Sing along",
    aliases: ["singing loudly", "singalong", "screamer", "scream lyrics"],
  },
  {
    id: "quiet",
    label: "Quiet listening",
    aliases: ["chill", "quiet group", "listen quietly"],
  },
  { id: "dancing", label: "Dancing", aliases: ["dance", "energetic dancing"] },
  {
    id: "photography",
    label: "Photography",
    aliases: ["photos", "take pictures", "concert photography"],
  },
  {
    id: "early_queue",
    label: "Queue early",
    aliases: ["early queue", "queue early", "arrive early"],
  },
  {
    id: "doors",
    label: "Arrive at doors",
    aliases: ["arrive at doors", "doors arrival"],
  },
  {
    id: "public_transport",
    label: "Take public transport",
    aliases: ["mrt", "bus", "train", "take the mrt"],
  },
  {
    id: "hearing_protection",
    label: "Bring concert earplugs",
    aliases: ["earplugs", "hearing protection", "protect hearing"],
  },
  {
    id: "pre_food",
    label: "Food before the concert",
    aliases: ["dinner beforehand", "pre show dinner", "eat before the show"],
  },
  {
    id: "phone_light",
    label: "Keep phone use minimal",
    aliases: ["phone free", "no filming", "minimal phone use"],
  },
  {
    id: "group_photos",
    label: "Group photos",
    aliases: ["take group photos", "group pictures"],
  },
];
// Options that were offered once and later removed. Answers saved before the
// removal still name them, so they are dropped on read and on save instead of
// failing validation or showing up as a raw key.
const RETIRED = new Set(["hydration_breaks"]);
export function withoutRetired(answers) {
  const output = { ...answers };
  for (const intent of ["about", "wants", "avoid"])
    if (Array.isArray(output[intent]))
      output[intent] = output[intent].filter(
        (item) => !RETIRED.has(item?.key ?? item?.conceptId),
      );
  if (Array.isArray(output.dealbreakers))
    output.dealbreakers = output.dealbreakers.filter((key) => !RETIRED.has(key));
  return output;
}

/**
 * How many dealbreakers one person may hold.
 *
 * A veto is powerful — it removes somebody however well they score elsewhere —
 * and a list of twelve of them is not a set of dealbreakers, it is a search for
 * nobody. Capping it forces the choice that makes the rest of the scoring
 * meaningful: these three I will not accept, everything else is a preference.
 */
export const DEALBREAKER_LIMIT = 3;

/**
 * Dealbreakers must be things the person already listed under "avoid".
 *
 * Keeping the two in step means a veto is always visible as an ordinary
 * preference as well, so nobody is filtered out by a rule its owner has
 * forgotten they set.
 */
export function validateDealbreakers(input, avoid = []) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > DEALBREAKER_LIMIT)
    throw Object.assign(new Error("too_many_dealbreakers"), { status: 400 });
  const allowed = new Set(avoid.map((item) => item.key));
  const output = [];
  for (const key of input) {
    if (typeof key !== "string" || !allowed.has(key))
      throw Object.assign(new Error("dealbreaker_not_in_avoid"), { status: 400 });
    if (!output.includes(key)) output.push(key);
  }
  return output;
}
export const normalize = (value) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const aliases = new Map(
  CONCEPTS.flatMap((c) =>
    [c.id, c.label, ...c.aliases].map((a) => [normalize(a), c.id]),
  ),
);
export function suggestions(text = "") {
  const query = normalize(text);
  if (!query) return CONCEPTS;
  const words = new Set(query.split(" "));
  return CONCEPTS.map((c) => ({
    ...c,
    relevance: Math.max(
      ...[c.label, ...c.aliases].map((a) => {
        const n = normalize(a);
        if (n === query) return 1;
        if (n.includes(query)) return 0.9;
        const tokens = n.split(" ");
        return (
          tokens.filter((t) => words.has(t)).length /
          Math.max(words.size, tokens.length)
        );
      }),
    ),
  }))
    .filter((c) => c.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id))
    .slice(0, 10);
}
export function validateAnswers(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Object.assign(new Error("preferences_required"), { status: 400 });
  const output = {};
  for (const intent of ["about", "wants", "avoid"]) {
    const entries = input[intent] ?? [];
    if (!Array.isArray(entries) || entries.length > 30)
      throw Object.assign(new Error("invalid_preferences"), { status: 400 });
    const seen = new Set();
    output[intent] = [];
    for (const entry of entries) {
      const text = typeof entry === "string" ? entry : entry?.text;
      if (typeof text !== "string" || !text.trim() || text.length > 100)
        throw Object.assign(new Error("invalid_preference_text"), {
          status: 400,
        });
      const explicit = typeof entry === "object" ? entry.conceptId : null;
      if (explicit && RETIRED.has(explicit)) continue;
      const keepCustom = typeof entry === "object" && entry.custom === true;
      if (keepCustom && explicit)
        throw Object.assign(new Error("choose_concept_or_custom"), {
          status: 400,
        });
      if (explicit && !CONCEPTS.some((c) => c.id === explicit))
        throw Object.assign(new Error("unknown_concept"), { status: 400 });
      const key = keepCustom
        ? `custom:${normalize(text)}`
        : explicit ||
          aliases.get(normalize(text)) ||
          `custom:${normalize(text)}`;
      if (!seen.has(key)) {
        output[intent].push({
          key,
          text: text.trim(),
          recognized: !key.startsWith("custom:"),
        });
        seen.add(key);
      }
    }
  }
  // Derived here rather than taken from the request: the client says which
  // option was picked, so it cannot hand itself a flattering personality.
  output.quiz = validateQuiz(input.quiz);
  const traits = deriveTraits(output.quiz);
  if (Object.keys(traits).length) output.traits = traits;
  output.dealbreakers = validateDealbreakers(input.dealbreakers, output.avoid);
  return output;
}
export function aggregateAnswers(answers) {
  const normalized = answers.map(withoutRetired);
  const profile = {
    about: {},
    wants: {},
    avoid: {},
    respondents: answers.length,
  };
  for (const a of normalized)
    for (const intent of ["about", "wants", "avoid"])
      for (const item of a[intent] ?? []) {
        profile[intent][item.key] =
          (profile[intent][item.key] ?? 0) + 1 / answers.length;
      }
  const traits = averageTraits(normalized.map((a) => a.traits));
  if (Object.keys(traits).length) profile.traits = traits;
  // A group is only as accepting as its least accepting member, so one
  // member's veto stands for the whole group rather than being averaged away.
  const dealbreakers = [
    ...new Set(normalized.flatMap((a) => a.dealbreakers ?? [])),
  ];
  if (dealbreakers.length) profile.dealbreakers = dealbreakers;
  return profile;
}
export const individualProfile = (answers) => aggregateAnswers([answers]);

/**
 * How much of a comparison the concept lists carry once a quiz exists.
 *
 * The concepts are the person's own words about the night and stay the larger
 * half. The quiz dimensions are a smaller, steadier signal: they come from
 * fixed options, so they are comparable between two people in a way free text
 * is not, but they are inferred rather than stated and should not be able to
 * overrule what somebody told us outright.
 */
const CONCEPT_SHARE = 0.65;
export function compareProfiles(a, b) {
  const direction = (from, to) => {
    let total = 0,
      weight = 0,
      customTotal = 0,
      customWeight = 0;
    const evidence = [];
    for (const [key, support] of Object.entries(from.wants)) {
      const overlap = to.about[key] ?? 0;
      if (key.startsWith("custom:")) {
        customWeight += support;
        customTotal += support * overlap;
      } else {
        weight += support;
        total += support * overlap;
      }
      if (overlap > 0)
        evidence.push({ key, support: overlap, strength: support * overlap });
    }
    const avoid = Object.entries(from.avoid).reduce(
      (sum, [key, support]) => sum + support * (to.about[key] ?? 0),
      0,
    );
    const known = weight ? total / weight : 0.5;
    const combined = customWeight
      ? 0.8 * known + (0.2 * customTotal) / customWeight
      : known;
    return {
      score: Math.max(
        0,
        combined -
          Math.min(0.5, avoid / Math.max(1, Object.keys(from.avoid).length)),
      ),
      evidence,
    };
  };
  const ab = direction(a, b),
    ba = direction(b, a);
  const shared = Object.entries(a.about)
    .filter(([key]) => b.about[key])
    .map(([key, support]) => ({
      key,
      support: Math.min(support, b.about[key]),
      strength: Math.min(support, b.about[key]),
    }));
  const evidence = [...ab.evidence, ...ba.evidence, ...shared].sort(
    (x, y) => y.strength - x.strength || x.key.localeCompare(y.key),
  );
  const supported = new Map();
  for (const e of evidence) {
    if (supported.has(e.key)) continue;
    supported.set(e.key, {
      concept: e.key,
      label: CONCEPTS.find((c) => c.id === e.key)?.label ?? e.key.slice(7),
      support: Math.round(e.support * 100),
    });
  }
  const reasons = [...supported.values()].slice(0, 3);

  // A veto is checked before any of the arithmetic below, and ends the
  // comparison: no amount of agreeing about supper makes up for the one thing
  // somebody said they would not accept.
  const blockedBy = dealbreakerHit(a, b);
  const blockedByThem = dealbreakerHit(b, a);
  const blocked = Boolean(blockedBy || blockedByThem);

  // The quiz dimensions are scored by their own rules and then blended with
  // the concept lists. Without a quiz on both sides there is nothing to blend,
  // and the result is exactly what it was before the quiz existed.
  const traits = blocked ? null : scoreTraits(a.traits, b.traits);
  const blend = (conceptScore, vetoed) => {
    if (vetoed) return 0;
    if (!traits) return conceptScore;
    return CONCEPT_SHARE * conceptScore + (1 - CONCEPT_SHARE) * traits.score;
  };
  const seekerScore = blend(ab.score, blockedBy);
  const groupScore = blend(ba.score, blockedByThem);

  return {
    score: blocked
      ? 0
      : Math.round(((seekerScore + groupScore) / 2) * 10000) / 10000,
    seekerScore,
    groupScore,
    reasons,
    blocked,
    blockedBy: blockedBy ?? null,
    blockedByThem: blockedByThem ?? null,
    traits: traits ? { score: traits.score, parts: traits.parts } : null,
    traitReasons: traits ? traits.reasons : [],
    confidence:
      a.respondents && b.respondents && evidence.length
        ? "supported"
        : "limited",
  };
}
