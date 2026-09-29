import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { galeShapley } from '../src/matching/galeShapley.js';
import { findBlockingPairs } from '../src/matching/stability.js';
import { greedyMatch, randomMatch } from '../src/matching/baselines.js';
import { MaxHeap } from '../src/matching/maxHeap.js';
import { makeProfile, allStableMatchings } from './helpers.js';

describe('MaxHeap', () => {
  test('peek returns the worst (largest) rank', () => {
    const heap = new MaxHeap();
    heap.push('a', 5);
    heap.push('b', 2);
    heap.push('c', 9);
    heap.push('d', 7);
    assert.equal(heap.peek().id, 'c');
    assert.equal(heap.peek().rank, 9);
  });

  test('pop removes in descending rank order', () => {
    const heap = new MaxHeap();
    [['a', 3], ['b', 1], ['c', 4], ['d', 1], ['e', 5]].forEach(([id, r]) => heap.push(id, r));
    const order = [];
    while (heap.size > 0) order.push(heap.pop().rank);
    assert.deepEqual(order, [5, 4, 3, 1, 1]);
  });

  test('sortedIds returns best rank first', () => {
    const heap = new MaxHeap();
    heap.push('x', 4);
    heap.push('y', 0);
    heap.push('z', 2);
    assert.deepEqual(heap.sortedIds(), ['y', 'z', 'x']);
  });
});

describe('Gale-Shapley — unit capacity (classic stable marriage)', () => {
  // Textbook instance. Seeker-proposing deferred acceptance is known to yield the
  // seeker-optimal stable matching; worked by hand below.
  //
  //   s1: p1 p2 p3      p1: s2 s1 s3
  //   s2: p1 p3 p2      p2: s1 s3 s2
  //   s3: p2 p1 p3      p3: s3 s1 s2
  //
  // s1 -> p1 (accepted). s2 -> p1, p1 prefers s2, evicts s1. s1 -> p2 (accepted).
  // s3 -> p2, p2 prefers s1 (rank 0) over s3 (rank 1), rejected. s3 -> p1, p1
  // prefers s2 (rank 0) over s3 (rank 2), rejected. s3 -> p3 (accepted).
  const profile = makeProfile(
    {
      s1: ['p1', 'p2', 'p3'],
      s2: ['p1', 'p3', 'p2'],
      s3: ['p2', 'p1', 'p3'],
    },
    {
      p1: ['s2', 's1', 's3'],
      p2: ['s1', 's3', 's2'],
      p3: ['s3', 's1', 's2'],
    },
  );

  test('produces the hand-computed matching', () => {
    const { assignments } = galeShapley(profile);
    assert.equal(assignments.get('s1'), 'p2');
    assert.equal(assignments.get('s2'), 'p1');
    assert.equal(assignments.get('s3'), 'p3');
  });

  test('result is stable', () => {
    const result = galeShapley(profile);
    const { stable, blockingPairs } = findBlockingPairs(profile, result);
    assert.equal(blockingPairs.length, 0);
    assert.equal(stable, true);
  });

  test('every seeker is matched when lists are complete and sides are balanced', () => {
    const result = galeShapley(profile);
    assert.equal(result.unmatchedSeekers.length, 0);
  });
});

describe('Gale-Shapley — seeker optimality against brute force', () => {
  // A deliberately conflicted instance with more than one stable matching.
  const profile = makeProfile(
    {
      s1: ['p1', 'p2', 'p3'],
      s2: ['p2', 'p3', 'p1'],
      s3: ['p3', 'p1', 'p2'],
    },
    {
      p1: ['s2', 's3', 's1'],
      p2: ['s3', 's1', 's2'],
      p3: ['s1', 's2', 's3'],
    },
  );

  test('brute force finds more than one stable matching', () => {
    const stable = allStableMatchings(profile);
    assert.ok(stable.length >= 2, `expected multiple stable matchings, got ${stable.length}`);
  });

  test('Gale-Shapley result is among the stable matchings', () => {
    const result = galeShapley(profile);
    const stable = allStableMatchings(profile);
    const found = stable.some((m) =>
      [...result.assignments].every(([s, p]) => m.get(s) === p) &&
      m.size === result.assignments.size,
    );
    assert.ok(found, 'GS output was not in the brute-forced set of stable matchings');
  });

  test('Gale-Shapley gives every seeker their best stable partner', () => {
    const result = galeShapley(profile);
    const stable = allStableMatchings(profile);

    for (const [seekerId, assignedParty] of result.assignments) {
      const gsRank = profile.seekerRanks.get(seekerId).get(assignedParty);
      for (const matching of stable) {
        const other = matching.get(seekerId);
        if (other === undefined) continue;
        const otherRank = profile.seekerRanks.get(seekerId).get(other);
        assert.ok(
          gsRank <= otherRank,
          `${seekerId}: GS gave rank ${gsRank}, but a stable matching offered ${otherRank}`,
        );
      }
    }
  });
});

