import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkFeasibility,
  scorePair,
  sectionScore,
  vibeScore,
  plansScore,
  arrivalScore,
  budgetFitScore,
  WEIGHTS,
} from '../src/matching/compatibility.js';
import { buildPreferences } from '../src/matching/preferences.js';
import { makeUser, makeSeeker, makeParty } from './helpers.js';

describe('Hard constraints', () => {
  test('rejects pairs from different concerts', () => {
    const seeker = makeSeeker('s1', makeUser('u1'), { concert_id: 'c1' });
    const party = makeParty('p1', makeUser('u2'), { concert_id: 'c2' });
    assert.equal(checkFeasibility(seeker, party).reason, 'different_concert');
  });

  test('rejects self-matching', () => {
    const user = makeUser('u1');
    const seeker = makeSeeker('s1', user);
    const party = makeParty('p1', user);
    assert.equal(checkFeasibility(seeker, party).reason, 'self_match');
  });

  test('rejects when the seeker cannot afford the party band', () => {
    const seeker = makeSeeker('s1', makeUser('u1'), { spend_band_max: 1 });
    const party = makeParty('p1', makeUser('u2'), { spend_band: 3 });
    assert.equal(checkFeasibility(seeker, party).reason, 'unaffordable');
  });

  test('allows an exact budget match', () => {
    const seeker = makeSeeker('s1', makeUser('u1'), { spend_band_max: 2 });
    const party = makeParty('p1', makeUser('u2'), { spend_band: 2 });
    assert.equal(checkFeasibility(seeker, party).feasible, true);
  });

  test('enforces the seeker gender preference', () => {
    const seeker = makeSeeker(
      's1',
      makeUser('u1', { gender: 'f', companion_gender_pref: 'same_only' }),
    );
    const party = makeParty('p1', makeUser('u2', { gender: 'm' }));
    assert.equal(checkFeasibility(seeker, party).reason, 'seeker_gender_pref');
  });

  test('enforces the host gender preference symmetrically', () => {
    const seeker = makeSeeker('s1', makeUser('u1', { gender: 'm' }));
    const party = makeParty(
      'p1',
      makeUser('u2', { gender: 'f', companion_gender_pref: 'same_only' }),
    );
    assert.equal(checkFeasibility(seeker, party).reason, 'host_gender_pref');
  });

  test('satisfied gender preferences pass', () => {
    const seeker = makeSeeker(
      's1',
      makeUser('u1', { gender: 'f', companion_gender_pref: 'same_only' }),
    );
    const party = makeParty(
      'p1',
      makeUser('u2', { gender: 'f', companion_gender_pref: 'same_only' }),
    );
    assert.equal(checkFeasibility(seeker, party).feasible, true);
  });

  test('enforces a party minimum age band', () => {
    const seeker = makeSeeker('s1', makeUser('u1', { age_band: '18-20' }));
    const party = makeParty('p1', makeUser('u2', { age_band: '30-34' }), {
      strict_age_policy: 1,
      min_age_band: '25-29',
    });
    assert.equal(checkFeasibility(seeker, party).reason, 'below_party_min_age');
  });

  test('enforces a seeker age tolerance', () => {
    const seeker = makeSeeker('s1', makeUser('u1', { age_band: '18-20' }), {
      strict_age_policy: 1,
      age_tolerance: 1,
    });
    const party = makeParty('p1', makeUser('u2', { age_band: '35+' }));
    assert.equal(checkFeasibility(seeker, party).reason, 'age_gap_outside_tolerance');
  });

  test('honours the blocklist in both directions', () => {
    const seeker = makeSeeker('s1', makeUser('u1'));
    const party = makeParty('p1', makeUser('u2'));
    const blocklist = new Set(['u2:u1']);
    assert.equal(checkFeasibility(seeker, party, { blocklist }).reason, 'blocked');
  });
});

describe('Score components', () => {
  test('section: exact match beats adjacent beats distant', () => {
    assert.equal(sectionScore('pit', 'pit'), 1);
    assert.equal(sectionScore('pit', 'ga_standing'), 0.6);
    assert.equal(sectionScore('pit', 'upper_bowl'), 0.2);
  });

  test('vibe: identical vectors score 1, orthogonal score 0', () => {
    const a = { singalong: 5, photography: 0, dancing: 0, quiet: 0, queue_early: 0, merch: 0 };
    const b = { singalong: 5, photography: 0, dancing: 0, quiet: 0, queue_early: 0, merch: 0 };
    const c = { singalong: 0, photography: 5, dancing: 0, quiet: 0, queue_early: 0, merch: 0 };
    assert.ok(Math.abs(vibeScore(a, b) - 1) < 1e-9);
    assert.equal(vibeScore(a, c), 0);
  });

  test('vibe: a zero vector yields 0 rather than NaN', () => {
    const zero = { singalong: 0, photography: 0, dancing: 0, quiet: 0, queue_early: 0, merch: 0 };
    const a = { singalong: 3, photography: 1, dancing: 2, quiet: 0, queue_early: 1, merch: 0 };
    assert.equal(vibeScore(zero, a), 0);
  });

  test('plans: Jaccard, with neutral 0.5 when neither side wants extras', () => {
    assert.equal(plansScore({ pre_meetup: true }, { pre_meetup: true }), 1);
    assert.equal(plansScore({ pre_meetup: true }, { post_supper: true }), 0);
    assert.equal(plansScore({}, {}), 0.5);
    assert.equal(
      plansScore({ pre_meetup: true, merch_run: true }, { pre_meetup: true }),
      0.5,
    );
  });

  test('arrival: adjacent plans score half, opposite ends score zero', () => {
    assert.equal(arrivalScore('early_queue', 'early_queue'), 1);
    assert.equal(arrivalScore('early_queue', 'mid'), 0.5);
    assert.equal(arrivalScore('early_queue', 'doors'), 0);
  });

  test('budget fit rewards a close match', () => {
    assert.equal(budgetFitScore(2, 2), 1);
    assert.ok(budgetFitScore(4, 1) < budgetFitScore(2, 1));
  });
});

