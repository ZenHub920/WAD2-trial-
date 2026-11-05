/**
 * Integration tests for the two pages added after the Tickets tab:
 *   - WelcomeView: the preference questionnaire new members see right after sign-up.
 *   - AdminVerificationsView: where an admin approves or rejects proof of purchase.
 *
 * The api object and the preference store are mocked, so these tests check
 * what each page shows and which calls it makes, not the server.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import WelcomeView from '../../client/src/views/WelcomeView.vue';
import AdminVerificationsView from '../../client/src/views/AdminVerificationsView.vue';
import PreferenceEditor from '../../client/src/components/PreferenceEditor.vue';
import { api } from '../../client/src/api.js';
import { myPreferences, loadMyPreferences, saveMyPreferences } from '../../client/src/groupPreferences.js';
import { mountPage, button } from './helpers.js';
import { currentUser } from '../../client/src/auth.js';

const VIBE = { singalong: 2, photography: 1, dancing: 3, quiet: 0, queue_early: 2, merch: 1 };

vi.mock('../../client/src/api.js', async (importOriginal) => ({ ...await importOriginal(), api: {
  preferenceConcepts: vi.fn(), preferenceQuiz: vi.fn(), updateProfile: vi.fn(),
  verificationQueue: vi.fn(), reviewVerification: vi.fn(),
} }));
vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  const currentUser = ref(null);
  return { currentUser, sessionReady: ref(true), setCurrentUser: user => { currentUser.value = user; } };
});
vi.mock('../../client/src/groupPreferences.js', async () => {
  const { ref } = await import('vue');
  return { myPreferences: ref(null), loadMyPreferences: vi.fn(), saveMyPreferences: vi.fn() };
});

// A pending listing as the admin queue returns it, proof attached.
const pending = (id = 't1') => ({
  id, priceCents: 12000, quantity: 2, section: 'vip', createdAt: '2026-11-01 10:00:00',
  concert: { id: 'c1', artist: 'Bruno Mars', venue: 'National Stadium', event_date: '2027-04-18' },
  seller: { id: 's1', displayName: 'Sam' },
  verification: { status: 'pending' },
  proofData: 'data:image/png;base64,AAAA',
});

beforeEach(() => {
  vi.resetAllMocks();
  myPreferences.value = null;
  // Most tests are about preferences, so the vibe is already rated.
  currentUser.value = { id: 'me', displayName: 'Ari', vibe: VIBE };
  api.preferenceConcepts.mockResolvedValue({ concepts: [{ id: 'singalong', label: 'Singalong' }] });
  api.preferenceQuiz.mockResolvedValue({ cards: [{ id: 'energy', prompt: 'My concert energy is…', options: [{ id: 'loud', text: 'Loud and lively' }] }] });
  loadMyPreferences.mockImplementation(async () => myPreferences.value);
  saveMyPreferences.mockImplementation(async (answers) => { myPreferences.value = answers; return answers; });
});


/** Answer one sentence, then press Next through the tabs to finish (answers autosave). */
async function finishPreferences(wrapper) {
  const editor = wrapper.findComponent(PreferenceEditor);
  await button(editor, 'Loud and lively').trigger('click');
  for (let tab = 0; tab < 3; tab++) await button(editor, 'Next').trigger('click');
  await button(editor, 'Next: your concert vibe').trigger('click');
  await flushPromises();
}

