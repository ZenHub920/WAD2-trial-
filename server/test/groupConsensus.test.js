import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories.js';
import { createKakiController } from '../src/controllers/kakiController.js';
import { createMatchingService } from '../src/services/matchingService.js';
import { aggregateAnswers, compareProfiles, validateAnswers } from '../src/services/discoveryPreferences.js';
import { makeParty, makeSeeker, makeUser } from './helpers.js';

test('consensus uses the existing questionnaire fields without adding importance fields', () => {
  const answers = validateAnswers({ about: ['supper'], wants: ['quiet'], avoid: ['dancing'], dealbreakers: ['dancing'] });
  assert.deepEqual(Object.keys(answers).sort(), ['about', 'avoid', 'dealbreakers', 'quiz', 'wants']);
  assert.equal(aggregateAnswers([answers]).wants.quiet, 1);
});

test('unanswered active members stay in every concept denominator and prevent invented consensus', () => {
  const answers = validateAnswers({ about: ['supper'], wants: ['quiet'], avoid: ['dancing'] });
  const profile = aggregateAnswers([answers], { memberCount: 3 });
  assert.equal(profile.about.post_supper, 1 / 3);
  assert.equal(profile.wants.quiet, 1 / 3);
  assert.equal(profile.avoid.dancing, 1 / 3);
  assert.deepEqual(profile.coverage, { answered: 1, total: 3, ratio: 1 / 3, complete: false });
  assert.deepEqual(profile.representativeWants, []);
  assert.deepEqual(aggregateAnswers([]).representativeWants, []);
  assert.equal(aggregateAnswers([]).coverage.complete, false);
});

test('representative wants require a strict majority and deterministic ties produce at most three', () => {
  const all = validateAnswers({ wants: ['supper', 'quiet', 'dancing', 'merch'] });
  const profile = aggregateAnswers([all, all, all], { memberCount: 4 });
  assert.deepEqual(profile.representativeWants.map((w) => w.key), ['dancing', 'merch_run', 'post_supper']);
  assert.ok(profile.representativeWants.every((w) => w.support === 0.75 && w.weight === 0.75));
  const half = aggregateAnswers([all, all], { memberCount: 4 });
  assert.deepEqual(half.representativeWants, [], 'an exact half is not a group majority');
  assert.deepEqual(aggregateAnswers([all, all, all].reverse(), { memberCount: 4 }), profile);
});

test('historical saved keys and custom answers remain readable without inflating duplicate votes', () => {
  const old = {
    about: [{ key: 'custom:swap friendship bracelets', text: 'Swap friendship bracelets' }],
    wants: [{ key: 'historic_option', text: 'An older choice' }, { key: 'historic_option', text: 'Duplicate' },
      { key: 'hydration_breaks', text: 'Retired choice' }],
    avoid: [],
  };
  const profile = aggregateAnswers([old], { memberCount: 2 });
  assert.equal(profile.wants.historic_option, 0.5);
  assert.equal(profile.wants.hydration_breaks, undefined);
  assert.equal(profile.about['custom:swap friendship bracelets'], 0.5);
  assert.deepEqual(profile.representativeWants, []);
  assert.deepEqual(old.wants.map((w) => w.key), ['historic_option', 'historic_option', 'hydration_breaks'], 'reads do not rewrite stored answers');
});

test('one member hard veto still rejects a match even without majority support', () => {
  const member = validateAnswers({ avoid: ['dancing'], dealbreakers: ['dancing'] });
  const group = aggregateAnswers([member, validateAnswers({ about: ['quiet'] })], { memberCount: 4 });
  const seeker = aggregateAnswers([validateAnswers({ about: ['dancing'] })]);
  assert.deepEqual(group.dealbreakers, ['dancing']);
  assert.equal(compareProfiles(group, seeker).blocked, true);
  assert.equal(compareProfiles(group, seeker).score, 0);
});

function fixture() {
  const db = createTestDb();
  const repos = createRepositories(db);
  for (const id of ['host', 'friend']) repos.users.create(makeUser(id));
  repos.concerts.create({ id: 'c1', artist: 'Act', venue: 'Venue', city: 'Singapore', event_date: '2030-01-01' });
  repos.parties.create(makeParty('p1', makeUser('host'), { capacity: 2 }));
  return { db, repos };
}

