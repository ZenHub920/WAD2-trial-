/**
 * Evaluation harness.
 *
 * Runs Gale-Shapley against the greedy and random baselines on identical instances
 * and prints the comparison the report needs.
 *
 *   node bench/evaluate.js           -- headline comparison
 *   node bench/evaluate.js --scale   -- runtime scaling study
 *   node bench/evaluate.js --json    -- machine-readable output
 *
 * The expected headline result: greedy achieves a HIGHER aggregate compatibility
 * score and a NON-ZERO number of blocking pairs, while deferred acceptance achieves
 * a slightly lower score and exactly zero. That trade is the argument for the
 * algorithm.
 */

import {
  buildPreferences,
  galeShapley,
  greedyMatch,
  randomMatch,
  evaluate,
  findBlockingPairs,
} from '../src/matching/index.js';
import { generateInstance } from './generate.js';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 1e4) / 1e4;

function runOne({ seekers, parties, seed, maxCapacity = 3, concerts = 1, label }) {
  const instance = generateInstance({ seekers, parties, seed, maxCapacity, concerts });

  const tPrefStart = performance.now();
  const profile = buildPreferences(instance.seekers, instance.parties);
  const prefMs = performance.now() - tPrefStart;

  const tGs = performance.now();
  const gs = galeShapley(profile);
  const gsMs = performance.now() - tGs;

  const tGreedy = performance.now();
  const greedy = greedyMatch(profile);
  const greedyMs = performance.now() - tGreedy;

  const rand = randomMatch(profile, seed);

  const tVerify = performance.now();
  const gsCheck = findBlockingPairs(profile, gs);
  const verifyMs = performance.now() - tVerify;

  return {
    label,
    scale: { seekers, parties, maxCapacity, concerts },
    instance: {
      totalCapacity: profile.stats.totalCapacity,
      feasiblePairs: profile.stats.feasiblePairs,
      evaluatedPairs: profile.stats.evaluatedPairs,
      feasibilityRate:
        profile.stats.evaluatedPairs === 0
          ? 0
          : round4(profile.stats.feasiblePairs / profile.stats.evaluatedPairs),
      seekersWithNoOptions: profile.stats.seekersWithNoOptions,
      rejectionReasons: profile.stats.rejectionReasons,
    },
    timings: {
      buildPreferencesMs: round2(prefMs),
      galeShapleyMs: round2(gsMs),
      greedyMs: round2(greedyMs),
      verifyStabilityMs: round2(verifyMs),
    },
    solverStats: gs.stats,
    results: {
      'gale-shapley': evaluate(profile, gs),
      greedy: evaluate(profile, greedy),
      random: evaluate(profile, rand),
    },
    stabilityCheck: {
      gsBlockingPairs: gsCheck.blockingPairs.length,
      pairsChecked: gsCheck.checked,
    },
  };
}

function printComparison(run) {
  const r = run.results;
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);

  console.log(`\n\x1b[1m${run.label}\x1b[0m`);
  console.log(
    `  ${run.scale.seekers} seekers · ${run.scale.parties} parties · ` +
    `${run.instance.totalCapacity} slots · ${run.instance.feasiblePairs} feasible pairs ` +
    `(${(run.instance.feasibilityRate * 100).toFixed(1)}% of evaluated)`,
  );

  console.log(
    `\n  ${pad('algorithm', 16)}${num('blocking', 10)}${num('match%', 9)}` +
    `${num('mean rank', 11)}${num('worst', 8)}${num('1st choice', 12)}${num('total score', 14)}`,
  );
  console.log(`  ${'-'.repeat(80)}`);

  for (const [name, m] of Object.entries(r)) {
    const blocking = m.blockingPairs === 0
      ? `\x1b[32m${num(0, 10)}\x1b[0m`
      : `\x1b[31m${num(m.blockingPairs, 10)}\x1b[0m`;
    console.log(
      `  ${pad(name, 16)}${blocking}${num((m.matchRate * 100).toFixed(1), 9)}` +
      `${num(m.seekerRank.mean ?? '-', 11)}${num(m.seekerRank.worst ?? '-', 8)}` +
      `${num((m.firstChoiceRate * 100).toFixed(1) + '%', 12)}${num(m.totalCombinedScore, 14)}`,
    );
  }

  const gs = r['gale-shapley'];
  const greedy = r.greedy;
  const scoreDelta = greedy.totalCombinedScore - gs.totalCombinedScore;
  const scorePct = gs.totalCombinedScore === 0
    ? 0
    : (scoreDelta / gs.totalCombinedScore) * 100;

  console.log(
    `\n  \x1b[2mGreedy scores ${scoreDelta >= 0 ? '+' : ''}${scorePct.toFixed(2)}% ` +
    `on aggregate compatibility, at the cost of ${greedy.blockingPairs} blocking ` +
    `pair${greedy.blockingPairs === 1 ? '' : 's'}.\x1b[0m`,
  );
  console.log(
    `  \x1b[2mGale-Shapley: ${run.solverStats.proposals} proposals, ` +
    `${run.solverStats.evictions} evictions, ${run.solverStats.rejections} rejections ` +
    `in ${run.timings.galeShapleyMs}ms; stability verified over ` +
    `${run.stabilityCheck.pairsChecked} pairs in ${run.timings.verifyStabilityMs}ms.\x1b[0m`,
  );
}

