import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import KakiFinderView from '../../client/src/views/KakiFinderView.vue';
import { api } from '../../client/src/api.js';
import { button, field, mountPage } from './helpers.js';

vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: {
  kakiPool: vi.fn(), kakiDecisions: vi.fn(), kakiRecommendations: vi.fn(),
  putKakiDecision: vi.fn(), deleteKakiDecision: vi.fn(),
} }));
vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'viewer', displayName: 'Ari', vibe: {} }), sessionReady: ref(true) };
});

const concerts = [
  { id: 'show-a', artist: 'The Headliners', event_date: '2030-01-01' },
  { id: 'show-b', artist: 'The Headliners', event_date: '2030-01-02' },
  { id: 'show-empty', artist: 'Quiet Artist', event_date: '2030-02-03' },
];
const candidate = {
  id: 'show-a:sam', concertId: 'show-a', artist: 'The Headliners', eventDate: '2030-01-01',
  sectionPref: 'pit', arrivalPref: 'doors',
  user: { id: 'sam', displayName: 'Sam', homeRegion: 'east', ageBand: '21-24', vibe: {} },
};
const choices = (wrapper, label) => field(wrapper, label).findAll('option').map(option => option.attributes('value'));

beforeEach(() => {
  vi.resetAllMocks();
  api.kakiPool.mockResolvedValue({ concerts, people: [candidate] });
  api.kakiDecisions.mockResolvedValue({ decisions: {} });
  api.kakiRecommendations.mockResolvedValue({ people: [candidate], ranked: true, solver: 'existing-solver' });
  api.putKakiDecision.mockResolvedValue({ decision: { decision: 'skip', at: 1, mutual: false } });
  api.deleteKakiDecision.mockResolvedValue(null);
});

