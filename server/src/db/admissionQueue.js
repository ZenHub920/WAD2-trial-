/** Public queue state comes from the shared ledger, never client timestamps. */
export function queueInfo(db, { joinRequestId = null, proposalId = null }) {
  const claim = db.prepare(`SELECT * FROM active_seat_claims
    WHERE (? IS NOT NULL AND join_request_id=?) OR (? IS NOT NULL AND proposal_id=?)`)
    .get(joinRequestId, joinRequestId, proposalId, proposalId);
  const live = claim?.status === 'proposed' && claim.expires_at > Date.now();
  const position = live ? db.prepare(`SELECT COUNT(*)+1 n FROM active_seat_claims
    WHERE party_id=? AND status='proposed' AND expires_at>unixepoch('subsec')*1000 AND queue_order<?`)
    .get(claim.party_id, claim.queue_order).n : null;
  return {
    queueOrder: claim?.queue_order ?? null,
    queuePosition: position,
    queueStatus: claim?.status === 'confirmed' ? 'confirmed'
      : live ? (claim.seat_held ? 'held' : 'waiting') : 'released',
    seatReserved: Boolean(claim && (claim.status === 'confirmed' || (live && claim.seat_held))),
    canHostRespond: Boolean(live && claim.seat_held && position === 1),
  };
}
