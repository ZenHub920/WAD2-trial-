/**
 * Week 10b: component and integration tests for the profile page.
 *
 * Component tests mount ProfileView on its own, with its children replaced by
 * stubs, and drive it only through what a user can see and do: typing in a
 * field, choosing a language, pressing Save. Nothing here reaches the network -
 * the API module is mocked - so each test states exactly what the server
 * answered and checks what the page then shows.
 *
 * The integration tests at the bottom mount ProfileView together with the real
 * ProfileNotifications child, to check the two sections coexist and that
 * saving one does not save the other.
 *
 * Run with `npm test` from client/.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ProfileView from '../src/views/ProfileView.vue';
import { api } from '../src/api.js';
import { currentUser, setCurrentUser } from '../src/auth.js';
import { loadMyPreferences } from '../src/groupPreferences.js';
import { browserPushStatus, disableBrowserPush } from '../src/browserPush.js';
import { button, field, mountPage } from './helpers.js';

vi.mock('../src/api.js', async original => ({ ...await original(), api: {
  profile: vi.fn(), updateProfile: vi.fn(), setAvatar: vi.fn(), clearAvatar: vi.fn(),
  me: vi.fn(), logout: vi.fn(),
  notificationSettings: vi.fn(), saveNotificationSettings: vi.fn(),
} }));
vi.mock('../src/browserPush.js', () => ({
  browserPushStatus: vi.fn(), enableBrowserPush: vi.fn(), disableBrowserPush: vi.fn(),
}));
// The questionnaire is its own feature with its own tests; the profile page
// only has to render it, so its store is faked and its editor stubbed out.
vi.mock('../src/groupPreferences.js', async () => {
  const { ref } = await import('vue');
  return { myPreferences: ref(null), loadMyPreferences: vi.fn(), saveMyPreferences: vi.fn() };
});

const SIGNED_IN = { id: 'user-1', displayName: 'Alice Tan', email: 'alice@example.test', avatarUrl: null };

/** What GET /me/profile answers. Overrides let one test change one field. */
const savedProfile = (overrides = {}) => ({
  id: 'user-1',
  displayName: 'Alice Tan',
  email: 'alice@example.test',
  ageBand: '21-24',
  homeRegion: 'central',
  gender: 'f',
  companionGenderPref: 'any',
  languages: ['en'],
  vibe: { singalong: 3, photography: 1, dancing: 2, quiet: 0, queue_early: 4, merch: 2 },
  reliability: 0.82,
  verified: true,
  ...overrides,
});

const failure = (status, message = 'request_failed') => Object.assign(new Error(message), { status });

/**
 * A custom stub that echoes the props it was given, so a test can prove that
 * ProfileView handed the picture control the right name without running the
 * real file-reading component.
 */
const AvatarStub = {
  props: ['src', 'name', 'busy'],
  emits: ['select', 'remove'],
  template: '<div class="avatar-stub">'
    + '<span>Picture for {{ name }}</span>'
    + '<button type="button" @click="$emit(\'select\', \'data:image/png;base64,QUJD\')">Choose picture</button>'
    + '<button type="button" @click="$emit(\'remove\')">Remove picture</button>'
    + '</div>',
};

/** ProfileView alone: every child it owns is replaced. */
const isolated = { AvatarPicker: AvatarStub, PreferenceEditor: true, ProfileNotifications: true };

const openProfile = (stubs = isolated) => mountPage(ProfileView, { path: '/profile', stubs });

beforeEach(() => {
  vi.resetAllMocks();
  api.profile.mockResolvedValue({ profile: savedProfile() });
  api.updateProfile.mockImplementation(async changes => ({ profile: savedProfile(changes) }));
  api.me.mockResolvedValue({ user: SIGNED_IN });
  api.logout.mockResolvedValue({});
  api.notificationSettings.mockResolvedValue({ preferences: { chat: true, group: true, match: true, meetup: true, feedback: true } });
  api.saveNotificationSettings.mockResolvedValue({});
  browserPushStatus.mockResolvedValue({ supported: true, configured: true, enabled: false });
  disableBrowserPush.mockResolvedValue(undefined);
  loadMyPreferences.mockResolvedValue(null);
  setCurrentUser({ ...SIGNED_IN });
});

