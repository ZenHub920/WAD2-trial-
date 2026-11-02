import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import VibeChart from '../src/components/VibeChart.vue';
import PublicProfileView from '../src/views/PublicProfileView.vue';
import { mountPage } from './helpers.js';
import { api } from '../src/api.js';

vi.mock('../src/api.js', async importOriginal => ({ ...await importOriginal(), api: { publicProfile: vi.fn() } }));
vi.mock('../src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'viewer' }) };
});
const publicPerson = (id = 'person') => ({ id, displayName: 'Ari Tan', avatarUrl: null,
  ageBand: '21-24', languages: ['en', 'zh'], verified: true, hasVibeRatings: true,
  vibe: { singalong: 4, photography: 2, dancing: 3, quiet: 1, queue_early: 3, merch: 0 } });
beforeEach(() => vi.resetAllMocks());

describe('public concert vibe', () => {
  it('renders six self-rated axes and an accessible text equivalent without invalid SVG coordinates', () => {
    const chart = mount(VibeChart, { props: { vibe: { singalong: 4, dancing: -2, photography: NaN, quiet: 99 } } });
    expect(chart.get('svg').attributes('aria-label')).toContain('Singalong 4 of 4');
    expect(chart.get('svg').attributes('aria-label')).toContain('Quiet listening 4 of 4');
    expect(chart.get('svg').attributes('aria-label')).toContain('Dancing 0 of 4');
    const coordinates = chart.get('.radar__shape').attributes('points');
    expect(coordinates.split(' ')).toHaveLength(6);
    expect(coordinates).not.toMatch(/NaN|Infinity/);
  });

  it('shows the profile chart, top interests and full ratings while explaining the privacy boundary', async () => {
    api.publicProfile.mockResolvedValue({ profile: publicPerson() });
    const { wrapper } = await mountPage(PublicProfileView, { props: { id: 'person' } });
    expect(api.publicProfile).toHaveBeenCalledWith('person');
    expect(wrapper.get('h1').text()).toBe('Ari Tan');
    expect(wrapper.findAll('.public-profile__highlights li')).toHaveLength(3);
    expect(wrapper.get('svg.radar').attributes('aria-label')).toContain('Vibe profile:');
    expect(wrapper.findAll('dl > div')).toHaveLength(6);
    expect(wrapper.text()).toContain('Private matching answers and dealbreakers are not shown.');
    expect(wrapper.find('input, textarea, select').exists()).toBe(false);
  });

  it('does not present an unanswered vibe as a measured all-zero personality', async () => {
    api.publicProfile.mockResolvedValue({ profile: { ...publicPerson(), hasVibeRatings: false, vibe: { dancing: 0 } } });
    const { wrapper } = await mountPage(PublicProfileView, { props: { id: 'person' } });
    expect(wrapper.text()).toContain('They have not added a concert vibe yet.');
    expect(wrapper.findComponent(VibeChart).exists()).toBe(false);
  });

  it('keeps explicitly saved zero ratings distinct from an unanswered profile', async () => {
    api.publicProfile.mockResolvedValue({ profile: { ...publicPerson(), vibe: Object.fromEntries(Object.keys(publicPerson().vibe).map(axis => [axis, 0])) } });
    const { wrapper } = await mountPage(PublicProfileView, { props: { id: 'person' } });
    expect(wrapper.findComponent(VibeChart).exists()).toBe(true);
    expect(wrapper.text()).not.toContain('not added');
    expect(wrapper.findAll('.public-profile__highlights li')).toHaveLength(0);
  });

  it('clears the previous profile immediately and ignores late responses when navigating between people', async () => {
    let resolveFirst;
    api.publicProfile.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ profile: { ...publicPerson('second'), displayName: 'Second Person' } });
    const { wrapper } = await mountPage(PublicProfileView, { props: { id: 'first' } });
    await wrapper.setProps({ id: 'second' });
    await flushPromises();
    resolveFirst({ profile: publicPerson('first') });
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('Second Person');
    expect(wrapper.text()).not.toContain('Ari Tan');
  });

  it('uses a neutral unavailable state for missing or blocked profiles', async () => {
    api.publicProfile.mockRejectedValue(Object.assign(new Error('profile_unavailable'), { status: 404 }));
    const { wrapper } = await mountPage(PublicProfileView, { props: { id: 'person' } });
    expect(wrapper.get('[role="alert"]').text()).toContain('This profile is unavailable');
    expect(wrapper.text()).not.toContain('blocked');
    expect(wrapper.findComponent(VibeChart).exists()).toBe(false);
  });
});
