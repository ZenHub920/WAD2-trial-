import { dealbreakerHit } from './traitScoring.js';

/** Mutual consent constraints are eligibility rules, independent of ranking. */
export function preferenceEligibility(a, b) {
  const own = dealbreakerHit(a, b);
  const other = dealbreakerHit(b, a);
  return { eligible: !own && !other, own: own ?? null, other: other ?? null };
}
