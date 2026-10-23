/**
 * The companion deck: filters narrow, the solver orders what is left, and
 * nothing is ordered at all until the viewer has answered the questionnaire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendCompanions } from '../src/services/companionRecommendations.js';

const person = (id, { artist = 'A', section = 'ga_standing', band = '21-24' } = {}) => ({
  id: `c1:${id}`,
  concertId: 'c1',
  artist,
  eventDate: '2027-05-01',
  sectionPref: section,
  user: { id, displayName: id, ageBand: band },
});

const answers = (about = [], wants = [], avoid = []) => JSON.stringify({
  about: about.map((key) => ({ key })),
  wants: wants.map((key) => ({ key })),
  avoid: avoid.map((key) => ({ key })),
});

test('without a questionnaire nothing is ranked and the pool is returned as-is', () => {
  const pool = [person('a'), person('b')];
  const result = recommendCompanions(pool, 'me', () => null);
  assert.equal(result.ranked, false);
  assert.equal(result.reason, 'questionnaire_not_answered');
  assert.equal(result.stablePartnerId, null);
  assert.deepEqual(result.people.map((p) => p.user.id), ['a', 'b'],
    'order is untouched, so the finder can fall back to plain filtering');
  assert.ok(!('compatibility' in result.people[0]), 'no score is invented');
});

test('answers put the best fit first and explain why', () => {
  const sought = 'supper_after';
  const pool = [
    person('mismatch'),
    person('match'),
  ];
  const stored = {
    me: answers(['sing_along'], [sought]),
    match: answers([sought], ['sing_along']),
    mismatch: answers(['quiet_listening'], ['quiet_listening']),
  };
  const result = recommendCompanions(pool, 'me', (id) => stored[id] ?? null);

  assert.equal(result.ranked, true);
  assert.equal(result.people[0].user.id, 'match', 'the person who wants what I offer leads');
  assert.ok(result.people[0].fitForYou > result.people[1].fitForYou,
    `${result.people[0].fitForYou} should beat ${result.people[1].fitForYou}`);
  assert.ok(result.people[0].reasons.length > 0, 'the card can say why');
  assert.equal(result.solver.id, 'stable-roommates',
    'one pool is not bipartite, so the registry picks Irving, not Gale-Shapley');
});

test('somebody who never answered still appears, at a neutral score', () => {
  const stored = { me: answers(['sing_along'], ['supper_after']) };
  const result = recommendCompanions([person('silent')], 'me', (id) => stored[id] ?? null);
  assert.equal(result.ranked, true);
  assert.equal(result.people.length, 1, 'not answering is not a reason to be hidden');
  assert.equal(typeof result.people[0].fitForYou, 'number');
});

test('the order is stable between identical requests', () => {
  const stored = {
    me: answers(['sing_along'], ['supper_after']),
    x: answers(['supper_after'], ['sing_along']),
    y: answers(['supper_after'], ['sing_along']),
    z: answers(['supper_after'], ['sing_along']),
  };
  const pool = [person('z'), person('y'), person('x')];
  const once = recommendCompanions(pool, 'me', (id) => stored[id] ?? null);
  const twice = recommendCompanions([...pool].reverse(), 'me', (id) => stored[id] ?? null);
  assert.deepEqual(
    once.people.map((p) => p.user.id),
    twice.people.map((p) => p.user.id),
    'a deck that reshuffles on reload is unusable',
  );
});

test('a stable partner, when one exists, leads the deck', () => {
  // Four participants, so a perfect pairing is possible at all. `twin` wants
  // what I offer and offers what I want; the other two suit each other.
  const stored = {
    me: answers(['sing_along'], ['supper_after']),
    twin: answers(['supper_after'], ['sing_along']),
    quietA: answers(['quiet_listening'], ['quiet_listening']),
    quietB: answers(['quiet_listening'], ['quiet_listening']),
  };
  const pool = [person('quietA'), person('quietB'), person('twin')];
  const result = recommendCompanions(pool, 'me', (id) => stored[id] ?? null);
  assert.equal(result.stable, true);
  assert.equal(result.stablePartnerId, 'twin');
  assert.equal(result.people[0].user.id, 'twin');
  assert.equal(result.people[0].stableMatch, true);
  assert.equal(result.people.slice(1).every((p) => !p.stableMatch), true);
});

test('an odd pool still ranks, it just has no pairing to lead with', () => {
  // Stable Roommates asks every participant to be paired, which an odd number
  // cannot be — so Irving's correctly reports that no stable matching exists.
  // A deck only needs an ORDER, so that is a missing bonus, not a failure.
  const stored = {
    me: answers(['sing_along'], ['supper_after']),
    good: answers(['supper_after'], ['sing_along']),
    poor: answers(['quiet_listening'], ['quiet_listening']),
  };
  const result = recommendCompanions([person('poor'), person('good')], 'me', (id) => stored[id] ?? null);
  assert.equal(result.ranked, true);
  assert.equal(result.stable, false, 'three people cannot all be paired');
  assert.equal(result.stablePartnerId, null);
  assert.equal(result.people[0].user.id, 'good', 'the ranking still holds');
  assert.equal(result.people.every((p) => !p.stableMatch), true);
});

test('an empty pool and a pool of one are answers, not errors', () => {
  const stored = { me: answers(['sing_along'], ['supper_after']) };
  const empty = recommendCompanions([], 'me', (id) => stored[id] ?? null);
  assert.deepEqual(empty.people, []);
  assert.equal(empty.stablePartnerId, null);

  const one = recommendCompanions([person('solo')], 'me', (id) => stored[id] ?? null);
  assert.equal(one.people.length, 1);
});
