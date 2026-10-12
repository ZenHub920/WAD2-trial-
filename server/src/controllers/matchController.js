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

        // ============================================================
    // IMPROVEMENT #4: IDEMPOTENT MATCHING ENDPOINT
    // ============================================================
    //
    // PURPOSE:
    // Allow matching operations to be retried safely.
    //
    // The frontend sends an Idempotency-Key HTTP header.
    //
    // The controller validates the key and forwards it
    // to matchingService.run().
    //
    // HTTP responses:
    //
    // 201 = New matching round created.
    // 200 = Previous matching round returned.
    // 400 = Missing or invalid idempotency key.
    // 409 = No eligible participants or legacy reconciliation needed.
    // 500 = Unexpected matching failure.

    run(req, res) {
      try {

        // STEP 1:
        // Retrieve the idempotency key supplied by Vue.
        const batchKey = req.get('Idempotency-Key');

        // STEP 2:
        // Validate UUID version 4 format.
        //
        // crypto.randomUUID() on the frontend generates
        // a UUID suitable for this validation.

        const validUUID =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

        if (!batchKey || !validUUID.test(batchKey)) {
          return res.status(400).json({
            error: 'invalid_idempotency_key'
          });
        }

        // STEP 3:
        // Forward the key to the existing matching service.
        //
        // The service handles idempotency and transactions.

        const outcome = matching.run(req.params.id, {
          trace: true,
          batchKey
        });

        // STEP 4:
        // Do not create empty matching rounds.

        if (outcome.empty) {
          return res.status(409).json({
            error: 'nothing_to_match',
            ...outcome
          });
        }

        // STEP 5:
        // Distinguish a replay from a newly committed round.

        return res.status(outcome.replayed ? 200 : 201)
          .json(outcome);

      } catch (err) {

        // An old database might contain matched statuses
        // without corresponding active proposal records.
        //
        // We must not silently release those historical slots.

        if (err.message === 'legacy_matches_require_reconciliation') {
          return res.status(409).json({
            error: err.message
          });
        }

        // Avoid exposing internal implementation details
        // in production HTTP responses.

        return res.status(500).json({
          error: 'match_failed',
          ...(process.env.NODE_ENV === 'production'
            ? {}
            : { detail: err.message })
        });
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
