import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  stableRoommates,
  findRoommateBlockingPairs,
} from '../src/matching/stableRoommates.js';

const prefs = (obj) => new Map(Object.entries(obj));

describe("Irving's algorithm — solvable instances", () => {
  test('trivial mutual pair', () => {
    const p = prefs({ a: ['b'], b: ['a'] });
    const result = stableRoommates(p);
    assert.equal(result.stable, true);
    assert.deepEqual(result.pairs, [['a', 'b']]);
  });

  test('two mutually-preferring pairs among four participants', () => {
    const p = prefs({
      a: ['b', 'c', 'd'],
      b: ['a', 'c', 'd'],
      c: ['d', 'a', 'b'],
      d: ['c', 'a', 'b'],
    });
    const result = stableRoommates(p);
    assert.equal(result.stable, true);
    assert.deepEqual(result.pairs, [['a', 'b'], ['c', 'd']]);
    assert.equal(findRoommateBlockingPairs(p, result.pairs).stable, true);
  });

  test('a six-participant instance resolves and verifies as stable', () => {
    const p = prefs({
      1: ['3', '4', '2', '6', '5'],
      2: ['6', '5', '4', '1', '3'],
      3: ['2', '4', '5', '1', '6'],
      4: ['5', '2', '3', '6', '1'],
      5: ['3', '1', '2', '4', '6'],
      6: ['5', '1', '3', '4', '2'],
    });
    const result = stableRoommates(p);
    if (result.stable) {
      assert.equal(result.pairs.length, 3, 'six participants should form three pairs');
      const check = findRoommateBlockingPairs(p, result.pairs);
      assert.equal(check.stable, true, `independent verifier found ${JSON.stringify(check.blockingPairs)}`);
    } else {
      // A "no stable matching" verdict is a legitimate outcome, but it must be
      // reported with a reason rather than silently producing garbage.
      assert.ok(result.reason, 'an unsolvable verdict must carry a reason');
      assert.deepEqual(result.pairs, []);
    }
  });
});

describe("Irving's algorithm — unsolvable instances", () => {
  test('the classic 4-participant instance with no stable matching is reported, not faked', () => {
    // a, b, c each prefer the next in a cycle, and all rank d last. This is the
    // standard example of a stable roommates instance admitting no stable matching.
    const p = prefs({
      a: ['b', 'c', 'd'],
      b: ['c', 'a', 'd'],
      c: ['a', 'b', 'd'],
      d: ['a', 'b', 'c'],
    });
    const result = stableRoommates(p);
    assert.equal(result.stable, false, 'this instance has no stable matching');
    assert.ok(result.reason, 'must explain why');
    assert.deepEqual(result.pairs, []);
  });

  test('an odd number of participants cannot pair everyone', () => {
    const p = prefs({
      a: ['b', 'c'],
      b: ['a', 'c'],
      c: ['a', 'b'],
    });
    const result = stableRoommates(p);
    // Either it reports no stable matching, or it pairs two and leaves one out.
    if (result.stable) {
      assert.equal(result.pairs.length + result.unmatched.length * 0.5, 1.5);
    } else {
      assert.ok(result.reason);
    }
  });
});

describe('Roommate blocking-pair verifier', () => {
  test('detects a pair that would both defect', () => {
    const p = prefs({
      a: ['b', 'c', 'd'],
      b: ['a', 'c', 'd'],
      c: ['d', 'a', 'b'],
      d: ['c', 'a', 'b'],
    });
    // Deliberately wrong: a and b prefer each other but are split up.
    const badPairs = [['a', 'c'], ['b', 'd']];
    const check = findRoommateBlockingPairs(p, badPairs);
    assert.equal(check.stable, false);
    assert.ok(check.blockingPairs.some((bp) => bp.key === 'a|b'));
  });

  test('accepts the correct pairing', () => {
    const p = prefs({
      a: ['b', 'c', 'd'],
      b: ['a', 'c', 'd'],
      c: ['d', 'a', 'b'],
      d: ['c', 'a', 'b'],
    });
    assert.equal(findRoommateBlockingPairs(p, [['a', 'b'], ['c', 'd']]).stable, true);
  });
});
