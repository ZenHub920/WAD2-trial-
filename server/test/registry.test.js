/**
 * Classifier, solver registry and guarantee ledger.
 *
 * The behavioural contract these protect:
 *   - an instance is described by the NARROWEST class that fits it
 *   - a constraint the chosen solver cannot represent is recorded, never dropped silently
 *   - a solver that ignored a constraint loses the right to its guarantees
 *   - verification is an assertion where stability was promised, a measurement where it was not
 *   - selection is deterministic
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { classifyInstance, CLASS, FEATURE } from '../src/matching/classify.js';
import { selectSolver, listSolvers, getSolver, SOLVERS } from '../src/matching/registry.js';
import {
  STABILITY,
  OPTIMALITY,
  verifyUnderGuarantee,
  weakerStability,
} from '../src/matching/guarantees.js';
import { solveInstance } from '../src/matching/solve.js';
import { makeProfile } from './helpers.js';

/** Minimal seeker/party records — only the fields the classifier reads. */
function seeker(id, extra = {}) {
  return { id, concert_id: 'c1', ...extra };
}
function party(id, capacity = 1, extra = {}) {
  return { id, concert_id: 'c1', capacity, ...extra };
}

describe('classifyInstance', () => {
  test('one-to-one when every capacity is 1', () => {
    const c = classifyInstance({
      seekers: [seeker('s1'), seeker('s2')],
      parties: [party('p1', 1), party('p2', 1)],
    });
    assert.equal(c.class, CLASS.ONE_TO_ONE);
    assert.ok(!c.features.includes(FEATURE.CAPACITY_ABOVE_ONE));
  });

  test('one-to-many as soon as any capacity exceeds 1', () => {
    const c = classifyInstance({
      seekers: [seeker('s1')],
      parties: [party('p1', 1), party('p2', 3)],
    });
    assert.equal(c.class, CLASS.ONE_TO_MANY);
    assert.equal(c.counts.maxCapacity, 3);
    assert.ok(c.features.includes(FEATURE.CAPACITY_ABOVE_ONE));
  });

  test('empty when either side is missing', () => {
    assert.equal(classifyInstance({ seekers: [], parties: [party('p1')] }).class, CLASS.EMPTY);
    assert.equal(classifyInstance({ seekers: [seeker('s1')], parties: [] }).class, CLASS.EMPTY);
  });

  test('peer-to-peer when given one pool instead of two sides', () => {
    const c = classifyInstance({ people: ['a', 'b', 'c'] });
    assert.equal(c.class, CLASS.PEER_TO_PEER);
    assert.equal(c.twoSided, false);
  });

  describe('linked pairs', () => {
    test('counted once per reciprocated pair', () => {
      const c = classifyInstance({
        seekers: [
          seeker('s1', { linked_request_id: 's2' }),
          seeker('s2', { linked_request_id: 's1' }),
          seeker('s3'),
        ],
        parties: [party('p1', 2)],
      });
      assert.equal(c.class, CLASS.WITH_COUPLES);
      assert.equal(c.counts.linkedPairs, 1, 'a pair is one pair, not two participants');
      assert.ok(c.features.includes(FEATURE.LINKED_PAIRS));
    });

    test('a one-sided link is NOT a couple', () => {
      // Malformed data, or a partner who withdrew. Treating it as a couple
      // would change the problem being solved without anyone asking.
      const c = classifyInstance({
        seekers: [seeker('s1', { linked_request_id: 's2' }), seeker('s2')],
        parties: [party('p1', 2)],
      });
      assert.equal(c.counts.linkedPairs, 0);
      assert.equal(c.class, CLASS.ONE_TO_MANY);
    });

    test('a link to someone absent from the round is ignored', () => {
      const c = classifyInstance({
        seekers: [seeker('s1', { linked_request_id: 's_gone' })],
        parties: [party('p1', 2)],
      });
      assert.equal(c.counts.linkedPairs, 0);
    });

    test('couples outrank capacity when naming the class', () => {
      const c = classifyInstance({
        seekers: [
          seeker('s1', { linked_request_id: 's2' }),
          seeker('s2', { linked_request_id: 's1' }),
        ],
        parties: [party('p1', 4)],
      });
      assert.equal(c.class, CLASS.WITH_COUPLES);
    });
  });

  describe('lower quotas', () => {
    test('a minimum above 1 is a constraint', () => {
      const c = classifyInstance({
        seekers: [seeker('s1')],
        parties: [party('p1', 4, { min_size: 3 })],
      });
      assert.equal(c.class, CLASS.WITH_LOWER_QUOTAS);
      assert.ok(c.features.includes(FEATURE.LOWER_QUOTAS));
    });

    test('a minimum of 0 or 1 is not', () => {
      for (const min of [null, 0, 1]) {
        const c = classifyInstance({
          seekers: [seeker('s1')],
          parties: [party('p1', 4, { min_size: min })],
        });
        assert.equal(c.counts.partiesWithLowerQuota, 0, `min_size=${min} should not constrain`);
      }
    });
  });
});

