/**
 * Ticket verification review. Admins are configured, not stored: ADMIN_EMAILS in
 * server/.env is a comma-separated list, matched case-insensitively against the
 * signed-in user's email.
 */
import { ownerListing } from './marketController.js';

export function adminEmails(env = process.env) {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdmin(user, env = process.env) {
  return Boolean(user?.email) && adminEmails(env).has(user.email.toLowerCase());
}

/** Route guard. Outsiders get 404, so the admin area is not advertised. */
export function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return res.status(404).json({ error: 'not_found' });
  next();
}

export function createAdminController(repos) {
  return {
    /** The review queue, each item with its proof attached. */
    queue(req, res) {
      res.json({
        listings: repos.listings.pendingVerification().map((listing) => ({
          ...ownerListing(listing, repos),
          proofData: repos.listings.proofFor(listing.id),
        })),
      });
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
        if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/.test(number)) invalid.push(index + 1);
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

      const done = repos.listings.review(req.params.id, {
        approve: decision === 'approve',
        note,
        reviewerId: req.user.id,
      });
      if (!done) return res.status(409).json({ error: 'not_pending' });
      res.json({ listing: ownerListing(repos.listings.findById(req.params.id), repos) });
    },
  };
}