describe('Weight vectors', () => {
  test('both sides sum to 1', () => {
    for (const weights of Object.values(WEIGHTS)) {
      const total = Object.values(weights).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(total - 1) < 1e-9);
    }
  });

  test('the party side weights reliability far above the seeker side', () => {
    assert.ok(WEIGHTS.partyToSeeker.reliability > WEIGHTS.seekerToParty.reliability * 2);
  });

  test('the seeker side weights section above the party side', () => {
    assert.ok(WEIGHTS.seekerToParty.section > WEIGHTS.partyToSeeker.section);
  });
});

describe('Directional scoring', () => {
  test('the two directions differ when reliability differs', () => {
    // A flaky seeker and a rock-solid host: the host should rate the seeker lower
    // than the seeker rates the host.
    const seekerUser = makeUser('u1', { reliability: 0.2, verified: 0 });
    const hostUser = makeUser('u2', { reliability: 1.0, verified: 1 });
    const scored = scorePair(makeSeeker('s1', seekerUser), makeParty('p1', hostUser));
    assert.ok(
      scored.seekerToParty > scored.partyToSeeker,
      `expected asymmetry, got ${scored.seekerToParty} vs ${scored.partyToSeeker}`,
    );
  });

  test('scores stay within [0,1]', () => {
    const scored = scorePair(makeSeeker('s1', makeUser('u1')), makeParty('p1', makeUser('u2')));
    for (const value of [scored.seekerToParty, scored.partyToSeeker]) {
      assert.ok(value >= 0 && value <= 1, `score out of range: ${value}`);
    }
  });

  test('a perfectly aligned pair scores near the top', () => {
    const vibe = { singalong: 5, photography: 2, dancing: 5, quiet: 0, queue_early: 4, merch: 3 };
    const seekerUser = makeUser('u1', { vibe, reliability: 1, verified: 1, home_region: 'east' });
    const hostUser = makeUser('u2', { vibe, reliability: 1, verified: 1, home_region: 'east' });
    const plans = { pre_meetup: true, post_supper: true, merch_run: true, transport_share: true };
    const scored = scorePair(
      makeSeeker('s1', seekerUser, {
        section_pref: 'pit',
        arrival_pref: 'early_queue',
        plans_wanted: plans,
        spend_band_max: 2,
      }),
      makeParty('p1', hostUser, {
        section: 'pit',
        arrival_plan: 'early_queue',
        plans,
        spend_band: 2,
      }),
    );
    assert.ok(scored.seekerToParty > 0.95, `expected >0.95, got ${scored.seekerToParty}`);
  });
});

describe('Preference list construction', () => {
  test('orders by score descending and excludes infeasible pairs', () => {
    const seekerUser = makeUser('u1', { spend_band_max: 3 });
    const seeker = makeSeeker('s1', seekerUser, { section_pref: 'pit', spend_band_max: 3 });

    const great = makeParty('p_great', makeUser('u2'), { section: 'pit', spend_band: 2 });
    const okay = makeParty('p_okay', makeUser('u3'), { section: 'upper_bowl', spend_band: 2 });
    const tooPricey = makeParty('p_pricey', makeUser('u4'), { section: 'pit', spend_band: 4 });

    const profile = buildPreferences([seeker], [great, okay, tooPricey]);
    const list = profile.seekerPrefs.get('s1');

    assert.equal(list.length, 2, 'the unaffordable party should be filtered out');
    assert.equal(list[0], 'p_great');
    assert.equal(list[1], 'p_okay');
    assert.equal(profile.stats.rejectionReasons.unaffordable, 1);
  });

  test('rank maps invert the ordering correctly', () => {
    const seeker = makeSeeker('s1', makeUser('u1'));
    const parties = ['a', 'b', 'c'].map((suffix, i) =>
      makeParty(`p_${suffix}`, makeUser(`u${i + 2}`), {
        section: i === 0 ? 'ga_standing' : 'upper_bowl',
      }),
    );
    const profile = buildPreferences([seeker], parties);
    const list = profile.seekerPrefs.get('s1');
    const ranks = profile.seekerRanks.get('s1');
    list.forEach((partyId, index) => assert.equal(ranks.get(partyId), index));
  });

  test('ties break deterministically by id, so runs are reproducible', () => {
    const seeker = makeSeeker('s1', makeUser('u1'));
    // Two identical parties differing only by id.
    const parties = [
      makeParty('p_zebra', makeUser('u2')),
      makeParty('p_alpha', makeUser('u3')),
    ];
    const first = buildPreferences([seeker], parties).seekerPrefs.get('s1');
    const second = buildPreferences([seeker], [...parties].reverse()).seekerPrefs.get('s1');
    assert.deepEqual(first, second);
    assert.equal(first[0], 'p_alpha', 'lower id should win a tie');
  });

  test('only evaluates pairs within the same concert', () => {
    const seeker = makeSeeker('s1', makeUser('u1'), { concert_id: 'c1' });
    const parties = [
      makeParty('p1', makeUser('u2'), { concert_id: 'c1' }),
      makeParty('p2', makeUser('u3'), { concert_id: 'c2' }),
      makeParty('p3', makeUser('u4'), { concert_id: 'c2' }),
    ];
    const profile = buildPreferences([seeker], parties);
    // Concert grouping means the c2 parties are never even scored.
    assert.equal(profile.stats.evaluatedPairs, 1);
    assert.equal(profile.seekerPrefs.get('s1').length, 1);
  });
});
