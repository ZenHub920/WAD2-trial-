/**
 * The quiz, the per-dimension scoring rules, and dealbreaker vetoes.
 *
 * The rules differ on purpose — similarity for energy, both-high for
 * agreeableness, a table for intent — so each is tested on the case that tells
 * it apart from the others, not just on a pair that happens to agree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUIZ_CARDS,
  deriveTraits,
  publicQuiz,
  validateQuiz,
  averageTraits,
} from '../src/services/preferenceQuiz.js';
import { dealbreakerHit, scoreTraits, LOOKING_FIT } from '../src/services/traitScoring.js';
import {
  compareProfiles,
  individualProfile,
  validateAnswers,
  validateDealbreakers,
  DEALBREAKER_LIMIT,
} from '../src/services/discoveryPreferences.js';
import { recommendCompanions } from '../src/services/companionRecommendations.js';

const pick = (card, option) => ({ card, option });

/* ---------------------------------------------------------------- the deck */

test('the deck never leaks what an option implies', () => {
  for (const card of publicQuiz())
    for (const option of card.options)
      assert.deepEqual(Object.keys(option).sort(), ['id', 'text'],
        'a client that can see the effects can be gamed, and so can the person');
});

test('every option contributes something, and only to known dimensions', () => {
  const known = new Set(['looking', 'horizon', 'fandom', 'energy', 'crowd',
    'extraversion', 'agreeableness']);
  for (const card of QUIZ_CARDS)
    for (const option of card.options) {
      const keys = Object.keys(option.effects);
      assert.ok(keys.length, `${card.id}/${option.id} measures nothing`);
      for (const key of keys) assert.ok(known.has(key), `${card.id} sets unknown ${key}`);
    }
});

test('an unknown card or option is refused rather than ignored', () => {
  assert.throws(() => validateQuiz([pick('no_such_card', 'x')]), /unknown_quiz_card/);
  assert.throws(() => validateQuiz([pick('looking', 'no_such_option')]), /unknown_quiz_option/);
  assert.throws(() => validateQuiz('not an array'), /invalid_quiz/);
});

test('skipping the whole deck is allowed', () => {
  assert.deepEqual(validateQuiz([]), []);
  assert.deepEqual(validateQuiz(undefined), []);
});

test('answering one card twice counts once, and answers come back in deck order', () => {
  const stored = validateQuiz([
    pick('after_encore', 'carries_on'),
    pick('looking', 'stand_with'),
    pick('looking', 'friend'),
  ]);
  assert.deepEqual(stored, [pick('looking', 'friend'), pick('after_encore', 'carries_on')],
    'the later answer replaces the earlier one, and order is the deck’s');
});

/* ---------------------------------------------------------- deriving traits */

test('numeric dimensions average across cards, categorical ones are taken outright', () => {
  // "straight for the barricade" sets energy 5; "a few songs" sets fandom 2.
  const traits = deriveTraits(validateQuiz([
    pick('doors_open', 'barricade'),
    pick('artist_means', 'few_songs'),
  ]));
  assert.equal(traits.crowd, 'barricade');
  assert.equal(traits.energy, 5, 'one card mentioned energy, so it stands alone');
  assert.equal(traits.fandom, 3, 'barricade implies 4 and a few songs 2, so the mean is 3');
});

test('a dimension nothing asked about is absent, not defaulted to the middle', () => {
  const traits = deriveTraits(validateQuiz([pick('looking', 'logistics')]));
  assert.equal(traits.looking, 'logistics');
  assert.ok(!('crowd' in traits), 'absent means never asked, which scoring must be able to see');
  assert.ok(!('agreeableness' in traits));
});

test("a group's traits are its members' means, and its intent the most common one", () => {
  const group = averageTraits([
    { energy: 5, looking: 'group' },
    { energy: 3, looking: 'group' },
    { energy: 1, looking: 'friend' },
  ]);
  assert.equal(group.energy, 3);
  assert.equal(group.looking, 'group');
  assert.deepEqual(averageTraits([]), {}, 'nobody answering is not a profile of zeroes');
});

/* --------------------------------------------------- one rule per dimension */

test('with no dimension in common the answer is no opinion, not a zero', () => {
  assert.equal(scoreTraits({ energy: 5 }, { crowd: 'back' }), null);
  assert.equal(scoreTraits({}, {}), null);
  assert.equal(scoreTraits(undefined, { energy: 3 }), null);
});

test('similarity: distance is what matters, in either direction', () => {
  const same = scoreTraits({ energy: 5 }, { energy: 5 }).score;
  const near = scoreTraits({ energy: 5 }, { energy: 4 }).score;
  const far = scoreTraits({ energy: 5 }, { energy: 1 }).score;
  assert.equal(same, 1);
  assert.equal(far, 0, 'opposite ends of the scale is the mismatch this rule exists for');
  assert.ok(near < same && near > far);
  assert.equal(scoreTraits({ energy: 2 }, { energy: 4 }).score,
    scoreTraits({ energy: 4 }, { energy: 2 }).score, 'and it is symmetric');
});