describe('WelcomeView', () => {
  it('shows only the private questionnaire, with no banner or explainer panel', async () => {
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome' });
    expect(wrapper.get('h1').text()).toBe('Your matching preferences');
    expect(wrapper.text()).not.toContain('Private · Only you can see your answers');
    expect(wrapper.text()).not.toContain('What are preferences for?');
    expect(wrapper.text()).not.toContain('Welcome to Encore');
    // No extra click: the editor is already on the page.
    expect(wrapper.findComponent(PreferenceEditor).exists()).toBe(true);
  });

  it('after saving, says preferences can be changed in Profile and continues to ?next=', async () => {
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome?next=%2Fgroups' });
    await finishPreferences(wrapper);

    expect(saveMyPreferences).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("You're all set");
    expect(wrapper.text()).toContain('You can change your preferences and vibe anytime on your Profile page');
    const links = wrapper.findAll('a');
    expect(links.find((a) => a.text() === 'Continue').attributes('href')).toBe('/groups');
    expect(links.find((a) => a.text() === 'Profile page').attributes('href')).toBe('/profile#preferences');
  });

  it('cannot be skipped: there is no skip button and it says saving is required', async () => {
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome' });
    expect(wrapper.findAll('button').some((b) => b.text() === 'Skip for now')).toBe(false);
    expect(wrapper.get('.welcome__required').text()).toContain('Pick at least one thing to start using Encore');
  });

  async function saveOne(wrapper) {
    await finishPreferences(wrapper);
  }

  it('continues to the concert list when there is no ?next=', async () => {
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome' });
    await saveOne(wrapper);
    expect(wrapper.findAll('a').find((a) => a.text() === 'Continue').attributes('href')).toBe('/concerts');
  });

  it('ignores a ?next= that points to another website', async () => {
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome?next=%2F%2Fevil.example' });
    await saveOne(wrapper);
    expect(wrapper.findAll('a').find((a) => a.text() === 'Continue').attributes('href')).toBe('/concerts');
  });

  it('asks for the six concert-vibe ratings after preferences, then continues', async () => {
    currentUser.value = { id: 'me', displayName: 'Ari', vibe: {} };
    api.updateProfile.mockResolvedValue({ profile: {} });
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome?next=%2Fgroups' });
    await saveOne(wrapper);
    expect(wrapper.get('h1').text()).toBe('Your concert vibe');
    const sliders = wrapper.findAll('input[type="range"]');
    expect(sliders).toHaveLength(6);
    await sliders[0].setValue(4);
    await button(wrapper, 'Save my vibe').trigger('click'); await flushPromises();
    expect(api.updateProfile).toHaveBeenCalledExactlyOnceWith({ vibe: { singalong: 4, photography: 2, dancing: 2, quiet: 2, queue_early: 2, merch: 2 } });
    expect(currentUser.value.vibe.singalong).toBe(4);
    expect(wrapper.text()).toContain("You're all set");
    expect(wrapper.findAll('a').find((a) => a.text() === 'Continue').attributes('href')).toBe('/groups');
  });

  it('goes straight to the vibe step when preferences are already saved', async () => {
    currentUser.value = { id: 'me', displayName: 'Ari', vibe: {} };
    myPreferences.value = { about: [{ conceptId: 'singalong' }], wants: [], avoid: [] };
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome' });
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('Your concert vibe');
    expect(wrapper.findComponent(PreferenceEditor).exists()).toBe(false);
  });

  it('starts a new member on About you, requires a language, then moves on to preferences', async () => {
    currentUser.value = { id: 'me', displayName: 'Ari', vibe: VIBE, aboutComplete: false };
    api.updateProfile.mockResolvedValue({ profile: {} });
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome' });
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('About you');
    expect(wrapper.find('input[type="text"]').exists()).toBe(false); // no display name: it was asked at sign-up
    const selects = wrapper.findAll('select');
    expect(selects).toHaveLength(4);
    for (const [select, value] of [[selects[0], '25-29'], [selects[1], 'east'], [selects[2], 'f'], [selects[3], 'any']]) await select.setValue(value);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.text()).toContain('Choose at least one language.');
    expect(api.updateProfile).not.toHaveBeenCalled();
    await wrapper.get('input[type="checkbox"][value="en"]').setValue(true);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.updateProfile).toHaveBeenCalledExactlyOnceWith({ ageBand: '25-29', homeRegion: 'east', gender: 'f', companionGenderPref: 'any', languages: ['en'] });
    expect(currentUser.value.aboutComplete).toBe(true);
    expect(wrapper.get('h1').text()).toBe('Your matching preferences');
  });

  it('saves answers as they change, with no Save button', async () => {
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome' });
    const editor = wrapper.findComponent(PreferenceEditor);
    expect(editor.findAll('button').some((b) => b.text() === 'Save preferences')).toBe(false);
    await button(editor, 'Loud and lively').trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 800)); await flushPromises();
    expect(saveMyPreferences).toHaveBeenCalledOnce();
    expect(editor.text()).toContain('Saved');
  });

  it('keeps the questionnaire open with an error when saving fails', async () => {
    saveMyPreferences.mockRejectedValue(new Error('offline'));
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome' });
    await finishPreferences(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not save your answers');
    expect(wrapper.findComponent(PreferenceEditor).exists()).toBe(true);
  });
});

// The page links to the named ticket-detail route, which the test router does not define.
const linkStub = { template: '<a><slot /></a>' };

describe('AdminVerificationsView', () => {
  it('shows the pending proof with counts for each tab', async () => {
    api.verificationQueue.mockResolvedValue({
      listings: [pending()],
      recent: [{ ...pending('t9'), verification: { status: 'approved', reviewedAt: '2026-11-02 09:00:00' } }],
    });
    const { wrapper } = await mountPage(AdminVerificationsView, { path: '/admin/verifications', stubs: { RouterLink: linkStub } });
    expect(wrapper.get('h1').text()).toBe('Proof of purchase');
    expect(wrapper.get('img').attributes('src')).toBe('data:image/png;base64,AAAA');
    expect(wrapper.get('#admin-tab-pending').text()).toContain('1');
    expect(wrapper.text()).toContain('Recently approved');
  });

  it('approving removes the listing from Pending and adds it to Recent decisions', async () => {
    api.verificationQueue.mockResolvedValue({ listings: [pending()], recent: [] });
    api.reviewVerification.mockResolvedValue({ listing: { ...pending(), verification: { status: 'approved' } } });
    const { wrapper } = await mountPage(AdminVerificationsView, { path: '/admin/verifications', stubs: { RouterLink: linkStub } });

    await button(wrapper, 'Approve').trigger('click');
    await flushPromises();

    expect(api.reviewVerification).toHaveBeenCalledWith('t1', 'approve', '');
    expect(wrapper.text()).toContain('Nothing to review');
    // No separate "… approved." banner: the queue and history already show the result.
    expect(wrapper.text()).not.toContain('approved.');
    await wrapper.get('#admin-tab-history').trigger('click');
    expect(wrapper.get('#admin-panel-history').text()).toContain('Approved');
  });

  it('will not reject without a note for the seller', async () => {
    api.verificationQueue.mockResolvedValue({ listings: [pending()], recent: [] });
    const { wrapper } = await mountPage(AdminVerificationsView, { path: '/admin/verifications', stubs: { RouterLink: linkStub } });
    await button(wrapper, 'Reject').trigger('click');
    expect(api.reviewVerification).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toContain('Tell the seller what is wrong');
  });

  it('tells non-admins the page is for admins only', async () => {
    api.verificationQueue.mockRejectedValue(Object.assign(new Error('operator_required'), { status: 403 }));
    const { wrapper } = await mountPage(AdminVerificationsView, { path: '/admin/verifications', stubs: { RouterLink: linkStub } });
    expect(wrapper.text()).toContain('Admins only');
    expect(wrapper.find('#admin-tab-pending').exists()).toBe(false);
  });
});
