const scopeKeys = ['partyId', 'kakiConversationId'];

// Scope IDs remain opaque. Vue Router encodes them; membership and organizer
// permissions are still checked by the API at the destination.
export function normalizeMeetupScope(scope = {}) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return {};
  const entries = scopeKeys.filter(key => typeof scope[key] === 'string' && scope[key].trim())
    .map(key => [key, scope[key]]);
  return entries.length === 1 ? Object.fromEntries(entries) : {};
}

const origins = ['conversation', 'groups', 'manage-group', 'overview'];
export function normalizeMeetupOrigin(value) {
  return origins.includes(value) ? value : 'conversation';
}

export function meetupRouteForScope(scope, { from } = {}) {
  const query = normalizeMeetupScope(scope);
  if (from !== undefined) query.from = normalizeMeetupOrigin(from);
  return Object.keys(query).length ? { path: '/meetups', query } : { path: '/meetups' };
}

export function meetupScopeOf(plan = {}) {
  return normalizeMeetupScope(plan.scope ?? {
    partyId: plan.partyId ?? plan.party_id,
    kakiConversationId: plan.kakiConversationId ?? plan.kaki_conversation_id,
  });
}

export function meetupConversationRoute(scope) {
  const normalized = normalizeMeetupScope(scope);
  if (normalized.partyId) return `/groups/${encodeURIComponent(normalized.partyId)}/channel`;
  if (normalized.kakiConversationId) return `/kaki/chat/${encodeURIComponent(normalized.kakiConversationId)}`;
  return '/meetups';
}

const stages = ['availability', 'places', 'review'];
export function meetupRouteForBoard(plan, { from = 'conversation', stage = plan.nextStage } = {}) {
  return {
    path: `/meetups/${encodeURIComponent(plan.id)}`,
    query: { from: normalizeMeetupOrigin(from) },
    ...(stages.includes(stage) ? { hash: `#meetup-${stage}` } : {}),
  };
}

// Only a small origin enum is accepted. Never follow a supplied return URL or
// history entry; detail pages derive their conversation from authorized data.
export function meetupReturnRoute(plan, query = {}) {
  const origin = normalizeMeetupOrigin(query.from), scope = meetupScopeOf(plan);
  if (origin === 'overview') return '/meetups';
  if (origin === 'groups') return '/groups/connect';
  if (origin === 'manage-group') return scope.partyId ? `/groups/${encodeURIComponent(scope.partyId)}/members` : '/groups/connect';
  return meetupConversationRoute(scope);
}

export function meetupReturnLabel(plan, query = {}) {
  const destination = meetupReturnRoute(plan, query);
  if (destination === '/meetups') return 'Back to My meetups';
  if (destination === '/groups/connect') return 'Back to My groups';
  return normalizeMeetupOrigin(query.from) === 'manage-group' ? 'Back to Manage group' : 'Back to conversation';
}