test('similarity does not reward two quiet people less than two loud ones', () => {
  assert.equal(scoreTraits({ energy: 1 }, { energy: 1 }).score,
    scoreTraits({ energy: 5 }, { energy: 5 }).score);
});

test('agreeableness follows the lower of the two, not the distance', () => {
  const bothHigh = scoreTraits({ agreeableness: 5 }, { agreeableness: 5 }).score;
  const bothLow = scoreTraits({ agreeableness: 2 }, { agreeableness: 2 }).score;
  const mixed = scoreTraits({ agreeableness: 5 }, { agreeableness: 2 }).score;
  assert.equal(bothHigh, 1);
  assert.ok(bothLow < bothHigh,
    'two equally difficult people are not compatible for being equal — this is the case that '
    + 'separates this rule from similarity, which would have scored them 1');
  assert.equal(bothLow, mixed, 'the pair is only as accommodating as its least accommodating half');
});

test('crowd position: neighbours compromise, the two ends do not', () => {
  const together = scoreTraits({ crowd: 'middle' }, { crowd: 'middle' }).score;
  const neighbour = scoreTraits({ crowd: 'middle' }, { crowd: 'back' }).score;
  const ends = scoreTraits({ crowd: 'barricade' }, { crowd: 'back' }).score;
  assert.equal(together, 1);
  assert.equal(ends, 0, 'these two would spend the concert apart');
  assert.ok(neighbour > ends && neighbour < together);
});

test('intent is a table, and a symmetric one', () => {
  for (const a of Object.keys(LOOKING_FIT))
    for (const b of Object.keys(LOOKING_FIT))
      assert.equal(LOOKING_FIT[a][b], LOOKING_FIT[b][a], `${a}/${b} must read the same both ways`);
  assert.equal(scoreTraits({ looking: 'friend' }, { looking: 'friend' }).score, 1);
  assert.ok(
    scoreTraits({ looking: 'group' }, { looking: 'stand_with' }).score
    < scoreTraits({ looking: 'group' }, { looking: 'friend' }).score,
    'wanting a crowd sits badly with wanting one quiet companion',
  );
});

test('different horizons are a mild mismatch, not a clash', () => {
  const score = scoreTraits({ horizon: 'one_night' }, { horizon: 'ongoing' }).score;
  assert.ok(score > 0 && score < 1,
    'one good night and hoping for a friend can still share a concert');
});

test('skipped cards cost precision, not score: weights renormalise', () => {
  const partial = scoreTraits({ energy: 4 }, { energy: 4 });
  assert.equal(partial.score, 1, 'answering one card well is not marked down for the others');
  assert.equal(partial.parts.length, 1);
});

test('the dimensions a comparison used are reported, with their rule', () => {
  const result = scoreTraits(
    { looking: 'friend', energy: 4, agreeableness: 5 },
    { looking: 'friend', energy: 4, agreeableness: 5 },
  );
  assert.deepEqual(result.parts.map((p) => p.kind).sort(),
    ['both_high', 'intent', 'similarity']);
  assert.ok(result.reasons.length > 0 && result.reasons.length <= 2,
    'a card says the two strongest things, not everything');
});

/* -------------------------------------------------------------- dealbreakers */

const answers = ({ about = [], wants = [], avoid = [], quiz = [], dealbreakers = [] }) =>
  validateAnswers({
    about: about.map((id) => ({ text: id, conceptId: id })),
    wants: wants.map((id) => ({ text: id, conceptId: id })),
    avoid: avoid.map((id) => ({ text: id, conceptId: id })),
    quiz,
    dealbreakers,
  });

test('a dealbreaker must be something the person also listed under avoid', () => {
  assert.throws(() => answers({ avoid: ['singalong'], dealbreakers: ['dancing'] }),
    /dealbreaker_not_in_avoid/,
    'a veto nobody can see on their own profile is a trap');
  assert.deepEqual(
    answers({ avoid: ['singalong'], dealbreakers: ['singalong'] }).dealbreakers,
    ['singalong'],
  );
});

test('only a few dealbreakers are allowed', () => {
  const four = ['singalong', 'dancing', 'merch_run', 'quiet'];
  assert.equal(DEALBREAKER_LIMIT, 3);
  assert.throws(() => answers({ avoid: four, dealbreakers: four }), /too_many_dealbreakers/);
  assert.deepEqual(validateDealbreakers([], []), []);
});

