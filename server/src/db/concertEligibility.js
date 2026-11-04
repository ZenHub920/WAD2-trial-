import { concertParticipationEligibility } from '../../../shared/concertEligibility.mjs';

// Call inside the mutation transaction, using the authoritative concert row.
// Historical records and conversation authorization deliberately do not use it.
export function requireConcertCoordination(db, concertId) {
  const concert = db.prepare('SELECT * FROM concerts WHERE id=?').get(concertId);
  if (!concert) throw Object.assign(new Error('concert_not_found'), { status: 404 });
  const eligibility = concertParticipationEligibility(concert);
  if (!eligibility.eligible) throw Object.assign(new Error(eligibility.reason), {
    status: eligibility.reason === 'concert_date_unavailable' ? 400 : 409,
  });
  return concert;
}