/* ------------------------------------------------------------------ *
 * Component tests: ProfileView in isolation
 *
 * | Test | Input                           | Expected output                        |
 * | ---- | ------------------------------- | -------------------------------------- |
 * | (1)  | profile loads                   | saved values fill the form             |
 * | (2)  | profile loads                   | the picture control gets the user name |
 * | (3)  | load answers 401                | "Sign in to see your profile."         |
 * | (4)  | load fails, then Retry          | the form appears                       |
 * | (5)  | display name blank + Save       | "Enter a display name.", no request    |
 * | (6)  | no language chosen + Save       | "Choose at least one language."        |
 * | (7)  | edited fields + Save            | PATCH sent trimmed, "Profile saved"    |
 * | (8)  | save answers 401                | expired-session message + sign-in link |
 * | (9)  | a picture is chosen             | sent at once, profile PATCH untouched  |
 * | (10) | the picture is rejected         | "That file is not a readable image."   |
 * | (11) | Log out                         | session cleared, back to the home page |
 * ------------------------------------------------------------------ */
describe('profile page (component tests)', () => {
  it('(1) fills the form with the profile the server returned', async () => {
    const { wrapper } = await openProfile();
    expect(field(wrapper, 'Display name').element.value).toBe('Alice Tan');
    expect(field(wrapper, 'Email').element.value).toBe('alice@example.test');
    expect(field(wrapper, 'Age range').element.value).toBe('21-24');
    expect(field(wrapper, 'Home region').element.value).toBe('central');
    expect(field(wrapper, 'English').element.checked).toBe(true);
    expect(field(wrapper, 'Chinese').element.checked).toBe(false);
    expect(field(wrapper, 'Singalong').element.value).toBe('3');
    expect(wrapper.text()).toContain('Profile verified');
    expect(wrapper.text()).toContain('Reliability 82%');
  });

  it('(2) shows the email as read-only and passes the signed-in name to the picture control', async () => {
    const { wrapper } = await openProfile();
    expect(field(wrapper, 'Email').attributes('readonly')).toBeDefined();
    expect(wrapper.text()).toContain('Picture for Alice Tan');
  });

  it('(3) asks a signed-out visitor to sign in', async () => {
    setCurrentUser(null);
    api.profile.mockRejectedValue(failure(401, 'unauthorized'));
    const { wrapper } = await openProfile();
    expect(wrapper.get('[role="alert"]').text()).toContain('Sign in to see your profile.');
    expect(wrapper.findAll('a').some(link => link.attributes('href') === '/login')).toBe(true);
    expect(wrapper.find('form#profile-form').exists()).toBe(false);
  });

  it('(4) offers Retry after a failed load and shows the form once it succeeds', async () => {
    api.profile.mockRejectedValueOnce(failure(500));
    const { wrapper } = await openProfile();
    expect(wrapper.text()).toContain('Could not load your profile. Please try again.');
    await button(wrapper, 'Retry').trigger('click');
    await flushPromises();
    expect(field(wrapper, 'Display name').element.value).toBe('Alice Tan');
  });

  it('(5) refuses to save a blank display name', async () => {
    const { wrapper } = await openProfile();
    await field(wrapper, 'Display name').setValue('   ');
    await button(wrapper, 'Save profile').trigger('click');
    await flushPromises();
    expect(wrapper.get('.profile__actions [role="alert"]').text()).toContain('Enter a display name.');
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('(6) refuses to save with no language chosen', async () => {
    const { wrapper } = await openProfile();
    await field(wrapper, 'English').setValue(false);
    await button(wrapper, 'Save profile').trigger('click');
    await flushPromises();
    expect(wrapper.get('.profile__actions [role="alert"]').text()).toContain('Choose at least one language.');
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('(7) saves the edited profile with the name trimmed and confirms it', async () => {
    const { wrapper } = await openProfile();
    await field(wrapper, 'Display name').setValue('  Jamie Tan  ');
    await field(wrapper, 'Age range').setValue('25-29');
    await field(wrapper, 'Home region').setValue('west');
    await field(wrapper, 'Chinese').setValue(true);
    await field(wrapper, 'Singalong').setValue('4');
    await button(wrapper, 'Save profile').trigger('click');
    await flushPromises();

    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    expect(api.updateProfile.mock.calls[0][0]).toMatchObject({
      displayName: 'Jamie Tan',
      ageBand: '25-29',
      homeRegion: 'west',
      languages: ['en', 'zh'],
      vibe: expect.objectContaining({ singalong: 4 }),
    });
    expect(wrapper.get('.profile__actions [role="status"]').text()).toContain('Profile saved');
  });

  it('(8) explains an expired session instead of losing the edit', async () => {
    api.updateProfile.mockRejectedValue(failure(401, 'unauthorized'));
    const { wrapper } = await openProfile();
    await field(wrapper, 'Display name').setValue('Jamie Tan');
    await button(wrapper, 'Save profile').trigger('click');
    await flushPromises();
    const notice = wrapper.get('.profile__actions [role="alert"]');
    expect(notice.text()).toContain('Your session has expired. Sign in again to edit your profile.');
    expect(notice.find('a').attributes('href')).toBe('/login');
    expect(field(wrapper, 'Display name').element.value).toBe('Jamie Tan');
  });

  it('(9) applies a chosen picture at once, without waiting for Save', async () => {
    api.setAvatar.mockResolvedValue({ user: { ...SIGNED_IN, avatarUrl: 'https://cdn.test/a.png' } });
    const { wrapper } = await openProfile();
    await button(wrapper, 'Choose picture').trigger('click');
    await flushPromises();
    expect(api.setAvatar).toHaveBeenCalledExactlyOnceWith('data:image/png;base64,QUJD');
    expect(currentUser.value.avatarUrl).toBe('https://cdn.test/a.png');
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('(10) explains a picture the server could not read', async () => {
    api.setAvatar.mockRejectedValue(new Error('invalid_image'));
    const { wrapper } = await openProfile();
    await button(wrapper, 'Choose picture').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('That file is not a readable image.');
  });

  it('(11) logs out and returns to the home page', async () => {
    const { wrapper, router } = await openProfile();
    await button(wrapper, 'Log out').trigger('click');
    await flushPromises();
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(currentUser.value).toBe(null);
    expect(router.currentRoute.value.path).toBe('/');
  });
});

/* ------------------------------------------------------------------ *
 * Integration tests: ProfileView together with the real ProfileNotifications
 *
 * | Test | Input                            | Expected output                         |
 * | ---- | -------------------------------- | --------------------------------------- |
 * | (1)  | page opens signed in             | both sections render, categories loaded |
 * | (2)  | a category is unticked and saved | only the notification request is sent   |
 * | (3)  | the profile is saved             | only the profile request is sent        |
 * | (4)  | page opens signed out            | no notification section at all          |
 * ------------------------------------------------------------------ */
describe('profile page with its notification section (integration tests)', () => {
  const withNotifications = { AvatarPicker: AvatarStub, PreferenceEditor: true };

  it('(1) renders the profile form and the notification preferences together', async () => {
    const { wrapper } = await openProfile(withNotifications);
    expect(field(wrapper, 'Display name').element.value).toBe('Alice Tan');
    expect(wrapper.get('#notifications').text()).toContain('Notification preferences');
    expect(wrapper.text()).toContain('Companion and ticket messages');
    expect(api.notificationSettings).toHaveBeenCalledTimes(1);
  });

  it('(2) saves notification categories without touching the profile', async () => {
    const { wrapper } = await openProfile(withNotifications);
    await field(wrapper, 'Companion and ticket messages').setValue(false);
    await button(wrapper, 'Save notification preferences').trigger('click');
    await flushPromises();
    expect(api.saveNotificationSettings).toHaveBeenCalledExactlyOnceWith(
      { chat: false, group: true, match: true, meetup: true, feedback: true },
    );
    expect(api.updateProfile).not.toHaveBeenCalled();
    expect(wrapper.get('#notifications [role="status"]').text()).toContain('Notification preferences saved.');
  });

  it('(3) saves the profile without touching the notification categories', async () => {
    const { wrapper } = await openProfile(withNotifications);
    await field(wrapper, 'Display name').setValue('Jamie Tan');
    await button(wrapper, 'Save profile').trigger('click');
    await flushPromises();
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    expect(api.saveNotificationSettings).not.toHaveBeenCalled();
  });

  it('(4) leaves the notification section out for a signed-out visitor', async () => {
    setCurrentUser(null);
    api.profile.mockRejectedValue(failure(401, 'unauthorized'));
    const { wrapper } = await openProfile(withNotifications);
    expect(wrapper.find('#notifications').exists()).toBe(false);
    expect(api.notificationSettings).not.toHaveBeenCalled();
  });
});