test('a dealbreaker removes somebody outright, however well they score elsewhere', () => {
  const mine = individualProfile(answers({
    about: ['singalong'], wants: ['singalong'], avoid: ['dancing'], dealbreakers: ['dancing'],
  }));
  // Everything this person offers is what I asked for — except the one thing.
  const theirs = individualProfile(answers({ about: ['singalong', 'dancing'], wants: ['singalong'] }));
  const result = compareProfiles(mine, theirs);
  assert.equal(result.blocked, true);
  assert.equal(result.blockedBy, 'dancing');
  assert.equal(result.score, 0);
  assert.equal(result.seekerScore, 0);
});

test('their dealbreaker blocks the pair too, and says which side it came from', () => {
  const mine = individualProfile(answers({ about: ['dancing'] }));
  const theirs = individualProfile(answers({ avoid: ['dancing'], dealbreakers: ['dancing'] }));
  const result = compareProfiles(mine, theirs);
  assert.equal(result.blocked, true);
  assert.equal(result.blockedBy, null);
  assert.equal(result.blockedByThem, 'dancing');
});

test('avoiding something without vetoing it still only lowers the score', () => {
  const mine = individualProfile(answers({ wants: ['singalong'], avoid: ['dancing'] }));
  const theirs = individualProfile(answers({ about: ['singalong', 'dancing'] }));
  const result = compareProfiles(mine, theirs);
  assert.equal(result.blocked, false);
  assert.ok(result.seekerScore > 0, 'a preference is weighed; only a dealbreaker removes');
});

/* ------------------------------------------- not changing what came before */

test('without a quiz on both sides the comparison is exactly what it always was', () => {
  const plain = individualProfile(answers({ about: ['singalong'], wants: ['dancing'] }));
  const other = individualProfile(answers({ about: ['dancing'], wants: ['singalong'] }));
  const baseline = compareProfiles(plain, other);

  const withQuiz = individualProfile(answers({
    about: ['singalong'], wants: ['dancing'], quiz: [pick('looking', 'friend')],
  }));
  const oneSided = compareProfiles(withQuiz, other);

  assert.equal(oneSided.score, baseline.score,
    'one person answering the deck must not move a score the other cannot answer');
  assert.equal(oneSided.traits, null);
  assert.deepEqual(oneSided.traitReasons, []);
});

test('a quiz on both sides moves the score and reports how', () => {
  const near = [pick('looking', 'friend'), pick('doors_open', 'middle')];
  const far = [pick('looking', 'logistics'), pick('doors_open', 'barricade')];
  const base = { about: ['singalong'], wants: ['singalong'] };
  const me = individualProfile(answers({ ...base, quiz: near }));
  const alike = individualProfile(answers({ ...base, quiz: near }));
  const unlike = individualProfile(answers({ ...base, quiz: far }));

  assert.ok(compareProfiles(me, alike).score > compareProfiles(me, unlike).score);
  assert.equal(compareProfiles(me, alike).traits.score, 1);
  assert.ok(compareProfiles(me, alike).traitReasons.length > 0);
});

/* ------------------------------------------------- and in the companion deck */

const person = (id) => ({
  id: `c1:${id}`,
  concertId: 'c1',
  artist: 'A',
  eventDate: '2027-05-01',
  sectionPref: 'ga_standing',
  user: { id, displayName: id, ageBand: '21-24' },
});

test('a vetoed person never reaches the deck, and is reported rather than vanishing', () => {
  const stored = {
    me: JSON.stringify(answers({
      about: ['singalong'], wants: ['singalong'], avoid: ['dancing'], dealbreakers: ['dancing'],
    })),
    dancer: JSON.stringify(answers({ about: ['singalong', 'dancing'], wants: ['singalong'] })),
    fine: JSON.stringify(answers({ about: ['singalong'], wants: ['singalong'] })),
  };
  const result = recommendCompanions(
    [person('dancer'), person('fine')], 'me', (id) => stored[id] ?? null,
  );

  assert.deepEqual(result.people.map((p) => p.user.id), ['fine']);
  assert.deepEqual(result.vetoed, [{ id: 'c1:dancer', userId: 'dancer', dealbreaker: 'dancing' }]);
  assert.notEqual(result.stablePartnerId, 'dancer',
    'the solver must not be able to pair me with somebody I ruled out');
});

test('quiz answers alone are enough to rank a deck', () => {
  const stored = {
    me: JSON.stringify(answers({ quiz: [pick('looking', 'friend'), pick('doors_open', 'middle')] })),
    close: JSON.stringify(answers({ quiz: [pick('looking', 'friend'), pick('doors_open', 'middle')] })),
    distant: JSON.stringify(answers({ quiz: [pick('looking', 'logistics'), pick('doors_open', 'barricade')] })),
  };
  const result = recommendCompanions(
    [person('distant'), person('close')], 'me', (id) => stored[id] ?? null,
  );
  assert.equal(result.ranked, true);
  assert.equal(result.people[0].user.id, 'close',
    'tapping through the deck is answering the questionnaire');
});
