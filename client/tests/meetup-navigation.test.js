import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { meetupReturnRoute, meetupRouteForBoard, meetupRouteForScope, normalizeMeetupScope } from '../src/utils/meetupNavigation.js';

describe('scope-aware meetup navigation', () => {
  it.each(['partyId', 'connectionId', 'kakiConversationId'])('preserves the %s destination used by chats and dashboards', key => {
    const scope = { [key]: 'conversation-42' };
    expect(meetupRouteForScope(scope)).toEqual({ path: '/meetups', query: scope });
  });

  it('passes only the supported scope and leaves authorization to the destination', () => {
    expect(normalizeMeetupScope({ partyId: 'group-42', organizer: true, userId: 'somebody-else', returnTo: '/admin' }))
      .toEqual({ partyId: 'group-42' });
  });

  it.each([undefined, null, [], 'group-42', {}, { partyId: '' }, { partyId: ' ' }, { partyId: ['group-42'] },
    { partyId: 'group-42', connectionId: 'connection-42' }])('uses the existing all-plans page when a single scope is unavailable: %j', scope => {
    expect(meetupRouteForScope(scope)).toEqual({ path: '/meetups' });
  });

  it('keeps opaque IDs intact and lets the router encode query characters', () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/meetups', component: {} }] });
    const scope = { connectionId: 'connection/with & characters' };
    const route = router.resolve(meetupRouteForScope(scope));
    expect(route.query).toEqual(scope);
    expect(route.href).toBe('/meetups?connectionId=connection/with+%26+characters');
  });

  it.each([
    [{ partyId: 'group-1' }, '/groups/group-1/channel'],
    [{ connectionId: 'connection-1' }, '/groups/connections/connection-1/channel'],
    [{ kakiConversationId: 'pair-1' }, '/kaki/chat/pair-1'],
  ])('returns bookmarked and notification plans to their authorized conversation: %j', (scope, expected) => {
    const plan = { id: 'plan-1', scope };
    expect(meetupReturnRoute(plan)).toBe(expected);
    expect(meetupReturnRoute(plan, { from: 'https://evil.test', returnTo: '//evil.test' })).toBe(expected);
    expect(meetupReturnRoute(plan, { from: 'overview' })).toBe('/meetups');
  });

  it('keeps only known origins and planner stages in a board destination', () => {
    expect(meetupRouteForBoard({ id: 'plan-1', nextStage: 'review' }, { from: '//evil.test' }))
      .toEqual({ path: '/meetups/plan-1', query: { from: 'conversation' }, hash: '#meetup-review' });
    expect(meetupRouteForBoard({ id: 'plan-1' }, { from: 'overview', stage: 'javascript:alert(1)' }))
      .toEqual({ path: '/meetups/plan-1', query: { from: 'overview' } });
  });
});
