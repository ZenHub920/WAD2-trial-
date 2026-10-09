import { listSolvers } from '../matching/index.js';

export function createMatchController({ repos, matching }) {
  return {
    preview(req, res) {
      const withBaselines = req.query.baselines === 'true';
      const withTrace = req.query.trace === 'true';

      try {
        const preview = matching.preview(req.params.id, {
          trace: withTrace,
          withBaselines,
        });
        if (preview.empty) return res.json({ empty: true, ...preview });

        res.json({
          empty: false,
          metrics: preview.metrics,
          timings: preview.timings,
          comparison: preview.comparison ?? null,
          instance: preview.profile.stats,
          solver: preview.result.stats,
          ledger: preview.ledger ?? null,
          classification: preview.classification ?? null,
          trace: withTrace ? preview.result.trace : undefined,
          assignments: [...preview.result.assignments].map(([seekerId, partyId]) => ({
            seekerId,
            partyId,
          })),
          unmatched: preview.result.unmatchedSeekers,
        });
      } catch (err) {
        res.status(500).json({ error: 'match_failed', detail: err.message });
      }
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
