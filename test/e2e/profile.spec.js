// Week 10c: end-to-end tests for the profile page. The real Vue app talks to the
// real API and an in-memory database (test/support/e2e-server.mjs), driven
// by a real Chromium browser. Nothing is mocked.
//
// Each test follows the setup -> actions -> assert pattern: open the page, do
// what a user would do, then check what the user sees. Playwright waits for
// elements automatically, so there are no manual sleeps.
//
// Run with `npm run test:e2e` from client/, or `npm run test:e2e -- profile.spec.js`.
import { test, expect } from '../support/playwright.mjs';

const origin = 'http://127.0.0.1:5175';

// Asks the test server for a fresh set of users. Each test gets its own data
// (with a unique suffix), so tests never interfere with each other.
async function fixture(request) {
  const response = await request.post('http://127.0.0.1:3105/__test/fixture', { data: {} });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

// Opens a separate browser context (like a separate private window) for one
// user. Passing `who` signs that user in with a session cookie; `null` stays
// signed out, which is how the last test visits the page as a stranger.
async function person(browser, data, who) {
  const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'UTC' });
  await context.route(/^https:\/\//, route => route.abort()); // no remote fonts/images
  if (who) await context.addCookies([{ name: 'encore_session', value: data.sessions[who], domain: '127.0.0.1', path: '/api' }]);
  return { context, page: await context.newPage() };
}

// Calls the API directly as that user, to check what was really saved in the
// database rather than only what the page happens to show.
async function api(context, path) {
  const response = await context.request.fetch(`${origin}/api${path}`, { headers: { Origin: origin } });
  const text = await response.text();
  expect(response.ok(), `${path}: ${text}`).toBeTruthy();
  return JSON.parse(text);
}

// Workflow: a signed-in fan opens their profile, sees their saved details, edits
// several of them, presses Save, and finds the change still there after a
// reload - and really stored on the server.
test('a signed-in fan edits their profile, saves it, and the change survives a reload', async ({ browser, request }) => {
  const data = await fixture(request);
  const fan = await person(browser, data, 'hostA');
  const { page } = fan;
  try {
    // Setup: open the page and wait for the saved profile to load into the form.
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
    await expect(page.getByLabel('Display name')).toHaveValue('hostA');
    await expect(page.getByLabel('Email')).toHaveValue(`${data.users.hostA}@example.test`);
    await expect(page.getByLabel('Email')).toHaveAttribute('readonly', '');
    await expect(page.getByText('Reliability 80%')).toBeVisible();

    // Actions: change the name, the two dropdowns, add a language and nudge one
    // vibe slider up by one step, exactly as a user would.
    await page.getByLabel('Display name').fill('Jamie Tan');
    await page.getByLabel('Age range').selectOption('25-29');
    await page.getByLabel('Home region').selectOption('west');
    await page.getByLabel('Chinese').check();
    await page.getByRole('slider', { name: 'Singalong', exact: true }).press('ArrowRight');
    await page.getByRole('button', { name: 'Save profile' }).click();

    // Assert: the page confirms the save.
    await expect(page.getByText('Profile saved')).toBeVisible();

    // Assert: the server really stored it, and the page shows the stored values
    // again after a full reload (not just the state left in memory).
    const { profile } = await api(fan.context, '/me/profile');
    expect(profile).toMatchObject({
      displayName: 'Jamie Tan', ageBand: '25-29', homeRegion: 'west',
    });
    expect(profile.languages).toEqual(expect.arrayContaining(['en', 'zh']));
    expect(profile.vibe.singalong).toBe(4);

    await page.reload();
    await expect(page.getByLabel('Display name')).toHaveValue('Jamie Tan');
    await expect(page.getByLabel('Age range')).toHaveValue('25-29');
    await expect(page.getByLabel('Chinese')).toBeChecked();
  } finally {
    await fan.context.close();
  }
});

// Workflow: the form refuses an incomplete profile and says why, instead of
// sending it to the server and failing there.
test('the form refuses a blank display name and refuses to drop every language', async ({ browser, request }) => {
  const data = await fixture(request);
  const fan = await person(browser, data, 'hostA');
  const { page } = fan;
  try {
    // Setup.
    await page.goto('/profile');
    await expect(page.getByLabel('Display name')).toHaveValue('hostA');

    // Actions and assert: a name of only spaces is rejected.
    await page.getByLabel('Display name').fill('   ');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Enter a display name.')).toBeVisible();

    // Actions and assert: a valid name but no language is rejected too.
    await page.getByLabel('Display name').fill('Jamie Tan');
    await page.getByLabel('English').uncheck();
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Choose at least one language.')).toBeVisible();

    // Assert: nothing reached the server - the stored profile is untouched.
    const { profile } = await api(fan.context, '/me/profile');
    expect(profile.displayName).toBe('hostA');
    expect(profile.languages).toEqual(['en']);
  } finally {
    await fan.context.close();
  }
});

// Workflow: a visitor who is not signed in is told to sign in rather than shown
// an empty form.
test('a signed-out visitor is asked to sign in instead of seeing the form', async ({ browser, request }) => {
  const data = await fixture(request);
  const visitor = await person(browser, data, null);
  const { page } = visitor;
  try {
    // Setup and action: open the profile page with no session.
    await page.goto('/profile');

    // Assert: the notice replaces the form, and its link leads to the sign-in page.
    await expect(page.getByText('Sign in to see your profile.')).toBeVisible();
    await expect(page.getByLabel('Display name')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Notification preferences' })).toHaveCount(0);

    // Scoped to the notice: the site header carries its own "Sign in" link when
    // signed out, and clicking that one would pass without proving anything
    // about the notice.
    await page.locator('.profile__notice').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await visitor.context.close();
  }
});