describe('Gale-Shapley — Hospital/Residents with capacity > 1', () => {
  const profile = makeProfile(
    {
      s1: ['p1', 'p2'],
      s2: ['p1', 'p2'],
      s3: ['p1', 'p2'],
      s4: ['p2', 'p1'],
    },
    {
      p1: ['s3', 's1', 's2', 's4'],
      p2: ['s1', 's4', 's2', 's3'],
    },
    { p1: 2, p2: 2 },
  );

  test('respects capacity', () => {
    const result = galeShapley(profile);
    for (const [partyId, members] of result.partyMembers) {
      assert.ok(
        members.length <= profile.capacities.get(partyId),
        `${partyId} over capacity: ${members.length}`,
      );
    }
  });

  test('fills both parties and matches everyone', () => {
    const result = galeShapley(profile);
    assert.equal(result.assignments.size, 4);
    assert.equal(result.partyMembers.get('p1').length, 2);
    assert.equal(result.partyMembers.get('p2').length, 2);
  });

  test('result is stable', () => {
    const result = galeShapley(profile);
    assert.equal(findBlockingPairs(profile, result).blockingPairs.length, 0);
  });

  test('p1 keeps its two most preferred applicants', () => {
    const result = galeShapley(profile);
    // All of s1..s3 rank p1 first, so p1 can take its top two: s3 then s1.
    assert.deepEqual(result.partyMembers.get('p1'), ['s3', 's1']);
  });
});

describe('Gale-Shapley — incomplete lists', () => {
  const profile = makeProfile(
    {
      s1: ['p1'],
      s2: ['p1'],
      s3: [],           // finds nobody acceptable
    },
    {
      p1: ['s1', 's2'],
      p2: [],           // acceptable to nobody
    },
  );

  test('leaves seekers unmatched rather than forcing an unacceptable pair', () => {
    const result = galeShapley(profile);
    assert.equal(result.assignments.get('s1'), 'p1');
    assert.ok(!result.assignments.has('s2'));
    assert.ok(!result.assignments.has('s3'));
    assert.deepEqual(result.unmatchedSeekers, ['s2', 's3']);
  });

  test('is still stable — an unmatched seeker with no acceptable party blocks nothing', () => {
    const result = galeShapley(profile);
    assert.equal(findBlockingPairs(profile, result).stable, true);
  });

  test('never assigns a party absent from the seeker list', () => {
    const result = galeShapley(profile);
    for (const [seekerId, partyId] of result.assignments) {
      assert.ok(
        profile.seekerPrefs.get(seekerId).includes(partyId),
        `${seekerId} was assigned ${partyId}, which is not on its list`,
      );
    }
  });
});

