import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories.js';
import { createMatchingService } from '../src/services/matchingService.js';
import { makeUser, makeParty, makeSeeker } from './helpers.js';

function fixture(managed) {
  const db=createTestDb(), repos=createRepositories(db);
  for (const id of ['host','seeker','outsider']) repos.users.create(makeUser(id));
  repos.concerts.create({id:'c1',artist:'Show',venue:'Hall',city:'Singapore',event_date:'2030-01-01'});
  repos.parties.create(makeParty('p1',makeUser('host'),{capacity:1,name:'The Encore Crew'}));
  repos.parties.setImage('p1','group-photo.png');
  repos.seekers.create(makeSeeker('s1',makeUser('seeker'),{joining_mode:'algorithm'}));
  if (managed) {
    repos.membership.configure('host','p1',{strangerPlaces:1});
    const answers={about:['singalong','supper'],wants:['supper']};
    repos.membership.saveAnswers('host','p1',answers);
    repos.recommendations.savePersonal('seeker','c1',answers);
    repos.membership.publish('host','p1');
  }
  createMatchingService({db,repos}).run('c1',{batchKey:'presentation'});
  return {db,repos};
}

test('automatic result identity is public and match reasons retain the original scoring snapshot', () => {
  const {db,repos}=fixture(true);
  try {
    const offer=repos.proposals.forUser('seeker')[0];
    const history=db.prepare('SELECT * FROM match_results').all();
    const snapshot=JSON.parse(history[0].score_breakdown_json).discovery;
    assert.equal(offer.groupName,'The Encore Crew');
    assert.equal(offer.imageUrl,'/api/avatars/group-photo.png');
    assert.ok(offer.reasons.length>0 && offer.reasons.length<=3);
    assert.deepEqual(offer.reasons,snapshot.reasons);
    assert.equal(offer.confidence,snapshot.confidence);
    repos.recommendations.savePersonal('seeker','c1',{about:['quiet'],wants:['quiet']});
    repos.membership.saveAnswers('host','p1',{about:['quiet'],wants:['quiet']});
    const refreshed=repos.proposals.forUser('seeker')[0];
    assert.deepEqual(refreshed.reasons,offer.reasons);
    assert.equal(refreshed.seekerScore,offer.seekerScore);
    assert.deepEqual(db.prepare('SELECT * FROM match_results').all(),history);
    assert.deepEqual(repos.proposals.forUser('outsider'),[]);
    assert.equal(repos.proposals.forUser('host')[0].role,'host');
    assert.deepEqual(repos.proposals.explain('seeker',offer.id).reasons,offer.reasons);
  } finally {db.close();}
});

test('legacy automatic results expose an empty reason list without inventing preference evidence', () => {
  const {db,repos}=fixture(false);
  try {
    const offer=repos.proposals.forUser('seeker')[0];
    assert.deepEqual(offer.reasons,[]);
    assert.equal(offer.confidence,null);
    assert.equal(offer.groupName,'The Encore Crew');
    assert.equal(offer.status,'proposed');
    assert.equal(offer.hostApproved,false);
    assert.equal(offer.seekerApproved,false);
  } finally {db.close();}
});
