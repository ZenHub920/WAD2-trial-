import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import ConcertView from '../../client/src/views/ConcertView.vue';
import { useConcertEligibility } from '../../client/src/composables/useConcertEligibility.js';
import { api } from '../../client/src/api.js';
import { currentUser } from '../../client/src/auth.js';
import { button, field, mountPage } from './helpers.js';

vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: {
  concert: vi.fn(), concertSetlist: vi.fn(), parties: vi.fn(), requests: vi.fn(), tickets: vi.fn(),
  participation: vi.fn(), myProposals: vi.fn(), joinConcert: vi.fn(), leaveConcert: vi.fn(), preview: vi.fn(), runMatch: vi.fn(),
} }));
vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'viewer', displayName: 'Ari', avatarUrl: '/api/avatars/ari.png' }), sessionReady: ref(true) };
});

const detail = (id = 'show', date = '2026-11-05', extra = {}) => ({
  concert: { id, artist: `${id} artist`, event_date: date, event_timezone: 'Asia/Singapore', venue: 'Stadium', city: 'Singapore', ...extra },
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const stubs = {
  SetlistReel: { props: ['artist', 'setlist'], template: '<p data-test="setlist">{{ setlist?.tracks?.[0]?.title }}</p>' },
  SetlistEditor: true,
  MatchProposalCard: { props: ['proposal'], template: '<p data-test="proposal">{{ proposal.id }}</p>' },
};
beforeEach(() => {
  vi.resetAllMocks(); currentUser.value = { id: 'viewer', displayName: 'Ari', avatarUrl: '/api/avatars/ari.png' };
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
  api.concert.mockResolvedValue(detail()); api.concertSetlist.mockResolvedValue({ setlist: null });
  api.parties.mockResolvedValue({ parties: [] }); api.requests.mockResolvedValue({ requests: [] });
  api.tickets.mockResolvedValue({ listings: [] }); api.participation.mockResolvedValue({ participation: null });
  api.myProposals.mockResolvedValue({ proposals: [] });
  api.joinConcert.mockResolvedValue({ participation: { sectionPref: 'category_1', arrivalPref: 'doors' } });
  api.leaveConcert.mockResolvedValue({});
});

describe('concert participation and historical access consistency', () => {
  it('preserves historical participation and result records while removing new coordination actions', async () => {
    api.concert.mockResolvedValue(detail('old-show', '2026-11-03'));
    api.participation.mockResolvedValue({ participation: { sectionPref: 'pit', arrivalPref: 'doors' } });
    api.myProposals.mockResolvedValue({ proposals: [{ id: 'historic-result', concertId: 'old-show', status: 'confirmed' }] });
    const { wrapper } = await mountPage(ConcertView, { path: '/concerts/old-show', props: { id: 'old-show' }, stubs });
    expect(wrapper.get('h1').text()).toBe('old-show artist');
    expect(wrapper.text()).toContain('This concert has finished');
    expect(wrapper.text()).toContain('Your participation is saved as part of this concert');
    expect(wrapper.get('[data-test="proposal"]').text()).toBe('historic-result');
    expect(wrapper.find('a[href="/groups/connect?concertId=old-show"]').exists()).toBe(true);
    expect(wrapper.find('a[href="/messages"]').exists()).toBe(true);
    expect(field(wrapper, 'Preferred section').element.disabled).toBe(true);
    expect(wrapper.findAll('button').some(item => ['Join companion finder', 'Save preferences'].includes(item.text()))).toBe(false);
    expect(wrapper.findAll('a').some(item => ['Join a group', 'Create a group', 'Find my group', 'Browse companions'].includes(item.text()))).toBe(false);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.joinConcert).not.toHaveBeenCalled();
    expect(button(wrapper, 'Leave companion finder').element.disabled).toBe(false);
  });

  it('does not advertise automatic matching on a historical concert with no previous proposals', async () => {
    api.concert.mockResolvedValue(detail('past', '2026-11-03'));
    const { wrapper } = await mountPage(ConcertView, { path: '/concerts/past', props: { id: 'past' }, stubs });
    expect(wrapper.findAll('a').some(item => item.text() === 'Find my group')).toBe(false);
    expect(wrapper.get('.my-result').text()).not.toContain('Join matching and');
    expect(wrapper.get('.my-result').text()).toContain('history');
  });

  it('retains same-day coordination after verified start while preventing late group creation', async () => {
    api.concert.mockResolvedValue(detail('tonight', '2026-11-04', { event_time: '08:00:00' }));
    const { wrapper } = await mountPage(ConcertView, { path: '/concerts/tonight', props: { id: 'tonight' }, stubs });
    expect(button(wrapper, 'Join companion finder').element.disabled).toBe(false);
    expect(wrapper.findAll('a').some(item => item.text() === 'Join a group')).toBe(true);
    expect(wrapper.findAll('a').some(item => item.text() === 'Create a group')).toBe(false);
    expect(wrapper.text()).not.toContain('This concert has finished');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.joinConcert).toHaveBeenCalledWith('tonight', { sectionPref: 'category_1', arrivalPref: 'doors' });
  });

  it('asks for a profile picture before joining the companion finder', async () => {
    currentUser.value = { id: 'viewer', displayName: 'Ari', avatarUrl: null };
    const { wrapper } = await mountPage(ConcertView, { path: '/concerts/show', props: { id: 'show' }, stubs });
    expect(wrapper.get('.kaki-join__picture').text()).toContain('Add a profile picture to join');
    expect(wrapper.get('.kaki-join__picture a').attributes('href')).toBe('/profile');
    expect(button(wrapper, 'Join companion finder').element.disabled).toBe(true);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.joinConcert).not.toHaveBeenCalled();
  });

  it('keeps selected participation inputs after a failed join so a deliberate retry sends the same choices', async () => {
    api.joinConcert.mockRejectedValueOnce(new Error('offline'));
    const { wrapper } = await mountPage(ConcertView, { path: '/concerts/show', props: { id: 'show' }, stubs });
    await field(wrapper, 'Preferred section').setValue('standing_pen');
    await field(wrapper, 'Arrival plan').setValue('early_queue');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.text()).toContain('Could not save your companion-finder preferences');
    expect(field(wrapper, 'Preferred section').element.value).toBe('standing_pen');
    expect(field(wrapper, 'Arrival plan').element.value).toBe('early_queue');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.joinConcert).toHaveBeenNthCalledWith(2, 'show', { sectionPref: 'standing_pen', arrivalPref: 'early_queue' });
    expect(wrapper.text()).not.toContain('Could not save your companion-finder preferences');
  });

  it.each(['resolve', 'reject'])('ignores late %s detail and setlist responses after the concert prop changes', async finish => {
    const oldDetail = deferred(), oldSetlist = deferred();
    api.concert.mockImplementation(id => id === 'old' ? oldDetail.promise : Promise.resolve(detail('new')));
    api.concertSetlist.mockImplementation(id => id === 'old' ? oldSetlist.promise : Promise.resolve({ setlist: { tracks: [{ title: 'New song' }] } }));
    const { wrapper } = await mountPage(ConcertView, { path: '/concerts/old', props: { id: 'old' }, stubs });
    await wrapper.setProps({ id: 'new' }); await flushPromises();
    expect(wrapper.get('h1').text()).toBe('new artist'); expect(wrapper.get('[data-test="setlist"]').text()).toBe('New song');
    if (finish === 'resolve') oldDetail.resolve(detail('old', '2026-11-03'));
    else oldDetail.reject(new Error('old request failed'));
    oldSetlist.resolve({ setlist: { tracks: [{ title: 'Old song' }] } }); await flushPromises();
    expect(wrapper.get('h1').text()).toBe('new artist'); expect(wrapper.get('[data-test="setlist"]').text()).toBe('New song');
    expect(wrapper.text()).not.toContain('Could not load this concert');
    expect(wrapper.text()).not.toContain('This concert has finished');
  });

  it('rechecks eligibility at submission when an open concert page crosses local midnight', async () => {
    api.concert.mockResolvedValue(detail('today', '2026-11-04'));
    const { wrapper } = await mountPage(ConcertView, { path: '/concerts/today', props: { id: 'today' }, stubs });
    expect(button(wrapper, 'Join companion finder').element.disabled).toBe(false);
    vi.setSystemTime(new Date('2026-11-04T16:00:00Z'));
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.joinConcert).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('This concert has finished');
  });
});

