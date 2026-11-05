/**
 * Unit tests for the router gate: sign-in for protected pages, then saved
 * preferences and concert vibe before a signed-in member can open anything else.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { guardRoute } from '../../client/src/routeGuards.js';
import { currentUser, sessionReady } from '../../client/src/auth.js';
import { loadMyPreferences } from '../../client/src/groupPreferences.js';

vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref(null), sessionReady: ref(true) };
});
vi.mock('../../client/src/groupPreferences.js', () => ({ loadMyPreferences: vi.fn() }));

const route = (name, fullPath, meta = {}) => ({ name, fullPath, meta });
// A member who has saved all six concert-vibe ratings.
const VIBE = { singalong: 2, photography: 1, dancing: 3, quiet: 0, queue_early: 2, merch: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  currentUser.value = null;
  sessionReady.value = true;
});

describe('guardRoute', () => {
  it('lets signed-out visitors open public pages', async () => {
    expect(await guardRoute(route('concerts', '/concerts'))).toBe(true);
    expect(loadMyPreferences).not.toHaveBeenCalled();
  });

  it('sends signed-out visitors on protected pages to sign in', async () => {
    expect(await guardRoute(route('kaki', '/kaki', { requiresAuth: true })))
      .toEqual({ path: '/login', query: { redirect: '/kaki' } });
  });

  it('sends a signed-in member without preferences to /welcome, remembering where they were going', async () => {
    currentUser.value = { id: 'me', vibe: VIBE };
    loadMyPreferences.mockResolvedValue(null);
    expect(await guardRoute(route('concert', '/concerts/c1')))
      .toEqual({ name: 'welcome', query: { next: '/concerts/c1' } });
  });

  it('still opens the welcome and sign-in pages before preferences are saved', async () => {
    currentUser.value = { id: 'me', vibe: VIBE };
    loadMyPreferences.mockResolvedValue(null);
    for (const name of ['welcome', 'login']) {
      expect(await guardRoute(route(name, `/${name}`))).toBe(true);
    }
    expect(loadMyPreferences).not.toHaveBeenCalled();
  });

  it('sends a member who has not rated their concert vibe to /welcome, even with preferences saved', async () => {
    currentUser.value = { id: 'me', vibe: { singalong: 2 } };
    loadMyPreferences.mockResolvedValue({ concepts: ['singalong'] });
    expect(await guardRoute(route('groups', '/groups', { requiresAuth: true })))
      .toEqual({ name: 'welcome', query: { next: '/groups' } });
  });

  it('sends a new member who has not saved About you to /welcome', async () => {
    currentUser.value = { id: 'me', vibe: VIBE, aboutComplete: false };
    loadMyPreferences.mockResolvedValue({ concepts: ['singalong'] });
    expect(await guardRoute(route('tickets', '/tickets')))
      .toEqual({ name: 'welcome', query: { next: '/tickets' } });
  });

  it('lets a member with saved preferences through', async () => {
    currentUser.value = { id: 'me', vibe: VIBE };
    loadMyPreferences.mockResolvedValue({ concepts: ['singalong'] });
    expect(await guardRoute(route('groups', '/groups', { requiresAuth: true }))).toBe(true);
  });

  it('does not lock members out when the preference check fails', async () => {
    currentUser.value = { id: 'me', vibe: VIBE };
    loadMyPreferences.mockRejectedValue(new Error('offline'));
    expect(await guardRoute(route('groups', '/groups'))).toBe(true);
  });

  it('waits for the session check before deciding', async () => {
    sessionReady.value = false;
    let result;
    guardRoute(route('kaki', '/kaki', { requiresAuth: true })).then((r) => { result = r; });
    await nextTick();
    expect(result).toBeUndefined();
    currentUser.value = { id: 'me', vibe: VIBE };
    loadMyPreferences.mockResolvedValue({ concepts: ['singalong'] });
    sessionReady.value = true;
    await vi.waitFor(() => expect(result).toBe(true));
  });
});