describe('selectSolver', () => {
  test('picks deferred acceptance for an ordinary one-to-many instance', () => {
    const c = classifyInstance({
      seekers: [seeker('s1')],
      parties: [party('p1', 3)],
    });
    const { solver, relaxations, effectiveGuarantees } = selectSolver(c);

    assert.equal(solver.id, 'hospital-residents');
    assert.deepEqual(relaxations, []);
    assert.equal(effectiveGuarantees.stability, STABILITY.GUARANTEED);
    assert.equal(effectiveGuarantees.optimality, OPTIMALITY.SEEKER_OPTIMAL);
  });

  test('never auto-selects a comparison-only solver', () => {
    const c = classifyInstance({ seekers: [seeker('s1')], parties: [party('p1', 2)] });
    const { solver } = selectSolver(c);
    assert.equal(solver.selectable, true);
    assert.notEqual(solver.id, 'greedy-welfare');
    assert.notEqual(solver.id, 'random-fcfs');
  });

  test('selection is deterministic', () => {
    const c = classifyInstance({ seekers: [seeker('s1')], parties: [party('p1', 2)] });
    const ids = Array.from({ length: 5 }, () => selectSolver(c).solver.id);
    assert.equal(new Set(ids).size, 1);
  });

  test('force overrides selection', () => {
    const c = classifyInstance({ seekers: [seeker('s1')], parties: [party('p1', 2)] });
    const { solver } = selectSolver(c, { force: 'greedy-welfare' });
    assert.equal(solver.id, 'greedy-welfare');
  });

  test('an unknown forced solver is an error, not a silent fallback', () => {
    const c = classifyInstance({ seekers: [seeker('s1')], parties: [party('p1', 2)] });
    assert.throws(() => selectSolver(c, { force: 'no-such-solver' }), /Unknown solver/);
  });

  describe('relaxation', () => {
    const coupled = () =>
      classifyInstance({
        seekers: [
          seeker('s1', { linked_request_id: 's2' }),
          seeker('s2', { linked_request_id: 's1' }),
        ],
        parties: [party('p1', 2)],
      });

    test('records the constraint it could not model', () => {
      const { relaxations } = selectSolver(coupled());
      assert.deepEqual(relaxations, [FEATURE.LINKED_PAIRS]);
    });

    test('downgrades the stability promise it is no longer entitled to', () => {
      const { solver, effectiveGuarantees } = selectSolver(coupled());
      assert.equal(
        solver.guarantees.stability,
        STABILITY.GUARANTEED,
        'the solver itself still guarantees stability for the problem it CAN model',
      );
      assert.equal(
        effectiveGuarantees.stability,
        STABILITY.NOT_GUARANTEED,
        'but not for the instance it was actually handed',
      );
      assert.equal(effectiveGuarantees.optimality, OPTIMALITY.NONE);
    });

    test('says so in the reason', () => {
      const { reason } = selectSolver(coupled());
      assert.match(reason, /relaxed instance/);
    });
  });
});

describe('weakerStability', () => {
  test('returns the weaker of two promises, either way round', () => {
    assert.equal(
      weakerStability(STABILITY.GUARANTEED, STABILITY.NOT_GUARANTEED),
      STABILITY.NOT_GUARANTEED,
    );
    assert.equal(
      weakerStability(STABILITY.NOT_GUARANTEED, STABILITY.GUARANTEED),
      STABILITY.NOT_GUARANTEED,
    );
    assert.equal(
      weakerStability(STABILITY.GUARANTEED, STABILITY.BEST_EFFORT),
      STABILITY.BEST_EFFORT,
    );
  });
});

describe('verifyUnderGuarantee', () => {
  // s1 and p2 would both rather have each other than what they hold.
  const unstable = () => {
    const profile = makeProfile(
      { s1: ['p2', 'p1'], s2: ['p2', 'p1'] },
      { p1: ['s1', 's2'], p2: ['s1', 's2'] },
    );
    const matching = {
      assignments: new Map([['s1', 'p1'], ['s2', 'p2']]),
      partyMembers: new Map([['p1', ['s1']], ['p2', ['s2']]]),
    };
    return { profile, matching };
  };

  test('throws when stability was guaranteed but is absent', () => {
    const { profile, matching } = unstable();
    assert.throws(
      () => verifyUnderGuarantee(profile, matching, STABILITY.GUARANTEED, 'test-solver'),
      /promised a stable matching/,
    );
  });

  test('measures instead of throwing when stability was not guaranteed', () => {
    const { profile, matching } = unstable();
    const v = verifyUnderGuarantee(profile, matching, STABILITY.NOT_GUARANTEED, 'test-solver');
    assert.equal(v.mode, 'measure');
    assert.equal(v.passed, false);
    assert.ok(v.blockingPairs > 0);
  });

  test('a stable matching passes under either promise', () => {
    const profile = makeProfile(
      { s1: ['p1'], s2: ['p2'] },
      { p1: ['s1'], p2: ['s2'] },
    );
    const matching = {
      assignments: new Map([['s1', 'p1'], ['s2', 'p2']]),
      partyMembers: new Map([['p1', ['s1']], ['p2', ['s2']]]),
    };
    for (const promise of [STABILITY.GUARANTEED, STABILITY.NOT_GUARANTEED]) {
      const v = verifyUnderGuarantee(profile, matching, promise, 'test');
      assert.equal(v.passed, true);
      assert.equal(v.blockingPairs, 0);
    }
  });
});