describe('live concert eligibility without guessed finish times', () => {
  function eligibilityHarness(source) {
    let state;
    const wrapper = mount(defineComponent({ setup() {
      state = useConcertEligibility(() => source.value);
      return () => h('p', String(state.canCoordinate.value));
    } }));
    return { wrapper, state };
  }

  it('supports camel-case card metadata and keeps an overseas concert day open in its own timezone', () => {
    vi.setSystemTime(new Date('2026-11-04T01:00:00Z'));
    const source = ref({ eventDate: '2026-11-03', eventTimezone: 'America/Los_Angeles', eventTime: '08:00:00' });
    const { state } = eligibilityHarness(source);
    expect(state.canCoordinate.value).toBe(true); expect(state.isFinished.value).toBe(false);
    expect(state.canCreateGroup.value).toBe(false); expect(state.canPlanMeetup.value).toBe(false);
  });

  it('refreshes on focus and removes its timer and listener on unmount', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-11-04T15:59:30Z'));
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
    const { wrapper, state } = eligibilityHarness(ref({ event_date: '2026-11-04' }));
    const handler = add.mock.calls.find(([event]) => event === 'focus')[1];
    expect(state.canCoordinate.value).toBe(true); expect(vi.getTimerCount()).toBe(1);
    vi.setSystemTime(new Date('2026-11-04T16:00:00Z')); window.dispatchEvent(new Event('focus'));
    expect(state.canCoordinate.value).toBe(false); expect(state.isFinished.value).toBe(true);
    wrapper.unmount(); expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('focus', handler);
  });

  it('refreshes a quiet open page across midnight on its existing minute timer', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-11-04T15:59:30Z'));
    const { state } = eligibilityHarness(ref({ event_date: '2026-11-04', doors_time: '18:00' }));
    expect(state.canCoordinate.value).toBe(true); expect(state.canCreateGroup.value).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(state.canCoordinate.value).toBe(false); expect(state.canCreateGroup.value).toBe(false);
  });
});