describe('Stability verification detects genuine blocking pairs', () => {
  const profile = makeProfile(
    {
      s1: ['p1', 'p2'],
      s2: ['p1', 'p2'],
    },
    {
      p1: ['s1', 's2'],
      p2: ['s1', 's2'],
    },
  );

  test('flags a deliberately swapped (unstable) matching', () => {
    // Both seekers prefer p1; p1 prefers s1. Assigning s2->p1 and s1->p2 means
    // s1 and p1 both prefer each other: a textbook blocking pair.
    const broken = {
      assignments: new Map([['s1', 'p2'], ['s2', 'p1']]),
      partyMembers: new Map([['p1', ['s2']], ['p2', ['s1']]]),
    };
    const { stable, blockingPairs } = findBlockingPairs(profile, broken);
    assert.equal(stable, false);
    assert.equal(blockingPairs.length, 1);
    assert.equal(blockingPairs[0].seekerId, 's1');
    assert.equal(blockingPairs[0].partyId, 'p1');
  });

  test('accepts the correct matching', () => {
    const good = {
      assignments: new Map([['s1', 'p1'], ['s2', 'p2']]),
      partyMembers: new Map([['p1', ['s1']], ['p2', ['s2']]]),
    };
    assert.equal(findBlockingPairs(profile, good).stable, true);
  });

  test('an unmatched seeker facing a party with spare capacity is a blocking pair', () => {
    const underfilled = {
      assignments: new Map([['s1', 'p1']]),
      partyMembers: new Map([['p1', ['s1']], ['p2', []]]),
    };
    const { stable, blockingPairs } = findBlockingPairs(profile, underfilled);
    assert.equal(stable, false);

    // s2 would rather have p2 than nothing, and p2 has a free slot: a blocking pair.
    assert.ok(
      blockingPairs.some((bp) => bp.seekerId === 's2' && bp.partyId === 'p2'),
      'expected (s2, p2) to block',
    );

    // But (s2, p1) must NOT block: p1 is full and holds s1, whom it ranks above s2.
    // Leaving a seeker unmatched is only a defect when some party would actually take them.
    assert.ok(
      !blockingPairs.some((bp) => bp.seekerId === 's2' && bp.partyId === 'p1'),
      '(s2, p1) should not block — p1 prefers the seeker it already holds',
    );
  });
});

describe('Baselines behave as the evaluation expects', () => {
  // Constructed so that greedy's myopic choice creates a blocking pair.
  //
  // Seeker order and party order disagree, and greedy takes the single highest
  // combined-score pair first, which locks out a mutually preferred pairing.
  const profile = makeProfile(
    {
      s1: ['p1', 'p2'],
      s2: ['p1', 'p2'],
      s3: ['p2', 'p1'],
    },
    {
      p1: ['s3', 's1', 's2'],
      p2: ['s1', 's2', 's3'],
    },
  );

  test('Gale-Shapley is stable on this instance', () => {
    const result = galeShapley(profile);
    assert.equal(findBlockingPairs(profile, result).stable, true);
  });

  test('greedy respects capacity and never invents pairs', () => {
    const result = greedyMatch(profile);
    for (const [partyId, members] of result.partyMembers) {
      assert.ok(members.length <= profile.capacities.get(partyId));
    }
    for (const [seekerId, partyId] of result.assignments) {
      assert.ok(profile.seekerPrefs.get(seekerId).includes(partyId));
    }
  });

  test('random baseline is reproducible under a fixed seed', () => {
    const a = randomMatch(profile, 7);
    const b = randomMatch(profile, 7);
    assert.deepEqual([...a.assignments], [...b.assignments]);
  });
});

describe('Trace', () => {
  const profile = makeProfile(
    { s1: ['p1', 'p2'], s2: ['p1'] },
    { p1: ['s2', 's1'], p2: ['s1'] },
  );

  test('records proposals when requested, and nothing when not', () => {
    assert.equal(galeShapley(profile, { trace: false }).trace.length, 0);
    const traced = galeShapley(profile, { trace: true });
    assert.ok(traced.trace.length > 0);
    for (const event of traced.trace) {
      assert.ok(['accept', 'reject', 'evict'].includes(event.type));
    }
  });

  test('an eviction appears when a better proposal displaces a held seeker', () => {
    const traced = galeShapley(profile, { trace: true });
    const eviction = traced.trace.find((e) => e.type === 'evict');
    assert.ok(eviction, 'expected s2 to displace s1 at p1');
    assert.equal(eviction.seekerId, 's2');
    assert.equal(eviction.evictedSeekerId, 's1');
  });

  test('tracing does not change the outcome', () => {
    const a = galeShapley(profile, { trace: false });
    const b = galeShapley(profile, { trace: true });
    assert.deepEqual([...a.assignments].sort(), [...b.assignments].sort());
  });
});
