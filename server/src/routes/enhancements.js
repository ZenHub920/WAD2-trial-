/**
 * Proposal retrieval, responses and historical explanations for the session user.
 * Identity always comes from req.user, never from a userId in the request body.
 */

export function registerEnhancementRoutes(router, { repos, requireUser }) {

  // ============================================================
  // IMPROVEMENT #5
  // GET ALL PROPOSALS VISIBLE TO THE CURRENT USER
  // ============================================================

  router.get(
    '/me/proposals',

    requireUser,

    (req, res) => {

      // Expiration must be processed before returning
      // the current operational state.
      //
      // Otherwise, a proposal whose deadline passed
      // might still appear to be pending.

      repos.proposals.expire();

      // The authenticated user ID comes from the session.
      const userId = req.user.id;

      // Includes proposals in all states and all rounds.
      //
      // A seeker sees their own proposals.
      // A host sees proposals involving their hosted party.

      const proposals =
        repos.proposals.forUser(userId);

      return res.json({
        proposals
      });
    }
  );

  // ============================================================
  // IMPROVEMENT #5
  // GET PENDING PROPOSALS FOR ONE CONCERT
  // ============================================================

  router.get(
    '/me/concerts/:id/proposals',

    requireUser,

    (req, res) => {

      repos.proposals.expire();

      const userId = req.user.id;
      const concertId = req.params.id;

      // Only pending offers.
      //
      // This endpoint is useful for a "Respond to offers"
      // section in the dashboard.

      const proposals = repos.proposals.forUser(
        userId,
        concertId,
        ['proposed']
      );

      return res.json({
        proposals
      });
    }
  );

  // ============================================================
  // IMPROVEMENT #5
  // GET CONFIRMED MATCHES FOR ONE CONCERT
  // ============================================================

  router.get(
    '/me/concerts/:id/matches',

    requireUser,

    (req, res) => {

      repos.proposals.expire();

      const userId = req.user.id;
      const concertId = req.params.id;

      // Only confirmed matches.
      //
      // Historical match_results are deliberately NOT
      // consulted to determine the operational status.

      const matches = repos.proposals.forUser(
        userId,
        concertId,
        ['confirmed']
      );

      return res.json({
        matches
      });
    }
  );

  // ============================================================
  // IMPROVEMENT #6
  // ACCEPT OR DECLINE A PROPOSAL
  // ============================================================
  //
  // Both actions use the same repository method.
  //
  // The repository performs:
  //
  // 1. Ownership verification
  // 2. Pending-status verification
  // 3. Expiration validation
  // 4. Transactional status update
  // 5. Capacity release where necessary
  // 6. Recording declined pairs
  //
  // We must NOT duplicate these business rules here.

  for (const action of ['accept', 'decline']) {

    router.post(
      `/proposals/:id/${action}`,

      requireUser,

      (req, res) => {

        const userId = req.user.id;
        const proposalId = req.params.id;

        const result = repos.proposals.respond(
          userId,
          proposalId,
          action
        );

        // Examples:
        //
        // 404 = proposal does not exist or is not owned
        // 409 = proposal already answered or expired

        if (result.error) {
          return res.status(result.status ?? 400).json({ error: result.error });
        }

        return res.json({
          proposal: result
        });
      }
    );
  }

  // ============================================================
  // IMPROVEMENT #12
  // RETRIEVE THE HISTORICAL MATCH EXPLANATION
  // ============================================================

  router.get(
    '/me/proposals/:id/explanation',

    requireUser,

    (req, res) => {

      const userId = req.user.id;
      const proposalId = req.params.id;

      // Read the original score snapshot.
      //
      // The repository verifies that the current user
      // is the seeker or the relevant group host.

      const explanation =
        repos.proposals.explain(
          userId,
          proposalId
        );

      if (!explanation) {

        return res.status(404).json({
          error: 'proposal_not_found'
        });

      }

      return res.json({
        explanation
      });
    }
  );

}