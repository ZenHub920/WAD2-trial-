import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories.js';
import { makeUser, makeParty, makeSeeker } from './helpers.js';
import { recommendCompanions } from '../src/services/companionRecommendations.js';

test('the receiving person can veto a Kaki recommendation, even when the viewer likes them', () => {
  const stored = {
    me: { about: [{ key: 'singalong' }], wants: [], avoid: [] },
    them: { about: [], wants: [], avoid: [{ key: 'singalong' }], dealbreakers: ['singalong'] },
  };
  const result = recommendCompanions([{ id: 'c:them', user: { id: 'them' } }], 'me', (id) => JSON.stringify(stored[id]));
  assert.equal(result.people.length, 0);
  assert.equal(result.stablePartnerId, null);
});

test('group vetoes exclude discovery, direct requests, and automatic feasibility, rather than only reducing score', () => {
  const db = createTestDb();
  try {
    const repos = createRepositories(db);
    for (const id of ['h', 's']) repos.users.create(makeUser(id));
    repos.concerts.create({ id: 'c1', artist: 'Artist', venue: 'Hall', city: 'Singapore', event_date: '2030-01-01' });
    repos.parties.create(makeParty('p', makeUser('h')));
    repos.seekers.create(makeSeeker('s1', makeUser('s')));
    repos.membership.configure('h', 'p');
    repos.membership.savePreferences('h', { about: [], wants: [], avoid: ['singalong'], dealbreakers: ['singalong'] });
    repos.membership.publish('h', 'p');
    repos.recommendations.savePersonal('s', 'c1', { about: ['singalong'], wants: [], avoid: [] });
    repos.recommendations.setJoiningMode('s', 'c1', 'direct');
    assert.equal(repos.recommendations.feasible('s', repos.parties.findById('p')), false);
    assert.deepEqual(repos.recommendations.individual('s', 'c1'), []);
    assert.throws(() => repos.recommendations.requestJoin('s', 'p'), /group_unavailable/);
    assert.equal(repos.recommendations.pairScore(repos.groups.seeker('s', 'c1'), repos.parties.findById('p')).seekerToParty, 0);
  } finally { db.close(); }
});

test('a later preference change is rechecked when a group invitation is accepted', () => {
  const db = createTestDb();
  try {
    const repos = createRepositories(db);
    for (const id of ['a', 'b']) repos.users.create(makeUser(id));
    repos.concerts.create({ id: 'c1', artist: 'Artist', venue: 'Hall', city: 'Singapore', event_date: '2030-01-01' });
    for (const id of ['a', 'b']) {
      repos.parties.create(makeParty(`p${id}`, makeUser(id)));
      repos.membership.configure(id, `p${id}`);
      repos.membership.savePreferences(id, { about: ['supper'], wants: [], avoid: [] });
      repos.membership.publish(id, `p${id}`, { connectOpen: true });
    }
    const invitation = repos.groups.invite('a', 'pa', 'pb');
    assert.equal(invitation.status, 'pending');
    repos.membership.savePreferences('a', { about: ['singalong'], wants: [], avoid: [] });
    repos.membership.savePreferences('b', { about: [], wants: [], avoid: ['singalong'], dealbreakers: ['singalong'] });
    assert.equal(repos.groups.respond('b', invitation.id, 'accept').error, 'incompatible_group_preferences');
  } finally { db.close(); }
});