function scalingStudy() {
  const sizes = [
    { seekers: 100, parties: 40 },
    { seekers: 500, parties: 200 },
    { seekers: 1000, parties: 400 },
    { seekers: 2500, parties: 1000 },
    { seekers: 5000, parties: 2000 },
  ];

  console.log('\n\x1b[1mRuntime scaling\x1b[0m\n');
  console.log(
    `  ${'seekers'.padStart(8)}${'parties'.padStart(9)}${'feasible pairs'.padStart(16)}` +
    `${'prefs ms'.padStart(11)}${'solve ms'.padStart(11)}${'verify ms'.padStart(11)}` +
    `${'blocking'.padStart(10)}`,
  );
  console.log(`  ${'-'.repeat(76)}`);

  const rows = [];
  for (const size of sizes) {
    const run = runOne({ ...size, seed: 99, label: `n=${size.seekers}` });
    rows.push(run);
    console.log(
      `  ${String(size.seekers).padStart(8)}${String(size.parties).padStart(9)}` +
      `${String(run.instance.feasiblePairs).padStart(16)}` +
      `${String(run.timings.buildPreferencesMs).padStart(11)}` +
      `${String(run.timings.galeShapleyMs).padStart(11)}` +
      `${String(run.timings.verifyStabilityMs).padStart(11)}` +
      `${String(run.results['gale-shapley'].blockingPairs).padStart(10)}`,
    );
  }

  console.log(
    '\n  \x1b[2mSolve time tracks the number of FEASIBLE PAIRS, not the number of agents.\n' +
    '  Deferred acceptance itself stays close to linear in the edges it walks; the\n' +
    '  cost that grows is building and sorting the preference lists.\x1b[0m',
  );

  // The rows above put every agent in ONE concert, which is the worst case and not
  // how the product behaves. Partitioning by event is the single largest
  // optimisation available, and it is free: pairs across different concerts are
  // infeasible by definition, so they are never enumerated.
  console.log('\n\x1b[1m  Same population, partitioned across 20 concerts\x1b[0m\n');
  console.log(
    `  ${'seekers'.padStart(8)}${'parties'.padStart(9)}${'feasible pairs'.padStart(16)}` +
    `${'prefs ms'.padStart(11)}${'solve ms'.padStart(11)}${'verify ms'.padStart(11)}` +
    `${'blocking'.padStart(10)}`,
  );
  console.log(`  ${'-'.repeat(76)}`);

  for (const size of sizes.slice(-3)) {
    const run = runOne({ ...size, concerts: 20, seed: 99, label: `n=${size.seekers}/20` });
    rows.push(run);
    console.log(
      `  ${String(size.seekers).padStart(8)}${String(size.parties).padStart(9)}` +
      `${String(run.instance.feasiblePairs).padStart(16)}` +
      `${String(run.timings.buildPreferencesMs).padStart(11)}` +
      `${String(run.timings.galeShapleyMs).padStart(11)}` +
      `${String(run.timings.verifyStabilityMs).padStart(11)}` +
      `${String(run.results['gale-shapley'].blockingPairs).padStart(10)}`,
    );
  }

  console.log(
    '\n  \x1b[2mPartitioning divides the pair count by roughly the number of concerts,\n' +
    '  because cross-event pairs are infeasible by definition and never enumerated.\n' +
    '  A production instance is one concert at a time, so the realistic upper bound\n' +
    '  is the per-event row, not the aggregate one.\x1b[0m',
  );

  return rows;
}

// ---------------------------------------------------------------------------

const scenarios = [
  {
    label: 'Balanced — supply roughly meets demand',
    seekers: 400, parties: 200, maxCapacity: 2, seed: 11,
  },
  {
    label: 'Oversubscribed — many more seekers than slots',
    seekers: 800, parties: 120, maxCapacity: 2, seed: 22,
  },
  {
    label: 'Undersubscribed — spare capacity everywhere',
    seekers: 150, parties: 200, maxCapacity: 3, seed: 33,
  },
  {
    label: 'Large groups — capacity up to 6 per party',
    seekers: 600, parties: 120, maxCapacity: 6, seed: 44,
  },
];

const runs = scenarios.map(runOne);

if (asJson) {
  const scale = args.has('--scale') ? scalingStudy() : [];
  console.log(JSON.stringify({ runs, scale }, null, 2));
} else {
  console.log('\n\x1b[1m═══ Encore matching — algorithm comparison ═══\x1b[0m');
  runs.forEach(printComparison);

  if (args.has('--scale')) scalingStudy();

  const anyUnstable = runs.some((r) => r.results['gale-shapley'].blockingPairs > 0);
  const greedyUnstable = runs.filter((r) => r.results.greedy.blockingPairs > 0).length;

  console.log('\n\x1b[1m═══ Summary ═══\x1b[0m');
  console.log(
    `  Gale-Shapley produced a stable matching in ${runs.length - (anyUnstable ? 1 : 0)}` +
    `/${runs.length} scenarios (0 blocking pairs each).`,
  );
  console.log(
    `  Greedy produced blocking pairs in ${greedyUnstable}/${runs.length} scenarios.`,
  );
  console.log(
    '  \x1b[2mAggregate score is not the objective: a matching with a higher total that\n' +
    '  contains blocking pairs is one whose users would rather pair up privately.\x1b[0m\n',
  );

  if (anyUnstable) {
    console.error('\x1b[31mFAIL: Gale-Shapley produced an unstable matching.\x1b[0m');
    process.exit(1);
  }
}
