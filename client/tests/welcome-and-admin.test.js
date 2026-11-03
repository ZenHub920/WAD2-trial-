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
import WelcomeView from '../src/views/WelcomeView.vue';
import AdminVerificationsView from '../src/views/AdminVerificationsView.vue';
import PreferenceEditor from '../src/components/PreferenceEditor.vue';
import { api } from '../src/api.js';
import { myPreferences, loadMyPreferences, saveMyPreferences } from '../src/groupPreferences.js';
import { mountPage, button } from './helpers.js';

vi.mock('../src/api.js', async (importOriginal) => ({ ...await importOriginal(), api: {
  preferenceConcepts: vi.fn(), preferenceQuiz: vi.fn(),
  verificationQueue: vi.fn(), reviewVerification: vi.fn(),
} }));
vi.mock('../src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'me', displayName: 'Ari' }), sessionReady: ref(true) };
});
vi.mock('../src/groupPreferences.js', async () => {
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
  api.preferenceConcepts.mockResolvedValue({ concepts: [{ id: 'singalong', label: 'Singalong' }] });
  api.preferenceQuiz.mockResolvedValue({ cards: [{ id: 'energy', prompt: 'My concert energy is…', options: [{ id: 'loud', text: 'Loud and lively' }] }] });
  loadMyPreferences.mockImplementation(async () => myPreferences.value);
  saveMyPreferences.mockImplementation(async (answers) => { myPreferences.value = answers; return answers; });
});

describe('WelcomeView', () => {
  it('shows only the private questionnaire, with no banner or explainer panel', async () => {
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome' });
    expect(wrapper.get('h1').text()).toBe('Your matching preferences');
    expect(wrapper.text()).toContain('Private · Only you can see your answers');
    expect(wrapper.text()).not.toContain('What are preferences for?');
    expect(wrapper.text()).not.toContain('Welcome to Encore');
    // No extra click: the editor is already on the page.
    expect(wrapper.findComponent(PreferenceEditor).exists()).toBe(true);
  });

  it('after saving, says preferences can be changed in Profile and continues to ?next=', async () => {
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome?next=%2Fgroups' });
    const editor = wrapper.findComponent(PreferenceEditor);
    await button(editor, 'Loud and lively').trigger('click');
    await editor.get('form').trigger('submit');
    await flushPromises();

    expect(saveMyPreferences).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Your preferences are saved');
    expect(wrapper.text()).toContain('You can change your preferences anytime on your Profile page');
    const links = wrapper.findAll('a');
    expect(links.find((a) => a.text() === 'Continue').attributes('href')).toBe('/groups');
    expect(links.find((a) => a.text() === 'Profile page').attributes('href')).toBe('/profile#preferences');
  });

  it('skipping saves nothing but still points to Profile', async () => {
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome' });
    await button(wrapper, 'Skip for now').trigger('click');
    expect(saveMyPreferences).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('you can do this later');
    expect(wrapper.text()).toContain('You can change your preferences anytime on your Profile page');
    // Without ?next= the member carries on to the concert list.
    expect(wrapper.findAll('a').find((a) => a.text() === 'Continue').attributes('href')).toBe('/concerts');
  });

  it('ignores a ?next= that points to another website', async () => {
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome?next=%2F%2Fevil.example' });
    await button(wrapper, 'Skip for now').trigger('click');
    expect(wrapper.findAll('a').find((a) => a.text() === 'Continue').attributes('href')).toBe('/concerts');
  });

  it('keeps the questionnaire open with an error when saving fails', async () => {
    saveMyPreferences.mockRejectedValue(new Error('offline'));
    const { wrapper } = await mountPage(WelcomeView, { path: '/welcome' });
    const editor = wrapper.findComponent(PreferenceEditor);
    await button(editor, 'Loud and lively').trigger('click');
    await editor.get('form').trigger('submit');
    await flushPromises();
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
