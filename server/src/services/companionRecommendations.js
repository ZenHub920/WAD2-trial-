/**
 * Ranked companion recommendations.
 *
 * WHICH ALGORITHM, AND WHY NOT GALE-SHAPLEY
 * -----------------------------------------
 * Companion finding is ONE pool. Everybody is looking for the same thing and
 * nobody holds anything the others want, so there are no two disjoint sides to
 * propose between — and Gale-Shapley is defined only over a bipartite instance.
 * Applying it here would mean inventing a split (alphabetical? by join order?)
 * and the "stability" it then guaranteed would be stability against an
 * arbitrary fiction.
 *
 * The right model for one symmetric pool is STABLE ROOMMATES, and the engine
 * already knows it: `classifyInstance({ people })` returns PEER_TO_PEER and the
 * solver registry routes that to Irving's algorithm. This module hands the pool
 * to the registry rather than naming a solver, so the choice stays one decision
 * recorded in one place — the same path the group rounds take, where the same
 * registry picks deferred acceptance because THAT instance really is bipartite.
 *
 * Unlike Hospital/Residents, a stable matching need not exist for roommates.
 * That is not a failure here: a deck only needs an ORDER, so when Irving's
 * reports no stable matching we still rank by score and simply have no partner
 * to lead with.
 *
 * FILTERS COME FIRST
 * ------------------
 * Filters are narrowing, ranking is ordering, and narrowing wins. The pool is
 * filtered BEFORE the instance is built, so the solver only ever sees people
 * the viewer would accept — which also means the stable partner it finds is
 * stable with respect to what they actually asked for, not to a wider pool
 * they have excluded.
 *
 * NO ANSWERS, NO RANKING
 * ----------------------
 * Preference lists come from the questionnaire. With nothing to rank on, this
 * returns the filtered pool untouched and says so, and the finder falls back to
 * plain filtering rather than pretending an order means something.
 */

import { classifyInstance, CLASS } from '../matching/classify.js';
import { selectSolver } from '../matching/registry.js';
import { compareProfiles, individualProfile } from './discoveryPreferences.js';
import { dealbreakerHit } from './traitScoring.js';

const EMPTY_ANSWERS = { about: [], wants: [], avoid: [] };

/** Everything a person's ranking is computed from, gathered once per pool. */
function profileFor(answersJson) {
  if (!answersJson) return null;
  try {
    return individualProfile(JSON.parse(answersJson));
  } catch {
    return null;
  }
}

/**
 * Build the deck.
 *
 * @param {object[]} people     pool entries from the kaki repository
 * @param {string}   viewerId
 * @param {Function} answersFor `(userId) => answers_json | null`
 */
export function recommendCompanions(people, viewerId, answersFor) {
  const mine = profileFor(answersFor(viewerId));
  if (!mine) {
    return {
      ranked: false,
      reason: 'questionnaire_not_answered',
      stablePartnerId: null,
      vetoed: [],
      people,
    };
  }

  // One entry per PERSON, even though the pool is keyed by concert:user — the
  // same person met at two concerts is one person to rank.
  const profiles = new Map([[viewerId, mine]]);
  for (const person of people) {
    const id = person.user.id;
    if (profiles.has(id)) continue;
    profiles.set(id, profileFor(answersFor(id)) ?? individualProfile(EMPTY_ANSWERS));
  }

  // A dealbreaker is a filter, not a bad score, so it is applied BEFORE the
  // instance is built: the solver never sees somebody the viewer has refused,
  // and the partner it finds is stable among people they would actually accept.
  const vetoed = [];
  const eligible = [];
  for (const person of people) {
    const hit = dealbreakerHit(mine, profiles.get(person.user.id));
    if (hit) vetoed.push({ id: person.id, userId: person.user.id, dealbreaker: hit });
    else eligible.push(person);
  }

  /** How well `them` answers what `me` said they want. */
  const scoreFrom = (meId, themId) =>
    compareProfiles(profiles.get(meId), profiles.get(themId)).seekerScore;

  const ids = [viewerId, ...new Set(eligible.map((person) => person.user.id))]
    .filter((id, index, all) => all.indexOf(id) === index);
  const instance = classifyInstance({ people: ids });
  // selectSolver returns the registry's decision, not the function: the solver
  // itself plus what it had to relax and what it can still promise afterwards.
  const choice = ids.length > 1 ? selectSolver(instance) : null;
  const solver = choice?.solver ?? null;

  let stablePartnerId = null;
  let stable = null;
  // A pool of one is the viewer alone; there is nobody to pair with.
  if (solver && instance.class === CLASS.PEER_TO_PEER) {
    const preferences = new Map(
      ids.map((id) => [
        id,
        ids
          .filter((other) => other !== id)
          .sort((a, b) => scoreFrom(id, b) - scoreFrom(id, a) || a.localeCompare(b)),
      ]),
    );
    stable = solver.solve(preferences);
    const pair = stable.pairs?.find(([a, b]) => a === viewerId || b === viewerId);
    if (pair) stablePartnerId = pair[0] === viewerId ? pair[1] : pair[0];
  }

  const scored = eligible.map((person) => {
    const comparison = compareProfiles(mine, profiles.get(person.user.id));
    return {
      ...person,
      compatibility: comparison.score,
      fitForYou: comparison.seekerScore,
      // Concept agreement first, then what the quiz dimensions agree on, so a
      // card leads with the person's own words and falls back on the quiz.
      reasons: [...comparison.reasons, ...comparison.traitReasons].slice(0, 4),
      stableMatch: person.user.id === stablePartnerId,
    };
  });

  // The stable partner leads; everyone else follows by how well they answer
  // what the viewer asked for. The id is the final tiebreak so the deck is
  // stable between requests — a deck that reshuffles on reload is unusable.
  scored.sort((a, b) =>
    Number(b.stableMatch) - Number(a.stableMatch)
    || b.fitForYou - a.fitForYou
    || a.id.localeCompare(b.id));

  return {
    ranked: true,
    stablePartnerId,
    solver: solver
      ? { id: solver.id, name: solver.name, guarantees: choice.effectiveGuarantees, reason: choice.reason }
      : null,
    // `stable: false` is a real answer for roommates, not an error.
    stable: stable ? stable.stable : null,
    // Reported rather than silently dropped: a deck that shrank for a reason
    // the viewer set themselves should be able to say so.
    vetoed,
    people: scored,
  };
}
