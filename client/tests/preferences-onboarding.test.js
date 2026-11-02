import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ProfileView from '../src/views/ProfileView.vue';
import LoginView from '../src/views/LoginView.vue';
import GroupPreferencesGate from '../src/components/GroupPreferencesGate.vue';
import PreferenceEditor from '../src/components/PreferenceEditor.vue';
import { api } from '../src/api.js';
import { currentUser, sessionReady, setCurrentUser } from '../src/auth.js';
import { myPreferences, loadMyPreferences, saveMyPreferences } from '../src/groupPreferences.js';
import { mountPage, button } from './helpers.js';

vi.mock('../src/api.js', async importOriginal => ({ ...await importOriginal(), api: {
  profile: vi.fn(), updateProfile: vi.fn(), preferenceConcepts: vi.fn(), preferenceQuiz: vi.fn(),
  register: vi.fn(), login: vi.fn(),
} }));
vi.mock('../src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'me', displayName: 'Ari' }), sessionReady: ref(true),
    refreshSession: vi.fn(), setCurrentUser: vi.fn(), signOut: vi.fn() };
});
vi.mock('../src/groupPreferences.js', async () => {
  const { ref } = await import('vue');
  return { myPreferences: ref(null), loadMyPreferences: vi.fn(), saveMyPreferences: vi.fn() };
});
vi.mock('../src/components/ProfileNotifications.vue', () => ({ default: { template: '<div data-notifications>Notifications</div>' } }));

const ownProfile = () => ({ id: 'me', displayName: 'Ari', email: 'ari@example.test', ageBand: '21-24', homeRegion: 'central',
  gender: 'unspecified', companionGenderPref: 'any', languages: ['en'], vibe: { singalong: 4 }, reliability: .75, verified: false });
const existingAnswers = () => ({ about: [{ key: 'singalong', text: 'Singalong', recognized: true }], wants: [], avoid: [], quiz: [], dealbreakers: [] });

beforeEach(() => {
  vi.resetAllMocks();
  currentUser.value = { id: 'me', displayName: 'Ari' };
  sessionReady.value = true;
  myPreferences.value = null;
  api.profile.mockResolvedValue({ profile: ownProfile() });
  api.preferenceConcepts.mockResolvedValue({ concepts: [{ id: 'singalong', label: 'Singalong' }] });
  api.preferenceQuiz.mockResolvedValue({ cards: [{ id: 'energy', prompt: 'My concert energy is…', options: [{ id: 'loud', text: 'Loud and lively' }] }] });
  loadMyPreferences.mockImplementation(async () => myPreferences.value);
  saveMyPreferences.mockImplementation(async answers => { myPreferences.value = answers; return answers; });
});

describe('private questionnaire placement', () => {
  it('shows a compact profile reminder and keeps group content usable while preferences load', async () => {
    let resolve;
    myPreferences.value = undefined;
    loadMyPreferences.mockImplementation(() => new Promise(done => { resolve = done; }));
    const wrapper = mount(GroupPreferencesGate, { slots: { default: '<button>Browse groups</button>' }, global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
    expect(wrapper.text()).toContain('Browse groups');
    expect(wrapper.findComponent(PreferenceEditor).exists()).toBe(false);
    myPreferences.value = existingAnswers(); resolve(myPreferences.value);
    await flushPromises();
    expect(wrapper.text()).toContain('Edit in Profile');
    expect(wrapper.text()).not.toContain('Singalong');
    expect(wrapper.findComponent(PreferenceEditor).exists()).toBe(false);
  });

  it('keeps browsing available after a preference-loading failure', async () => {
    myPreferences.value = undefined;
    loadMyPreferences.mockRejectedValue(new Error('offline'));
    const wrapper = mount(GroupPreferencesGate, { slots: { default: '<button>Browse groups</button>' }, global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
    await flushPromises();
    expect(wrapper.text()).toContain('Browse groups');
    expect(wrapper.text()).toContain('You can still browse and choose a group');
  });

  it('reveals the unchanged editor only when existing users edit their private answers', async () => {
    myPreferences.value = existingAnswers();
    const { wrapper } = await mountPage(ProfileView, { path: '/profile#preferences' });
    expect(wrapper.text()).toContain('Only you can see your answers');
    expect(wrapper.findComponent(PreferenceEditor).exists()).toBe(false);
    await button(wrapper, 'Edit private preferences').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(PreferenceEditor).props('initial')).toEqual(existingAnswers());
    expect(wrapper.findComponent(PreferenceEditor).exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Mark important');
  });

  it('lets a new member skip setup without saving answers or losing their original destination', async () => {
    const { wrapper, router } = await mountPage(ProfileView, { path: '/profile?setup=1&next=%2Fgroups%3FconcertId%3Dc1#preferences' });
    expect(wrapper.get('h1').text()).toBe('Make it feel like you');
    expect(wrapper.find('[data-notifications]').exists()).toBe(false);
    expect(wrapper.find('#profile-form').exists()).toBe(false);
    await button(wrapper, 'Skip for now').trigger('click');
    await flushPromises();
    expect(saveMyPreferences).not.toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe('/groups?concertId=c1');
  });

  it('saves partial setup through the existing fields before continuing', async () => {
    const { wrapper, router } = await mountPage(ProfileView, { path: '/profile?setup=1#preferences' });
    const editor = wrapper.findComponent(PreferenceEditor);
    await button(editor, 'Loud and lively').trigger('click');
    await editor.get('form').trigger('submit');
    await flushPromises();
    expect(saveMyPreferences).toHaveBeenCalledWith({ quiz: [{ card: 'energy', option: 'loud' }], dealbreakers: [], about: [], wants: [], avoid: [] });
    expect(router.currentRoute.value.path).toBe('/concerts');
  });
});

describe('registration handoff', () => {
  it('creates the account with existing fields, then offers optional private setup', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    api.register.mockResolvedValue({ user: { id: 'new-person', displayName: 'New Ari' } });
    const { wrapper, router } = await mountPage(LoginView, { path: '/login?redirect=%2Fgroups' });
    await wrapper.get('[role="tab"][aria-selected="false"]').trigger('click');
    await wrapper.get('#display-name').setValue('New Ari');
    await wrapper.get('#email').setValue('new@example.test');
    await wrapper.get('#password').setValue('example-password');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.register).toHaveBeenCalledWith({ display_name: 'New Ari', email: 'new@example.test', password: 'example-password' });
    expect(setCurrentUser).toHaveBeenCalledWith({ id: 'new-person', displayName: 'New Ari' });
    await vi.advanceTimersByTimeAsync(500); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/profile');
    expect(router.currentRoute.value.query).toEqual({ setup: '1', next: '/groups' });
    expect(router.currentRoute.value.hash).toBe('#preferences');
  });
});