test('group consensus follows active membership and account edits without exposing members answer sheets', () => {
  const { db, repos } = fixture();
  try {
    repos.membership.savePreferences('host', { about: ['singalong'], wants: ['supper'] });
    repos.membership.configure('host', 'p1', { expectedFriends: 1 });
    const invite = repos.membership.invite('host', 'p1');
    repos.membership.acceptInvite('friend', invite.token);
    const incomplete = repos.membership.profile('p1');
    assert.deepEqual(incomplete.coverage, { answered: 1, total: 2, ratio: 0.5, complete: false });
    assert.equal(incomplete.wants.post_supper, 0.5);
    assert.deepEqual(incomplete.representativeWants, []);
    const version = repos.membership.settings('p1').version;
    repos.membership.savePreferences('friend', { about: ['quiet'], wants: ['late-night makan'] });
    assert.equal(repos.membership.settings('p1').version, version + 1);
    const detail = repos.membership.detail('host', 'p1');
    assert.deepEqual(Object.keys(detail.profile).sort(), ['coverage', 'representativeWants']);
    assert.equal(detail.profile.coverage.complete, true);
    assert.equal(detail.profile.representativeWants[0].key, 'post_supper');
    assert.equal(detail.profile.representativeWants[0].support, 1);
    assert.deepEqual(detail.myAnswers.about.map((a) => a.key), ['singalong']);
    assert.ok(detail.members.every((m) => !Object.hasOwn(m, 'answers') && !Object.hasOwn(m, 'quiz')));
    repos.membership.leave('friend', 'p1');
    assert.deepEqual(repos.membership.profile('p1').coverage, { answered: 1, total: 1, ratio: 1, complete: true });
    assert.deepEqual(repos.membership.profile('p1').about, { singalong: 1 });
  } finally { db.close(); }
});

test('public Kaki recommendations retain veto filtering and redact the other persons dealbreaker key', () => {
  const stored = {
    me: validateAnswers({ about: ['dancing'] }),
    other: validateAnswers({ avoid: ['dancing'], dealbreakers: ['dancing'] }),
  };
  const controller = createKakiController({
    kaki: { pool: () => ({ people: [{ id: 'c1:other', user: makeUser('other') }] }) },
    users: { groupAnswers: (id) => JSON.stringify(stored[id]) },
  });
  let response;
  controller.recommendations({ user: { id: 'me' }, query: {} }, { json: (result) => { response = result; } });
  assert.deepEqual(response.people, []);
  assert.deepEqual(response.vetoed, [{ id: 'c1:other', userId: 'other', reason: 'preferences_incompatible' }]);
  assert.equal(JSON.stringify(response).includes('dancing'), false);
});

test('direct discovery, automatic GS rankings and group connections all follow member preferences rather than only hosts', () => {
  const db = createTestDb();
  try {
    const repos = createRepositories(db);
    const matching = createMatchingService({ db, repos });
    for (const id of ['source', 'hostA', 'hostB', 'friendA', 'friendB', 'seeker']) repos.users.create(makeUser(id));
    repos.concerts.create({ id: 'c1', artist: 'Act', venue: 'Venue', city: 'Singapore', event_date: '2030-01-01' });
    for (const [host, party, friend] of [['source', 'sourceGroup'], ['hostA', 'groupA', 'friendA'], ['hostB', 'groupB', 'friendB']]) {
      repos.parties.create(makeParty(party, makeUser(host), { capacity: 1 }));
      repos.membership.savePreferences(host, { about: [host === 'source' ? 'singalong' : 'quiet'], wants: [host === 'source' ? 'singalong' : 'quiet'] });
      repos.membership.configure(host, party, { expectedFriends: friend ? 1 : 0 });
      if (friend) {
        repos.membership.savePreferences(friend, { about: [friend === 'friendA' ? 'singalong' : 'quiet'], wants: [friend === 'friendA' ? 'singalong' : 'quiet'] });
        repos.membership.acceptInvite(friend, repos.membership.invite(host, party).token);
      }
      repos.membership.publish(host, party, { connectOpen: true });
    }
    repos.seekers.create(makeSeeker('seekerRequest', makeUser('seeker')));
    repos.recommendations.savePersonal('seeker', 'c1', { about: ['singalong'], wants: ['singalong'] });
    const order = (cards) => cards.filter((card) => ['groupA', 'groupB'].includes(card.id)).map((card) => card.id);
    const expectOrder = (expected) => {
      assert.deepEqual(order(repos.recommendations.individual('seeker', 'c1')), expected);
      assert.deepEqual(order(repos.recommendations.groups('source', 'c1', 'sourceGroup')), expected);
      const profile = matching.preview('c1').profile;
      assert.deepEqual(profile.seekerPrefs.get('seekerRequest').filter((id) => ['groupA', 'groupB'].includes(id)), expected);
      const scored = profile.pairScores.get(`seekerRequest|${expected[0]}`);
      assert.equal(scored.discovery.groupScore, compareProfiles(
        repos.recommendations.personal('seeker', 'c1'), repos.membership.profile(expected[0]),
      ).groupScore, 'automatic preference lists consume the same whole-group profile');
    };
    expectOrder(['groupA', 'groupB']);
    repos.membership.savePreferences('friendA', { about: ['quiet'], wants: ['quiet'] });
    repos.membership.savePreferences('friendB', { about: ['singalong'], wants: ['singalong'] });
    expectOrder(['groupB', 'groupA']);
  } finally { db.close(); }
});