/**
 * The operator run controls were taken off this page: an operator reads the
 * matching context here and runs a round from the algorithm page instead.
 * These guard the removal, so a stray re-add is caught rather than shipped.
 */
describe('the operator matching panel', () => {
  async function operatorPage() {
    currentUser.value = { id: 'operator', displayName: 'Operator', isOperator: true };
    api.concert.mockImplementation(id => Promise.resolve(detail(id)));
    api.parties.mockResolvedValue({ parties: [{ capacity: 2 }] }); api.requests.mockResolvedValue({ requests: [{}] });
    return mountPage(ConcertView, { path: '/concerts/first', props: { id: 'first' }, stubs });
  }

  it('still shows an operator the matching context', async () => {
    const { wrapper } = await operatorPage();
    expect(wrapper.text()).toContain('Group matching');
    expect(wrapper.text()).toContain('Group places');
  });

  it('carries no run controls and asks the server for nothing', async () => {
    const { wrapper } = await operatorPage();
    for (const label of ['Preview matching', 'Prepare new batch', 'Run matching round']) {
      expect(wrapper.findAll('button').some(item => item.text().includes(label))).toBe(false);
    }
    expect(wrapper.findAll('a').some(item => item.text().includes('Watch it run'))).toBe(false);
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.runMatch).not.toHaveBeenCalled();
  });
});
