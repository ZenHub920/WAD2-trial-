import assert from 'node:assert/strict';
import test from 'node:test';
import { createComparison, preferComparisonGroup, refreshComparisonGroups, skipComparisonGroup } from '../src/utils/groupComparison.js';

const groups = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id }));

test('comparison snapshots inputs and excludes missing or duplicate group identities', () => {
  const state = createComparison([groups[0], null, { id: 'a' }, { name: 'missing id' }, groups[1]]);
  assert.deepEqual(state.slots.map(group => group.id), ['a', 'b']);
  assert.equal(state.groups.length, 2);
  assert.notEqual(state.groups, groups);
  assert.notEqual(state.groups[0], groups[0]);
});

test('choosing either position keeps that card in place and replaces only its opponent', () => {
  let state = createComparison(groups);
  state = preferComparisonGroup(state, 1);
  assert.deepEqual(state.slots.map(group => group.id), ['c', 'b']);
  assert.equal(state.favoriteId, 'b');
  state = preferComparisonGroup(state, 0);
  assert.deepEqual(state.slots.map(group => group.id), ['c', 'd']);
  assert.equal(state.favoriteId, 'c');
  assert.deepEqual(state.skippedIds, ['a', 'b']);
});

test('last comparison retains its winner after every other candidate is exhausted', () => {
  let state = createComparison(groups);
  for (let i = 0; i < 3; i++) state = preferComparisonGroup(state, 0);
  assert.equal(state.slots[0].id, 'a');
  assert.equal(state.slots[1], null);
  assert.equal(state.nextIndex, 4);
  assert.deepEqual(state.skippedIds, ['b', 'c', 'd']);
  assert.equal(preferComparisonGroup(state, 1), state);
});

test('skipping a local favorite removes its badge without affecting the other card', () => {
  const favored = preferComparisonGroup(createComparison(groups), 1);
  const skipped = skipComparisonGroup(favored, 1);
  assert.deepEqual(skipped.slots.map(group => group.id), ['c', 'd']);
  assert.equal(skipped.favoriteId, null);
  assert.deepEqual(favored.slots.map(group => group.id), ['c', 'b']);
});

test('empty, single and exhausted sessions remain valid and can be restarted', () => {
  assert.deepEqual(createComparison([]).slots, [null, null]);
  const single = createComparison([groups[0]]);
  assert.deepEqual(preferComparisonGroup(single, 0).slots, [single.groups[0], null]);
  const exhausted = skipComparisonGroup(single, 0);
  assert.deepEqual(exhausted.slots, [null, null]);
  assert.deepEqual(createComparison(exhausted.groups).slots.map(group => group?.id ?? null), ['a', null]);
});

test('refreshes card details without reviving skipped cards, adding new IDs or reordering comparisons', () => {
  const state = preferComparisonGroup(createComparison(groups), 0);
  const refreshed = refreshComparisonGroups(state, [{ id: 'c', remainingCapacity: 0, canJoinQueue: true }, { id: 'a', name: 'Updated group' }, groups[1], groups[3], { id: 'new' }]);
  assert.deepEqual(refreshed.slots.map(group => group.id), ['a', 'c']);
  assert.equal(refreshed.slots[0].name, 'Updated group');
  assert.equal(refreshed.slots[1].remainingCapacity, 0);
  assert.equal(refreshed.favoriteId, 'a');
  assert.deepEqual(refreshed.skippedIds, ['b']);
  assert.equal(refreshed.groups.length, 4);
  assert.equal(refreshed.nextIndex, 3);
});

test('refresh removes newly unavailable groups and refills their position without reviving a skip', () => {
  const state = preferComparisonGroup(createComparison(groups), 0);
  const refreshed = refreshComparisonGroups(state, [groups[1], groups[2], groups[3]]);
  assert.deepEqual(refreshed.slots.map(group => group.id), ['d', 'c']);
  assert.equal(refreshed.favoriteId, null);
  assert.deepEqual(refreshed.skippedIds, ['b']);
  assert.equal(refreshed.nextIndex, 3);
});