describe('solveInstance ledger', () => {
  const profile = () =>
    makeProfile(
      { s1: ['p1', 'p2'], s2: ['p1', 'p2'] },
      { p1: ['s1', 's2'], p2: ['s2', 's1'] },
      { p1: 1, p2: 1 },
    );

  test('separates what was promised from what was measured', () => {
    const { ledger } = solveInstance({
      profile: profile(),
      seekers: [seeker('s1'), seeker('s2')],
      parties: [party('p1', 1), party('p2', 1)],
    });

    assert.equal(ledger.solver, 'hospital-residents');
    assert.equal(ledger.instanceClass, CLASS.ONE_TO_ONE);
    assert.equal(ledger.promised.stability, STABILITY.GUARANTEED);
    assert.equal(ledger.verification.mode, 'assert');
    assert.equal(ledger.verification.stable, true);
    assert.equal(ledger.verification.blockingPairs, 0);
    assert.ok(ledger.verification.pairsChecked > 0);
  });

  test('carries a headline the interface can show unmodified', () => {
    const { ledger } = solveInstance({
      profile: profile(),
      seekers: [seeker('s1'), seeker('s2')],
      parties: [party('p1', 1), party('p2', 1)],
    });
    assert.match(ledger.headline, /^Stable — verified over/);
  });

  test('a relaxed round refuses to call itself stable', () => {
    // Same instance, but the two seekers are now a couple. No registered
    // solver models that, so the round must not claim a stability it did not
    // establish for the problem it was given.
    const { ledger } = solveInstance({
      profile: profile(),
      seekers: [
        seeker('s1', { linked_request_id: 's2' }),
        seeker('s2', { linked_request_id: 's1' }),
      ],
      parties: [party('p1', 1), party('p2', 1)],
    });

    assert.equal(ledger.instanceClass, CLASS.WITH_COUPLES);
    assert.deepEqual(ledger.relaxations, [FEATURE.LINKED_PAIRS]);
    assert.equal(ledger.promised.stability, STABILITY.NOT_GUARANTEED);
    assert.equal(ledger.verification.mode, 'measure');
    assert.match(ledger.headline, /not a solution to the full problem/);
    assert.doesNotMatch(ledger.headline, /^Stable —/);
  });

  test('produces the same matching as calling the solver directly', () => {
    // The registry is dispatch, not a change of behaviour.
    const p = profile();
    const { result } = solveInstance({
      profile: p,
      seekers: [seeker('s1'), seeker('s2')],
      parties: [party('p1', 1), party('p2', 1)],
    });
    assert.equal(result.assignments.get('s1'), 'p1');
    assert.equal(result.assignments.get('s2'), 'p2');
  });

  test('refuses to route a two-sided instance through a pairs solver', () => {
    assert.throws(
      () =>
        solveInstance({
          profile: profile(),
          seekers: [seeker('s1')],
          parties: [party('p1', 1)],
          options: { force: 'stable-roommates' },
        }),
      /cannot be used on a two-sided instance/,
    );
  });
});

describe('registry integrity', () => {
  test('every solver declares the fields the ledger depends on', () => {
    for (const s of SOLVERS) {
      assert.ok(s.id, 'id');
      assert.ok(s.name, `${s.id}: name`);
      assert.ok(Array.isArray(s.handles) && s.handles.length > 0, `${s.id}: handles`);
      assert.ok(Array.isArray(s.cannotModel), `${s.id}: cannotModel`);
      assert.ok(s.guarantees?.stability, `${s.id}: stability promise`);
      assert.ok(s.guarantees?.optimality, `${s.id}: optimality promise`);
      assert.ok(s.resultShape, `${s.id}: resultShape`);
      assert.equal(typeof s.solve, 'function', `${s.id}: solve`);
    }
  });

  test('ids are unique', () => {
    const ids = SOLVERS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('listSolvers omits the implementations but keeps the guarantees', () => {
    const listed = listSolvers();
    assert.equal(listed.length, SOLVERS.length);
    for (const s of listed) {
      assert.equal(s.solve, undefined, 'must not leak the function over HTTP');
      assert.ok(s.guarantees.stability);
    }
  });

  test('getSolver round-trips a known id and returns null otherwise', () => {
    assert.equal(getSolver('hospital-residents')?.id, 'hospital-residents');
    assert.equal(getSolver('nope'), null);
  });
});
