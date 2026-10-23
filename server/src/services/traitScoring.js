/**
 * Scoring the dimensions behind the questionnaire — one rule per dimension.
 *
 * WHY NOT ONE RULE FOR EVERYTHING
 * -------------------------------
 * The concept answers are compared one way: what I said I want, against what
 * you said you are. That is the right rule for a want — it is satisfied by
 * somebody who offers the thing — but it is the wrong rule for most of what
 * the quiz learns, because those dimensions fail in different directions:
 *
 *   SIMILARITY       Energy, fandom and extraversion. Two quiet people have a
 *                    fine night; two loud people have a fine night; one of each
 *                    is the mismatch. What matters is the DISTANCE between them,
 *                    in either direction.
 *
 *   BOTH_HIGH        Agreeableness. Not distance: two difficult people are not
 *                    compatible just because they are equally difficult. The
 *                    pair is only as accommodating as its least accommodating
 *                    half, so the score follows the LOWER of the two.
 *
 *   ORDINAL          Crowd position. Barricade, middle and back lie on a line,
 *                    and neighbours are a compromise while the two ends are
 *                    not: these two people would spend the concert apart.
 *
 *   INTENT           What each person came for. Not a scale at all — some pairs
 *                    of intentions work and others do not, with no ordering
 *                    between them, so it takes a table.
 *
 * Scoring all four the same way is the main weakness of comparing only the
 * concept lists, and fixing it is worth more than collecting more answers.
 *
 * DEALBREAKERS
 * ------------
 * Everything above produces a number to be weighed against other numbers. A
 * dealbreaker does not: it removes somebody. A person is allowed a few, and
 * they are checked before any of this arithmetic runs, because no amount of
 * agreeing about supper makes up for the one thing somebody said they would not
 * accept. This is the same principle the finder already follows, where a filter
 * beats the ranking rather than competing with it.
 */

import { CROWD_ORDER, TRAIT_SCALE } from './preferenceQuiz.js';

/** How much of the trait score each dimension can carry, before renormalising. */
export const TRAIT_WEIGHTS = {
  looking: 0.28,
  energy: 0.18,
  crowd: 0.16,
  fandom: 0.12,
  horizon: 0.1,
  extraversion: 0.1,
  agreeableness: 0.06,
};

export const TRAIT_KINDS = {
  looking: 'intent',
  horizon: 'intent',
  energy: 'similarity',
  fandom: 'similarity',
  extraversion: 'similarity',
  agreeableness: 'both_high',
  crowd: 'ordinal',
};

/**
 * How well two intentions sit together. Symmetric by construction.
 *
 * Somebody who wants a friend is good company for almost anyone, so those pairs
 * stay high. The genuine clash is at the edges: a person who wants a crowd next
 * to a person who wants one quiet companion, and a person who came to split a
 * taxi next to a person who came to make a friend — not hostile, just a
 * different evening, so neither is zero.
 */
export const LOOKING_FIT = {
  stand_with: { stand_with: 1, friend: 0.75, group: 0.45, logistics: 0.6 },
  friend: { stand_with: 0.75, friend: 1, group: 0.7, logistics: 0.45 },
  group: { stand_with: 0.45, friend: 0.7, group: 1, logistics: 0.4 },
  logistics: { stand_with: 0.6, friend: 0.45, group: 0.4, logistics: 1 },
};

/**
 * Different horizons are a mild mismatch, not a clash: somebody after one good
 * night and somebody hoping for a friend can still enjoy the same concert.
 */
const HORIZON_FIT = 0.35;

const span = TRAIT_SCALE.max - TRAIT_SCALE.min;

const RULES = {
  similarity: (a, b) => 1 - Math.abs(a - b) / span,
  both_high: (a, b) => (Math.min(a, b) - TRAIT_SCALE.min) / span,
  ordinal: (a, b) => {
    const i = CROWD_ORDER.indexOf(a);
    const j = CROWD_ORDER.indexOf(b);
    if (i === -1 || j === -1) return null;
    return 1 - Math.abs(i - j) / (CROWD_ORDER.length - 1);
  },
  intent: (a, b, dimension) =>
    dimension === 'looking' ? (LOOKING_FIT[a]?.[b] ?? null) : a === b ? 1 : HORIZON_FIT,
};

/** Wording for a dimension both people landed on, for the card to show. */
const REASONS = {
  looking: {
    stand_with: 'Both just want someone to stand with',
    friend: 'Both hoping to make a friend',
    group: 'Both want a group for the night',
    logistics: 'Both want to split the costs',
  },
  crowd: {
    barricade: 'Both headed for the barricade',
    middle: 'Both happy in the middle',
    back: 'Both prefer the back, where there is room',
  },
  horizon: {
    one_night: 'Both here for one good night',
    ongoing: 'Both open to more concerts after this',
  },
};

const NEAR = {
  energy: 'Similar energy at a show',
  fandom: 'Know the artist about equally well',
  extraversion: 'Similar about talking to strangers',
  agreeableness: 'Both easy to make plans with',
};

/** A dimension counts only when BOTH people have it: silence is not a score. */
const shared = (a, b, key) =>
  a?.[key] !== undefined && a[key] !== null && b?.[key] !== undefined && b[key] !== null;

/**
 * Compare two sets of dimensions.
 *
 * Returns `null` when the two have no dimension in common, which the caller
 * must treat as "no opinion" rather than as a score of zero — an unanswered
 * quiz is not evidence of a bad match.
 *
 * Weights are renormalised over the dimensions actually shared, so somebody who
 * answered three cards is scored on those three rather than being marked down
 * for the four they skipped.
 */
export function scoreTraits(mine, theirs) {
  const parts = [];
  let total = 0;
  let weight = 0;

  for (const [dimension, kind] of Object.entries(TRAIT_KINDS)) {
    if (!shared(mine, theirs, dimension)) continue;
    const value = RULES[kind](mine[dimension], theirs[dimension], dimension);
    if (value === null || Number.isNaN(value)) continue;
    const w = TRAIT_WEIGHTS[dimension];
    total += w * value;
    weight += w;
    parts.push({ dimension, kind, fit: Math.round(value * 1000) / 1000 });
  }

  if (!weight) return null;

  // Only strong agreement is worth saying out loud; a lukewarm dimension on a
  // card reads as padding and teaches the reader to ignore the rest.
  const reasons = [];
  for (const part of [...parts].sort((a, b) => b.fit - a.fit)) {
    if (part.fit < 0.8) break;
    const { dimension } = part;
    const label =
      REASONS[dimension]?.[mine[dimension]] ??
      (mine[dimension] === theirs[dimension] ? REASONS[dimension]?.[mine[dimension]] : null) ??
      NEAR[dimension];
    if (label) reasons.push({ concept: `trait:${dimension}`, label, support: Math.round(part.fit * 100) });
    if (reasons.length === 2) break;
  }

  return { score: Math.round((total / weight) * 10000) / 10000, parts, reasons };
}

/**
 * The first dealbreaker of mine that this person trips, or null.
 *
 * Checked against what they said they are, not what they want: a dealbreaker is
 * about who somebody is on the night, and wanting something is not doing it.
 * Group profiles hold fractional support, so any trace counts — one member who
 * does the thing is enough for the person who refused it.
 */
export function dealbreakerHit(mine, theirs) {
  for (const key of mine?.dealbreakers ?? []) if ((theirs?.about?.[key] ?? 0) > 0) return key;
  return null;
}
