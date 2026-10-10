import { listSolvers } from '../matching/index.js';
import { publicUser } from './publicUser.js';

function publicLedger(ledger) {
  if (!ledger) return null;
  return {
    solver: ledger.solver,
    solverName: ledger.solverName,
    instanceClass: ledger.instanceClass,
    selectedBecause: ledger.selectedBecause,
    features: ledger.features,
    counts: ledger.counts,
    promised: ledger.promised,
    relaxations: ledger.relaxations,
    verification: {
      mode: ledger.verification.mode,
      stable: ledger.verification.stable,
      blockingPairs: ledger.verification.blockingPairs,
      pairsChecked: ledger.verification.pairsChecked,
    },
    timings: ledger.timings,
    headline: ledger.headline,
  };
}

export function createMatchController({ repos, matching }) {
  return {
    preview(req, res) {
      const withBaselines = req.query.baselines === 'true';
      const withTrace = req.user?.is_operator && req.query.trace === 'true';

      try {
        const preview = matching.preview(req.params.id, {
          trace: withTrace,
          withBaselines,
        });
        if (preview.empty) return res.json(preview);

        res.json({
          empty: false,
          metrics: preview.metrics,
          timings: preview.timings,
          comparison: preview.comparison ?? null,
          instance: preview.profile.stats,
          solver: preview.result.stats,
          ledger: req.user?.is_operator ? preview.ledger ?? null : publicLedger(preview.ledger),
          classification: preview.classification ?? null,
          ...(req.user?.is_operator ? {
            trace: withTrace ? preview.result.trace : undefined,
            assignments: [...preview.result.assignments].map(([seekerId, partyId]) => ({
              seekerId, partyId,
            })),
            unmatched: preview.result.unmatchedSeekers,
          } : {}),
        });
      } catch (err) {
        res.status(500).json({
          error: 'match_failed',
          ...(req.user?.is_operator ? { detail: err.message } : {}),
        });
      }
    },

    myResult(req, res) {
      const result = repos.rounds.resultForUser(req.params.id, req.user.id);
      if (!result) return res.json({ result: null });
      res.json({ result: {
        ...result,
        group: result.group ? { ...result.group, host: publicUser(result.group.host) } : undefined,
        members: result.members?.map(publicUser),
      } });
    },

    run(req, res) {
      try {
        const outcome = matching.run(req.params.id, { trace: true });
        if (outcome.empty) return res.status(409).json({ error: 'nothing_to_match', ...outcome });
        res.status(201).json(outcome);
      } catch (err) {
        res.status(500).json({ error: 'match_failed', detail: err.message });
      }
    },

    round(req, res) {
      const round = repos.rounds.findById(req.params.id);
      if (!round) return res.status(404).json({ error: 'round_not_found' });
      res.json({
        round: {
          id: round.id,
          concertId: round.concert_id,
          algorithm: round.algorithm,
          ranAt: round.ran_at,
          isStable: round.is_stable === 1,
          blockingPairCount: round.blocking_pair_count,
          metrics: round.metrics,
          timings: round.timings,
          solverId: round.solver_id ?? null,
          instanceClass: round.instance_class ?? null,
          stabilityPromise: round.stability_promise ?? null,
          ledger: round.ledger_json ? JSON.parse(round.ledger_json) : null,
        },
        results: repos.rounds.resultsForRound(round.id),
      });
    },

    solvers(req, res) {
      res.json({ solvers: listSolvers() });
    },

    trace(req, res) {
      const limit = Math.min(Number(req.query.limit) || 2000, 10000);
      res.json({ trace: repos.rounds.traceForRound(req.params.id, limit) });
    },

    roster(req, res) {
      res.json({ roster: repos.rounds.partyRoster(req.params.id, req.params.partyId) });
    },

    verify(req, res) {
      const verdict = matching.reverify(req.params.id);
      if (!verdict) return res.status(404).json({ error: 'round_not_found' });
      res.json(verdict);
    },

    explain(req, res) {
      try {
        res.json(matching.explain(req.params.id, req.params.requestId));
      } catch (err) {
        res.status(500).json({ error: 'explain_failed', detail: err.message });
      }
    },
  };
}
