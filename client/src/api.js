/**
 * API client.
 *
 * One place that knows about HTTP, so views deal in data and errors rather than
 * fetch options and status codes.
 */

const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    const error = new Error(body?.error ?? `request_failed_${res.status}`);
    error.status = res.status;
    error.detail = body?.detail;
    error.body = body;
    throw error;
  }
  return body;
}

export const api = {
  health: () => request('/health'),

  concerts: () => request('/concerts'),
  concert: (id) => request(`/concerts/${id}`),

  parties: (concertId) => request(`/concerts/${concertId}/parties`),
  createParty: (concertId, data) =>
    request(`/concerts/${concertId}/parties`, { method: 'POST', body: JSON.stringify(data) }),

  requests: (concertId) => request(`/concerts/${concertId}/requests`),
  createRequest: (concertId, data) =>
    request(`/concerts/${concertId}/requests`, { method: 'POST', body: JSON.stringify(data) }),

  /** Dry run — solve and report without persisting. */
  preview: (concertId, { baselines = false, trace = false } = {}) => {
    const query = new URLSearchParams();
    if (baselines) query.set('baselines', 'true');
    if (trace) query.set('trace', 'true');
    const qs = query.toString();
    return request(`/concerts/${concertId}/match/preview${qs ? `?${qs}` : ''}`);
  },

  runMatch: (concertId) => request(`/concerts/${concertId}/match`, { method: 'POST' }),

  round: (roundId) => request(`/rounds/${roundId}`),
  roundTrace: (roundId, limit = 2000) => request(`/rounds/${roundId}/trace?limit=${limit}`),
  verifyRound: (roundId) => request(`/rounds/${roundId}/verify`),
  partyRoster: (roundId, partyId) => request(`/rounds/${roundId}/parties/${partyId}`),

  explain: (concertId, requestId) => request(`/concerts/${concertId}/explain/${requestId}`),

  listings: (query = '') =>
    request(`/listings${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  listing: (id) => request(`/listings/${id}`),
  /** The server prices the order from the listing; only who pays and how is sent. */
  buyListing: (id, { buyerUserId, paymentMethod }) =>
    request(`/listings/${id}/orders`, {
      method: 'POST',
      body: JSON.stringify({ buyer_user_id: buyerUserId, payment_method: paymentMethod }),
    }),
  order: (id) => request(`/orders/${id}`),

  user: (id) => request(`/users/${id}`),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
};

/** Human labels for the enum values the API speaks in. */
export const LABELS = {
  section: {
    pit: 'Pit',
    ga_standing: 'GA standing',
    lower_bowl: 'Lower bowl',
    upper_bowl: 'Upper bowl',
    seated_any: 'Seated (any)',
  },
  arrival: {
    early_queue: 'Queue early',
    mid: 'Arrive midday',
    doors: 'Arrive at doors',
  },
  plans: {
    pre_meetup: 'Pre-show meetup',
    post_supper: 'Supper after',
    merch_run: 'Merch queue',
    transport_share: 'Share transport',
  },
  vibe: {
    singalong: 'Singalong',
    photography: 'Photography',
    dancing: 'Dancing',
    quiet: 'Quiet listening',
    queue_early: 'Early queueing',
    merch: 'Merch hunting',
  },
  spendBand: ['', 'Budget', 'Moderate', 'Comfortable', 'Premium'],
};

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatShortDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}