describe('Kaki concert context and truthful empty states', () => {
  it('keeps a joined artist/date selectable when there are no eligible profiles for that show', async () => {
    const { wrapper } = await mountPage(KakiFinderView, { path: '/kaki' });
    expect(choices(wrapper, 'Artist')).toEqual(['', 'Quiet Artist', 'The Headliners']);
    await field(wrapper, 'Artist').setValue('Quiet Artist');
    expect(choices(wrapper, 'Concert date')).toEqual(['', '2030-02-03']);
    await field(wrapper, 'Concert date').setValue('2030-02-03');
    expect(wrapper.get('.kaki__empty-note').text()).toContain('No companion profiles are currently available for this concert');
    expect(button(wrapper, 'Find people').element.disabled).toBe(true);
    expect(wrapper.find('.kaki-card').exists()).toBe(false);
    expect(api.kakiRecommendations).not.toHaveBeenCalled();
  });

  it('includes multiple joined dates for one artist and clears a date outside the next artist context', async () => {
    const { wrapper } = await mountPage(KakiFinderView, { path: '/kaki' });
    await field(wrapper, 'Artist').setValue('The Headliners');
    expect(choices(wrapper, 'Concert date')).toEqual(['', '2030-01-01', '2030-01-02']);
    await field(wrapper, 'Concert date').setValue('2030-01-02');
    expect(wrapper.get('.kaki__empty-note').text()).toContain('No companion profiles');
    await field(wrapper, 'Artist').setValue('Quiet Artist');
    expect(field(wrapper, 'Concert date').element.value).toBe('');
  });

  it('uses only an authorized joined concert for existing concert-page preselection and refresh', async () => {
    const { wrapper, router } = await mountPage(KakiFinderView, { path: '/kaki?concertId=show-empty' });
    expect(field(wrapper, 'Artist').element.value).toBe('Quiet Artist');
    expect(field(wrapper, 'Concert date').element.value).toBe('2030-02-03');
    await router.push('/kaki?concertId=not-joined');
    await flushPromises();
    expect(field(wrapper, 'Artist').element.value).toBe('Quiet Artist');
    await router.push('/kaki?concertId=show-a');
    await flushPromises();
    expect(field(wrapper, 'Artist').element.value).toBe('The Headliners');
    expect(field(wrapper, 'Concert date').element.value).toBe('2030-01-01');
    wrapper.unmount();
    const remounted = await mountPage(KakiFinderView, { path: '/kaki?concertId=show-a' });
    expect(field(remounted.wrapper, 'Artist').element.value).toBe('The Headliners');
    expect(field(remounted.wrapper, 'Concert date').element.value).toBe('2030-01-01');
  });

  it('explains no joined concerts and preserves a safe legacy context fallback when the field is absent', async () => {
    api.kakiPool.mockResolvedValueOnce({ concerts: [], people: [] });
    const empty = await mountPage(KakiFinderView, { path: '/kaki?concertId=not-joined' });
    expect(empty.wrapper.get('.kaki__empty-note').text()).toContain('Join an upcoming or ongoing concert');
    expect(empty.wrapper.get('.kaki__empty-note a').attributes('href')).toBe('/concerts');
    expect(field(empty.wrapper, 'Artist').element.disabled).toBe(true);
    expect(button(empty.wrapper, 'Find people').element.disabled).toBe(true);
    api.kakiPool.mockResolvedValueOnce({ people: [candidate] });
    const legacy = await mountPage(KakiFinderView, { path: '/kaki' });
    expect(choices(legacy.wrapper, 'Artist')).toEqual(['', 'The Headliners']);
    expect(button(legacy.wrapper, 'Find people').element.disabled).toBe(false);
  });

  it('distinguishes reviewed profiles from absent candidates and never clears decisions when filters reset', async () => {
    api.kakiDecisions.mockResolvedValue({ decisions: { [candidate.id]: { decision: 'skip', at: 1 } } });
    const { wrapper } = await mountPage(KakiFinderView, { path: '/kaki?concertId=show-a' });
    expect(wrapper.get('.kaki__empty-note').text()).toContain('You’ve reviewed the currently available profiles');
    expect(wrapper.get('.kaki__empty-note a').attributes('href')).toBe('/kaki/history');
    await button(wrapper, 'Reset').trigger('click');
    expect(field(wrapper, 'Artist').element.value).toBe('');
    expect(wrapper.get('.kaki__empty-note').text()).toContain('You’ve reviewed');
    expect(api.deleteKakiDecision).not.toHaveBeenCalled();
    expect(api.putKakiDecision).not.toHaveBeenCalled();
  });

  it('identifies narrow filters and makes Reset restore the available preview', async () => {
    const { wrapper } = await mountPage(KakiFinderView, { path: '/kaki' });
    await wrapper.get('[aria-label="Minimum age"]').setValue('30');
    expect(wrapper.get('.kaki__empty-note').text()).toContain('Try widening the section or age range');
    expect(button(wrapper, 'Find people').element.disabled).toBe(true);
    await button(wrapper, 'Reset').trigger('click');
    expect(wrapper.find('.kaki__empty-note').exists()).toBe(false);
    expect(wrapper.get('.kaki__count').text()).toContain('1 person matches');
  });

  it('uses an honest generic ranked empty state without exposing private compatibility veto details', async () => {
    api.kakiRecommendations.mockResolvedValue({ people: [], ranked: true, vetoed: [{ reason: 'private-answer-marker' }] });
    const { wrapper } = await mountPage(KakiFinderView, { path: '/kaki' });
    await button(wrapper, 'Find people').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('No new compatible profiles were returned');
    expect(wrapper.text()).not.toContain('Nobody else');
    expect(wrapper.text()).not.toContain('private-answer-marker');
  });

  it('retains the existing safe filtered fallback if ranked recommendations cannot load', async () => {
    api.kakiRecommendations.mockRejectedValue(new Error('unavailable'));
    const { wrapper } = await mountPage(KakiFinderView, { path: '/kaki?concertId=show-a' });
    await button(wrapper, 'Find people').trigger('click'); await flushPromises();
    expect(api.kakiRecommendations).toHaveBeenCalledWith({ artist: 'The Headliners', date: '2030-01-01', section: '', ageMin: 18, ageMax: 100 });
    expect(wrapper.text()).toContain('Filtered, not ranked.');
    expect(wrapper.get('.kaki-card__name').text()).toBe('Sam');
  });

  it('ignores a late ranking response after an authorized concert query changes', async () => {
    const other = { ...candidate, id: 'show-b:lee', concertId: 'show-b', eventDate: '2030-01-02', user: { ...candidate.user, id: 'lee', displayName: 'Lee' } };
    api.kakiPool.mockResolvedValue({ concerts, people: [candidate, other] });
    let release;
    api.kakiRecommendations.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValueOnce({ people: [other], ranked: true });
    const { wrapper, router } = await mountPage(KakiFinderView, { path: '/kaki?concertId=show-a' });
    await button(wrapper, 'Find people').trigger('click'); await flushPromises();
    await router.push('/kaki?concertId=show-b'); await flushPromises();
    await button(wrapper, 'Find people').trigger('click'); await flushPromises();
    expect(api.kakiRecommendations).toHaveBeenCalledTimes(2);
    expect(wrapper.get('.kaki-card__name').text()).toBe('Lee');
    release({ people: [candidate], ranked: true }); await flushPromises();
    expect(wrapper.get('.kaki-card__name').text()).toBe('Lee');
  });

  it('retries a failed load without showing a misleading no-concert state', async () => {
    api.kakiPool.mockRejectedValueOnce(new Error('offline'));
    const { wrapper } = await mountPage(KakiFinderView, { path: '/kaki' });
    expect(wrapper.text()).toContain('Could not load the finder');
    expect(wrapper.find('.kaki__empty-note').exists()).toBe(false);
    await button(wrapper, 'Try again').trigger('click'); await flushPromises();
    expect(api.kakiPool).toHaveBeenCalledTimes(2);
    expect(choices(wrapper, 'Artist')).toContain('Quiet Artist');
  });

  it('preserves swipe persistence and undo while the filter context remains independent of decisions', async () => {
    const { wrapper } = await mountPage(KakiFinderView, { path: '/kaki' });
    await button(wrapper, 'Find people').trigger('click'); await flushPromises();
    await wrapper.get('[aria-label="Skip this profile"]').trigger('click'); await flushPromises();
    expect(api.putKakiDecision).toHaveBeenCalledWith('show-a', 'sam', 'skip');
    expect(wrapper.text()).toContain('You’ve reviewed these profiles');
    await wrapper.get('[aria-label="Undo last decision"]').trigger('click'); await flushPromises();
    expect(api.deleteKakiDecision).toHaveBeenCalledWith('show-a', 'sam');
    expect(wrapper.get('.kaki-card__name').text()).toBe('Sam');
    await wrapper.get('[aria-label="Edit filters"]').trigger('click');
    expect(choices(wrapper, 'Artist')).toContain('Quiet Artist');
    expect(wrapper.get('.kaki__count').text()).toContain('1 person matches');
  });
});
