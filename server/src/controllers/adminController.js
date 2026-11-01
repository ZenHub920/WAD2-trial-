/**
 * Ticket verification for operators (granted with `npm run operator:grant -- <email>`):
 * the proof-of-purchase review queue.
 */
import { ownerListing } from './ticketController.js';

export function createAdminController(repos) {
  return {
    /** The review queue, each item with its proof attached. */
    queue(req, res) {
      res.json({
        listings: repos.tickets.pendingVerification().map((listing) => ({
          ...ownerListing(listing),
          proofData: repos.tickets.proofFor(listing.id),
        })),
      });
    },

    review(req, res) {
      const decision = req.body?.decision;
      if (decision !== 'approve' && decision !== 'reject') {
        return res.status(400).json({ error: 'decision_must_be_approve_or_reject' });
      }
      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
      if (decision === 'reject' && !note) {
        // The seller needs to know what to fix before they re-submit.
        return res.status(400).json({ error: 'rejection_note_required' });
      }

      const done = repos.tickets.review(req.params.id, {
        approve: decision === 'approve',
        note,
        reviewerId: req.user.id,
      });
      if (!done) return res.status(409).json({ error: 'not_pending' });
      res.json({ listing: ownerListing(repos.tickets.findById(req.params.id)) });
    },
  };
}
