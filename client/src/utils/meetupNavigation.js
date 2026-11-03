const scopeKeys = ['partyId', 'connectionId', 'kakiConversationId'];

// Scope IDs remain opaque. Vue Router encodes them; membership and organizer
// permissions are still checked by the API at the destination.
export function normalizeMeetupScope(scope = {}) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return {};
  const entries = scopeKeys.filter(key => typeof scope[key] === 'string' && scope[key].trim())
    .map(key => [key, scope[key]]);
  return entries.length === 1 ? Object.fromEntries(entries) : {};
}

export function meetupRouteForScope(scope) {
  const query = normalizeMeetupScope(scope);
  return Object.keys(query).length ? { path: '/meetups', query } : { path: '/meetups' };
}

export function meetupScopeOf(plan = {}) {
  return normalizeMeetupScope(plan.scope ?? {
    partyId: plan.partyId ?? plan.party_id,
    connectionId: plan.connectionId ?? plan.connection_id,
    kakiConversationId: plan.kakiConversationId ?? plan.kaki_conversation_id,
  });
}

export function meetupConversationRoute(scope) {
  const normalized = normalizeMeetupScope(scope);
  if (normalized.partyId) return `/groups/${encodeURIComponent(normalized.partyId)}/channel`;
  if (normalized.connectionId) return `/groups/connections/${encodeURIComponent(normalized.connectionId)}/channel`;
  if (normalized.kakiConversationId) return `/kaki/chat/${encodeURIComponent(normalized.kakiConversationId)}`;
  return '/meetups';
}

const stages = ['availability', 'places', 'review'];
export function meetupRouteForBoard(plan, { from = 'conversation', stage = plan.nextStage } = {}) {
  return {
    path: `/meetups/${encodeURIComponent(plan.id)}`,
    query: { from: from === 'overview' ? 'overview' : 'conversation' },
    ...(stages.includes(stage) ? { hash: `#meetup-${stage}` } : {}),
  };
}

// Only a small origin enum is accepted. Never follow a supplied return URL or
// history entry; detail pages derive their conversation from authorized data.
export function meetupReturnRoute(plan, query = {}) {
  return query.from === 'overview' ? '/meetups' : meetupConversationRoute(meetupScopeOf(plan));
}
