/**
 * API client.
 *
 * One place that knows about HTTP, so views deal in data and errors rather than
 * fetch options and status codes.
 */
import { ref } from 'vue';

export const notificationRevision = ref(0);


const BASE = '/api';

async function request(path, options = {}) {
  // Preserve default JSON headers while allowing API methods
  // to supply additional headers such as Idempotency-Key.
  //
  // We remove headers from options before spreading
  // the remaining fetch configuration.

  const {
    headers: extraHeaders = {},
    ...fetchOptions
  } = options;

  const res = await fetch(`${BASE}${path}`, {
    credentials: 'same-origin',
    ...fetchOptions,
    headers: {
      'content-type': 'application/json',
      ...extraHeaders
    }
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
  if (body?.notificationsRead > 0) notificationRevision.value++;
  return body;
}

export const api = {
  feedbackOpportunities: ()=>request('/me/feedback-opportunities'),
  myFeedback: ()=>request('/me/feedback'),
  meetups: ()=>request('/me/meetups'),
  createMeetup: data=>request('/meetups',{method:'POST',body:JSON.stringify(data)}),
  meetup: id=>request(`/meetups/${encodeURIComponent(id)}`),
  meetupAvailability: (id,windows)=>request(`/meetups/${encodeURIComponent(id)}/availability`,{method:'PUT',body:JSON.stringify({windows})}),
  proposeMeetupPlace: (id,data)=>request(`/meetups/${encodeURIComponent(id)}/places`,{method:'POST',body:JSON.stringify(data)}),
  voteMeetupPlace: (id,placeId)=>request(`/meetups/${encodeURIComponent(id)}/vote`,{method:'PUT',body:JSON.stringify({placeId})}),
  meetupComment: (id,body)=>request(`/meetups/${encodeURIComponent(id)}/comments`,{method:'POST',body:JSON.stringify({body})}),
  proposeMeetupPlan: (id,data)=>request(`/meetups/${encodeURIComponent(id)}/propose`,{method:'POST',body:JSON.stringify(data)}),
  approveMeetup: (id,version)=>request(`/meetups/${encodeURIComponent(id)}/approve`,{method:'POST',body:JSON.stringify({version})}),
  cancelMeetup: (id,version)=>request(`/meetups/${encodeURIComponent(id)}/cancel`,{method:'POST',body:JSON.stringify({version})}),
  meetupWeather: id=>request(`/meetups/${encodeURIComponent(id)}/weather`),
  notifications: ()=>request('/me/notifications'),
  unreadNotifications: ()=>request('/me/notifications/unread'),
  readNotification: id=>request(`/me/notifications/${encodeURIComponent(id)}/read`,{method:'POST'}),
  notificationSettings: ()=>request('/me/notification-preferences'),
  saveNotificationSettings: data=>request('/me/notification-preferences',{method:'PUT',body:JSON.stringify(data)}),
  preferenceConcepts: (q='') => request(`/preference-concepts?q=${encodeURIComponent(q)}`),
  groupMembership: id=>request(`/groups/${encodeURIComponent(id)}/membership`),
  myPreferences: ()=>request('/me/preferences'),
  saveMyPreferences: data=>request('/me/preferences',{method:'PUT',body:JSON.stringify(data)}),
  renameGroup: (id,name)=>request(`/groups/${encodeURIComponent(id)}/name`,{method:'PUT',body:JSON.stringify({name})}),
  setGroupImage: (id,image)=>request(`/groups/${encodeURIComponent(id)}/image`,{method:'PUT',body:JSON.stringify({image})}),
  clearGroupImage: id=>request(`/groups/${encodeURIComponent(id)}/image`,{method:'DELETE'}),
  configureGroup: (id,data)=>request(`/groups/${encodeURIComponent(id)}/settings`,{method:'PUT',body:JSON.stringify(data)}),
  saveMemberPreferences: (id,data)=>request(`/groups/${encodeURIComponent(id)}/member-preferences`,{method:'PUT',body:JSON.stringify(data)}),
  publishGroup: (id,data)=>request(`/groups/${encodeURIComponent(id)}/publish`,{method:'POST',body:JSON.stringify(data)}),
  friendInvite: id=>request(`/groups/${encodeURIComponent(id)}/friend-invites`,{method:'POST'}),
  acceptFriendInvite: token=>request(`/group-friend-invites/${encodeURIComponent(token)}/accept`,{method:'POST'}),
  leaveGroup: id=>request(`/groups/${encodeURIComponent(id)}/leave`,{method:'POST'}),
  cancelGroup: id=>request(`/groups/${encodeURIComponent(id)}/cancel`,{method:'POST'}),
  saveDiscoveryPreferences: (id,data)=>request(`/me/discovery-preferences/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(data)}),
  discoveryPreferences: id=>request(`/me/discovery-preferences/${encodeURIComponent(id)}`),
  requestGroupJoin: (id,data={})=>request(`/groups/${encodeURIComponent(id)}/join-requests`,{method:'POST',body:JSON.stringify(data)}),
  groupJoinRequests: (params={})=>request(`/me/group-join-requests?${new URLSearchParams(params)}`),
  hostedGroupJoinRequests: ()=>request('/me/hosted-group-join-requests'),
  withdrawGroupJoin: id=>request(`/group-join-requests/${encodeURIComponent(id)}/withdraw`,{method:'POST'}),
  setJoiningMode: (id,mode)=>request(`/me/seeker-requests/${encodeURIComponent(id)}/joining-mode`,{method:'PUT',body:JSON.stringify({mode})}),
  currentGroupMemberships: ()=>request('/me/current-group-memberships'),
  respondGroupJoin: (id,action)=>request(`/group-join-requests/${encodeURIComponent(id)}/respond`,{method:'POST',body:JSON.stringify({action})}),
  login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  profile: () => request('/me/profile'),
  updateProfile: (data) => request('/me/profile', { method: 'PATCH', body: JSON.stringify(data) }),
  myConcerts: () => request('/me/concerts'),
  myConcertResult: (concertId) => request(`/me/concerts/${encodeURIComponent(concertId)}/result`),
  participation: (concertId) => request(`/concerts/${encodeURIComponent(concertId)}/participation`),
  joinConcert: (concertId, data) =>
    request(`/concerts/${encodeURIComponent(concertId)}/participation`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  leaveConcert: (concertId) =>
    request(`/concerts/${encodeURIComponent(concertId)}/participation`, { method: 'DELETE' }),
  tickets: () => request('/tickets'),
  ticket: (id) => request(`/tickets/${encodeURIComponent(id)}`),
  createTicket: (data) => request('/tickets', { method: 'POST', body: JSON.stringify(data) }),
  updateTicket: (id, data) => request(`/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  myTickets: () => request('/me/tickets'),
  deleteTicket: (id) => request(`/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  submitProof: (id, proofData) =>
    request(`/me/tickets/${encodeURIComponent(id)}/proof`, { method: 'POST', body: JSON.stringify({ proofData }) }),

  order: (id) => request(`/orders/${encodeURIComponent(id)}`),

  /** Open (or reopen) the signed-in buyer's chat with a listing's seller. */
  startChat: (ticketId) => request(`/tickets/${encodeURIComponent(ticketId)}/conversations`, { method: 'POST' }),
  conversations: () => request('/conversations'),
  /** With `after`, only messages newer than that message id — what polling uses. */
  conversation: (id, after) =>
    request(`/conversations/${encodeURIComponent(id)}${after ? `?after=${encodeURIComponent(after)}` : ''}`),
  sendMessage: (id, body) =>
    request(`/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),

  verificationQueue: () => request('/operator/verifications'),
  reviewVerification: (id, decision, note = '') =>
    request(`/operator/verifications/${encodeURIComponent(id)}`, {
      method: 'POST', body: JSON.stringify({ decision, note }),
    }),
  issuedTicketSummary: () => request('/operator/issued-tickets'),
  /** CSV text, one `ticket_number[,category]` per line. */
  importIssuedTickets: (concertId, csv) =>
    request(`/operator/concerts/${encodeURIComponent(concertId)}/issued-tickets`, {
      method: 'POST', body: JSON.stringify({ csv }),
    }),

  kakiPool: () => request('/kaki/pool'),
  kakiDecisions: () => request('/kaki/decisions'),
  kakiMatches: () => request('/kaki/matches'),
  putKakiDecision: (concertId, targetUserId, decision) =>
    request(`/kaki/decisions/${encodeURIComponent(concertId)}/${encodeURIComponent(targetUserId)}`, {
      method: 'PUT', body: JSON.stringify({ decision }),
    }),
  deleteKakiDecision: (concertId, targetUserId) =>
    request(`/kaki/decisions/${encodeURIComponent(concertId)}/${encodeURIComponent(targetUserId)}`, {
      method: 'DELETE',
    }),

  /* ---- Kaki chat ---------------------------------------------------------
   * Only reachable between two people who liked each other for the same
   * concert. The server re-checks on every call, so a 403 here means the
   * match was withdrawn or somebody blocked — the UI treats both the same.
   */
  kakiConversations: () => request('/kaki/conversations'),
  kakiUnread: () => request('/kaki/unread'),
  markKakiRead: (id) =>
    request(`/kaki/conversations/${encodeURIComponent(id)}/read`, { method: 'POST' }),

  setAvatar: (image) => request('/me/avatar', { method: 'PUT', body: JSON.stringify({ image }) }),
  clearAvatar: () => request('/me/avatar', { method: 'DELETE' }),

  kakiChatBackgrounds: () => request('/kaki/chat-backgrounds'),
  openKakiConversation: (concertId, userId) =>
    request(`/kaki/concerts/${encodeURIComponent(concertId)}/conversations/${encodeURIComponent(userId)}`, {
      method: 'POST',
    }),
  kakiConversation: (id) => request(`/kaki/conversations/${encodeURIComponent(id)}`),
  sendKakiMessage: (id, body, replyTo = null) =>
    request(`/kaki/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST', body: JSON.stringify({ body, replyTo }),
    }),
  editKakiMessage: (id, messageId, body) =>
    request(`/kaki/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH', body: JSON.stringify({ body }),
    }),
  deleteKakiMessage: (id, messageId) =>
    request(`/kaki/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
    }),
  setKakiBackground: (id, background) =>
    request(`/kaki/conversations/${encodeURIComponent(id)}/background`, {
      method: 'PUT', body: JSON.stringify({ background }),
    }),

  blockedUsers: () => request('/me/blocked'),
  blockUser: (userId) => request(`/users/${encodeURIComponent(userId)}/block`, { method: 'PUT' }),
  unblockUser: (userId) => request(`/users/${encodeURIComponent(userId)}/block`, { method: 'DELETE' }),
  reportUser: (userId, payload) =>
    request(`/users/${encodeURIComponent(userId)}/reports`, {
      method: 'POST', body: JSON.stringify(payload),
    }),

  health: () => request('/health'),

  concerts: () => request('/concerts'),
  externalConcerts: (keyword = '') => request(`/concerts/external${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`),
  concert: (id) => request(`/concerts/${id}`),

  parties: (concertId) => request(`/concerts/${concertId}/parties`),
  createParty: (concertId, data) => request(`/concerts/${encodeURIComponent(concertId)}/parties`, { method: 'POST', body: JSON.stringify(data) }),

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

  runMatch: (concertId, batchKey) => request(`/concerts/${concertId}/match`, {
    method: 'POST', headers: { 'Idempotency-Key': batchKey },
  }),

  groupMatching: (id) => request(`/me/concerts/${encodeURIComponent(id)}/matching`),
  findMyGroup: (id, batchKey) => request(`/me/concerts/${encodeURIComponent(id)}/matching`, {
    method: 'POST', headers: { 'Idempotency-Key': batchKey },
  }),
  leaveGroupMatching: (id) => request(`/me/concerts/${encodeURIComponent(id)}/matching`, { method: 'DELETE' }),

  discoverGroups: (id,params={}) => request(`/groups/discover/${encodeURIComponent(id)}?${new URLSearchParams(params)}`),
  seekerRequest: (id) => request(`/me/seeker-request/${encodeURIComponent(id)}`),
  reopenSeekerRequest: (id) => request(`/me/seeker-request/${encodeURIComponent(id)}/reopen`, { method: 'POST' }),
  groupPreferences: (id) => request(`/me/group-preferences/${encodeURIComponent(id)}`),
  preferGroup: (id) => request(`/group-preferences/${encodeURIComponent(id)}`, { method: 'PUT' }),
  removeGroupPreference: (id) => request(`/group-preferences/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  hostedGroups: () => request('/me/hosted-groups'),
  attendanceGroups: () => request('/me/attendance-groups'),
  connectionCandidates: (id, fromPartyId,params={}) => request(`/group-connections/candidates/${encodeURIComponent(id)}?${new URLSearchParams({...params,fromPartyId})}`),
  groupConnections: () => request('/me/group-connections'),
  inviteGroup: (fromPartyId, toPartyId) => request('/group-connections', { method: 'POST', body: JSON.stringify({ fromPartyId, toPartyId }) }),
  respondToGroup: (id, action) => request(`/group-connections/${encodeURIComponent(id)}/respond`, { method: 'POST', body: JSON.stringify({ action }) }),
  /** Withdraw an invitation you sent; only the sending host may. */
  cancelGroupInvite: (id) => request(`/group-connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  round: (roundId) => request(`/rounds/${roundId}`),
  roundTrace: (roundId, limit = 2000) => request(`/rounds/${roundId}/trace?limit=${limit}`),
  verifyRound: (roundId) => request(`/rounds/${roundId}/verify`),
  partyRoster: (roundId, partyId) => request(`/rounds/${roundId}/parties/${partyId}`),

  explain: (concertId, requestId) => request(`/concerts/${concertId}/explain/${requestId}`),
  // ============================================================
  // IMPROVEMENTS #5 AND #6: OPERATIONAL MATCH PROPOSALS
  // ============================================================

  // All proposals visible to the logged-in user.
  myProposals: () =>
    request('/me/proposals'),

  // Pending proposals for a particular concert.
  concertProposals: (concertId) =>
    request(
      `/me/concerts/${encodeURIComponent(concertId)}/proposals`
    ),

  // Confirmed matches for a particular concert.
  concertMatches: (concertId) =>
    request(
      `/me/concerts/${encodeURIComponent(concertId)}/matches`
    ),

  // Accept a pending proposal.
  acceptProposal: (proposalId) =>
    request(
      `/proposals/${encodeURIComponent(proposalId)}/accept`,
      {
        method: 'POST'
      }
    ),

  // Decline a pending proposal.
  declineProposal: (proposalId) =>
    request(
      `/proposals/${encodeURIComponent(proposalId)}/decline`,
      {
        method: 'POST'
      }
    ),

  // Retrieve historical compatibility-score explanation.
  proposalExplanation: (proposalId) =>

    request(
      `/me/proposals/${encodeURIComponent(proposalId)}/explanation`
    ),
  // Improvement #14:
  // Submit feedback for an authorized confirmed participant.
  //
  // Eligibility must be checked by Express and SQLite,
  // never trusted solely from Vue.

  leaveFeedback: (data) =>
    request('/feedback', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  user: (id) => request(`/users/${id}`),
};



export const SECTION_OPTIONS = {
  vip: 'VIP',
  standing_pen: 'Standing pen',
  category_1: 'Category 1',
  category_2: 'Category 2',
  category_3: 'Category 3',
  category_4: 'Category 4',
  category_5: 'Category 5',
  category_6: 'Category 6',
};

export const ARRIVAL_OPTIONS = { doors: 'On time', early_queue: 'Early' };

/** Human labels for the enum values the API speaks in. */
export const LABELS = {
  section: {
    ...SECTION_OPTIONS,
    // Existing records keep their original labels; new forms use SECTION_OPTIONS.
    pit: 'Pit',
    ga_standing: 'General admission standing',
    lower_bowl: 'Lower bowl',
    upper_bowl: 'Upper bowl',
    seated_any: 'Any seated section',
  },
  arrival: {
    ...ARRIVAL_OPTIONS,
    mid: 'Arrive midday',
  },
  plans: {
    pre_meetup: 'Pre-show meetup',
    post_supper: 'Supper after',
    merch_run: 'Merchandise queue',
    transport_share: 'Share transport',
  },
  vibe: {
    singalong: 'Singalong',
    photography: 'Photography',
    dancing: 'Dancing',
    quiet: 'Quiet listening',
    queue_early: 'Early queueing',
    merch: 'Merchandise',
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
