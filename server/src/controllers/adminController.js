/**
 * Ticket verification for operators (granted with `npm run operator:grant -- <email>`):
 * the proof-of-purchase review queue, and each concert's issued ticket list.
 */
import { ownerListing, TICKET_NUMBER } from './ticketController.js';

export function createAdminController(repos) {
  return {
    /** The review queue, each item with its proof attached. */
    queue(req, res) {
      res.json({
        listings: repos.tickets.pendingVerification().map((listing) => ({
          ...ownerListing(listing, repos),
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
      res.json({ listing: ownerListing(repos.tickets.findById(req.params.id), repos) });
    },

    issuedSummary(req, res) {
      res.json({ concerts: repos.issuedTickets.summary() });
    },

    /**
     * Import a concert's issued ticket numbers from CSV text: one ticket per line,
     * `ticket_number[,category]`. A header row starting with "ticket" is skipped.
     */
    importIssued(req, res) {
      if (!repos.concerts.findById(req.params.id)) {
        return res.status(404).json({ error: 'concert_not_found' });
      }
      const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
      const rows = [];
      const invalid = [];
      csv.split(/\r?\n/).forEach((line, index) => {
        const [number = '', category = ''] = line.split(',').map((cell) => cell.trim());
        if (!number || (index === 0 && /^ticket/i.test(number))) return;
        if (!TICKET_NUMBER.test(number)) invalid.push(index + 1);
        else rows.push({ number, category });
      });
      if (invalid.length) {
        return res.status(400).json({ error: 'invalid_ticket_numbers', lines: invalid.slice(0, 20) });
      }
      if (!rows.length) return res.status(400).json({ error: 'no_ticket_numbers' });
      if (rows.length > 50_000) return res.status(400).json({ error: 'too_many_rows' });

      const added = repos.issuedTickets.import(req.params.id, rows);
      res.json({ added, skipped: rows.length - added });
    },
  };
}
