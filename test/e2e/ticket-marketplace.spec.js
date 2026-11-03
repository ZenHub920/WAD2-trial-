// Week 10c: end-to-end tests for the ticket marketplace. The real Vue app talks to
// the real API and an in-memory database (test/support/e2e-server.mjs);
// each test follows the setup → actions → assert pattern from a user's view.
//
// Unlike the Vitest tests, nothing is mocked here: a real Chromium browser clicks
// through the pages. Playwright waits automatically for elements to appear, so
// there are no manual sleeps. Run with `npm run test:e2e` from client/.
import { test, expect } from '../support/playwright.mjs';

const origin = 'http://127.0.0.1:5175';
// Asks the test server for a fresh set of users and a concert. Each test gets its
// own data (with a unique suffix), so tests never interfere with each other.
async function fixture(request) {
  const response = await request.post('http://127.0.0.1:3105/__test/fixture', { data: {} });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
// Opens a separate browser context (like a separate private window) for one user.
// Passing `who` signs that user in with a session cookie; `null` stays signed out.
// Two contexts let one test act as both the seller and the buyer.
async function person(browser, data, who) {
  const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'UTC' });
  await context.route(/^https:\/\//, route => route.abort()); // no remote fonts/images
  if (who) await context.addCookies([{ name: 'encore_session', value: data.sessions[who], domain: '127.0.0.1', path: '/api' }]);
  return { context, page: await context.newPage() };
}
// Calls the API directly as that user. Used to prepare data quickly, and to
// check what was really saved in the database (not just what the page shows).
async function api(context, path, method = 'GET', body) {
  const response = await context.request.fetch(`${origin}/api${path}`, {
    method, headers: { Origin: origin }, ...(body === undefined ? {} : { data: body }),
  });
  const text = await response.text();
  expect(response.ok(), `${path}: ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null; // DELETE answers with an empty body
}
// Creates a listing through the API (setup shortcut). The first test already
// covers creating one through the form, so later tests can start from here.
async function createListing(context, data, overrides = {}) {
  const { listing } = await api(context, '/tickets', 'POST', {
    concertId: data.concertId, priceCents: 15000, quantity: 2, section: 'Cat 2',
    description: 'Two seats together, e-ticket transfer.', ...overrides,
  });
  return listing;
}

// Workflow: a seller fills in "List a ticket" by hand, publishes it, and finds it
// on its own page and on My listings.
test('seller lists a ticket through the form and sees it on the listing page and My listings', async ({ browser, request }) => {
  const data = await fixture(request);
  const seller = await person(browser, data, 'hostA');
  const artist = `Marketplace E2E ${data.suffix}`;
  try {
    // Setup: open the form and wait for the concert list to finish loading.
    // If Ticketmaster concerts are offered, switch to typing the concert by hand.
    await seller.page.goto('/list-ticket');
    await expect(seller.page.getByRole('heading', { name: 'List a ticket' })).toBeVisible();
    await expect(seller.page.getByText('Loading Ticketmaster concerts…')).toHaveCount(0);
    const addConcert = seller.page.getByRole('button', { name: 'Concert not listed? Add it' });
    if (await addConcert.isVisible()) await addConcert.click();

    // Actions: fill every field by its visible label, like a user, then publish.
    await seller.page.getByLabel('Concert title').fill(artist);
    await seller.page.getByLabel('Venue').fill('Singapore Indoor Stadium');
    await seller.page.getByLabel('Event date').fill('2030-01-01');
    await seller.page.getByLabel('Total listing price (SGD)').fill('120.50');
    await seller.page.getByLabel('Number of tickets').fill('2');
    await seller.page.getByLabel('Section').fill('Cat 3');
    await seller.page.getByLabel('Description').fill('Row 12, seats together.');
    await seller.page.getByRole('button', { name: 'Publish listing' }).click();

    // Assert: the user is taken to the new listing page, which shows what was entered.
    // New listings start unverified, and the seller gets the Edit button.
    await expect(seller.page).toHaveURL(/\/tickets\/[^/]+$/);
    await expect(seller.page.getByRole('heading', { name: `${artist}, Cat 3` })).toBeVisible();
    await expect(seller.page.getByLabel('Price $120.50')).toBeVisible();
    await expect(seller.page.getByRole('definition').filter({ hasText: /^2$/ })).toBeVisible(); // "No. of tickets: 2"
    await expect(seller.page.getByText('No. of tickets:')).toBeVisible();
    await expect(seller.page.getByText('Unverified ticket')).toBeVisible();
    await expect(seller.page.getByRole('button', { name: 'Edit listing' })).toBeVisible();

    // Assert: it also appears under My listings
    await seller.page.goto('/my-listings');
    const card = seller.page.locator('article.listing-card').filter({ hasText: artist });
    await expect(card).toBeVisible();
    await expect(card.getByText('$120.50 total')).toBeVisible();
    await expect(card.getByText('Ticket not verified')).toBeVisible();
  } finally { await seller.context.close(); } // always close the browser, even if an assertion failed
});

// Negative workflow: a required field is left empty, so the browser's own form
// validation blocks submission and nothing reaches the server.
test('publishing without a price is blocked and creates no listing', async ({ browser, request }) => {
  const data = await fixture(request);
  const seller = await person(browser, data, 'hostA');
  try {
    // Setup: open the form in manual concert mode (same as the test above).
    await seller.page.goto('/list-ticket');
    await expect(seller.page.getByText('Loading Ticketmaster concerts…')).toHaveCount(0);
    const addConcert = seller.page.getByRole('button', { name: 'Concert not listed? Add it' });
    if (await addConcert.isVisible()) await addConcert.click();
    // Actions: fill everything except the price.
    await seller.page.getByLabel('Concert title').fill(`Missing price ${data.suffix}`);
    await seller.page.getByLabel('Venue').fill('Singapore Indoor Stadium');
    await seller.page.getByLabel('Event date').fill('2030-01-01');
    await seller.page.getByLabel('Section').fill('Cat 3');
    // Leave the required price empty: the browser blocks submission.
    await seller.page.getByRole('button', { name: 'Publish listing' }).click();
    // Assert: still on the form, the price field reports "value missing",
    // and the API confirms the seller has no listings.
    await expect(seller.page).toHaveURL(/\/list-ticket$/);
    expect(await seller.page.getByLabel('Total listing price (SGD)').evaluate(input => input.validity.valueMissing)).toBe(true);
    expect((await api(seller.context, '/me/tickets')).listings).toHaveLength(0);
  } finally { await seller.context.close(); }
});

// Workflow (two users): a buyer opens another user's listing. They cannot pay
// online, but they can start a chat with the seller.
test('buyer views a listing, cannot check out, and messages the seller', async ({ browser, request }) => {
  const data = await fixture(request);
  const seller = await person(browser, data, 'hostA');
  const buyer = await person(browser, data, 'seeker');
  try {
    // Setup: the seller has one listing.
    const listing = await createListing(seller.context, data);

    // Assert the buyer's view: details are shown, checkout is disabled,
    // and seller-only buttons are hidden.
    await buyer.page.goto(`/tickets/${listing.id}`);
    await expect(buyer.page.getByRole('heading', { name: `Test concert ${data.suffix}, Cat 2` })).toBeVisible();
    await expect(buyer.page.getByLabel('Price $150')).toBeVisible();
    await expect(buyer.page.getByText('Seller: hostA')).toBeVisible();
    await expect(buyer.page.getByRole('button', { name: 'Checkout unavailable' })).toBeDisabled();
    await expect(buyer.page.getByRole('button', { name: 'Edit listing' })).toHaveCount(0);

    // Action: message the seller, which opens a chat thread page.
    await buyer.page.getByRole('button', { name: 'Message seller' }).click();
    await expect(buyer.page).toHaveURL(/\/chat\/[^/]+$/);

    // Opening the chat again reuses the same conversation (one thread per buyer and listing).
    const chatUrl = buyer.page.url();
    await buyer.page.goto(`/tickets/${listing.id}`);
    await buyer.page.getByRole('button', { name: 'Message seller' }).click();
    await expect(buyer.page).toHaveURL(chatUrl);
  } finally { await seller.context.close(); await buyer.context.close(); }
});

// Access control: someone who is not signed in is redirected to the sign-in
// page, with ?redirect= set so they return to where they were afterwards.
test('signed-out visitor is asked to sign in before messaging a seller or listing a ticket', async ({ browser, request }) => {
  const data = await fixture(request);
  const seller = await person(browser, data, 'hostA');
  const visitor = await person(browser, data, null); // no session cookie
  try {
    // Viewing a listing is public, but messaging the seller needs an account.
    const listing = await createListing(seller.context, data);
    await visitor.page.goto(`/tickets/${listing.id}`);
    await visitor.page.getByRole('button', { name: 'Message seller' }).click();
    await expect(visitor.page).toHaveURL(new RegExp(`/login\\?redirect=.*${listing.id}`));

    // The List a ticket page is protected by the router itself.
    await visitor.page.goto('/list-ticket');
    await expect(visitor.page).toHaveURL(/\/login\?redirect=/);
  } finally { await seller.context.close(); await visitor.context.close(); }
});

// Workflow (two users): the seller changes the price, the buyer sees the change,
// then the seller removes the listing and it disappears for the buyer.
test('seller edits the price, then removes the listing so buyers can no longer see it', async ({ browser, request }) => {
  const data = await fixture(request);
  const seller = await person(browser, data, 'hostA');
  const buyer = await person(browser, data, 'seeker');
  try {
    // Setup: the seller opens their own listing.
    const listing = await createListing(seller.context, data);
    await seller.page.goto(`/tickets/${listing.id}`);

    // Action: edit the price on the edit page and save; the listing confirms and shows the new price.
    await seller.page.getByRole('button', { name: 'Edit listing' }).click();
    await expect(seller.page).toHaveURL(new RegExp(`/tickets/${listing.id}/edit$`));
    await seller.page.getByLabel('Total listing price (SGD)').fill('99.90');
    await seller.page.getByRole('button', { name: 'Save changes' }).click();
    await expect(seller.page.getByText('Listing updated.')).toBeVisible();
    await expect(seller.page.getByLabel('Price $99.90')).toBeVisible();

    // The buyer sees the new price after a reload: it was saved, not just shown.
    await buyer.page.goto(`/tickets/${listing.id}`);
    await expect(buyer.page.getByLabel('Price $99.90')).toBeVisible();

    // Action: remove the listing. The page asks "Remove this listing?" in a
    // browser dialog, so we register a handler to click OK before clicking.
    seller.page.once('dialog', dialog => dialog.accept());
    await seller.page.getByRole('button', { name: 'Remove listing' }).click();
    await expect(seller.page).toHaveURL(/\/my-listings$/);
    await expect(seller.page.getByText('You have no listings yet.')).toBeVisible();

    // Assert: after reloading, the buyer can no longer message the seller about it.
    await buyer.page.reload();
    await expect(buyer.page.getByRole('button', { name: 'Message seller' })).toHaveCount(0);
    await expect(buyer.page.getByText(/Listing not found|Listing removed/)).toBeVisible();
  } finally { await seller.context.close(); await buyer.context.close(); }
});

// Workflow: a buyer opens the Tickets tab from the main navigation, narrows the
// marketplace with search, and opens a listing from its card.
test('buyer browses the Tickets tab, searches, and opens a listing', async ({ browser, request }) => {
  const data = await fixture(request);
  const seller = await person(browser, data, 'hostA');
  const buyer = await person(browser, data, 'seeker');
  const artist = `Test concert ${data.suffix}`;
  try {
    // Setup: the seller has a listing for this test's concert.
    const listing = await createListing(seller.context, data, { priceCents: 8800, quantity: 1 });

    // Action: use the nav bar, as a user would, rather than typing the URL.
    await buyer.page.goto('/');
    await buyer.page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Tickets', exact: true }).click();
    await expect(buyer.page).toHaveURL(/\/tickets$/);
    await expect(buyer.page.getByRole('heading', { name: 'Tickets', exact: true })).toBeVisible();

    // Other tests' listings share this database, so search to find ours.
    await buyer.page.getByLabel('Search').fill(artist);
    const card = buyer.page.locator('article').filter({ hasText: artist });
    await expect(card).toHaveCount(1);
    await expect(card.getByText('$88.00')).toBeVisible();
    await expect(card.getByText('No. of tickets:')).toBeVisible();
    await expect(card.getByRole('definition').filter({ hasText: /^1$/ })).toBeVisible();

    // Clicking the card opens the full listing page.
    await card.getByRole('link', { name: artist }).click();
    await expect(buyer.page).toHaveURL(new RegExp(`/tickets/${listing.id}$`));
    await expect(buyer.page.getByRole('button', { name: 'Message seller' })).toBeVisible();
  } finally { await seller.context.close(); await buyer.context.close(); }
});

// Workflow: the concert page shows a one-line ticket summary; "View tickets" opens
// the marketplace already filtered to that concert. A removed listing drops out.
test('concert page summary links to the Tickets page filtered to that concert', async ({ browser, request }) => {
  const data = await fixture(request);
  const seller = await person(browser, data, 'hostA');
  const buyer = await person(browser, data, 'seeker');
  const artist = `Test concert ${data.suffix}`;
  try {
    // Setup: two listings for this concert, $150 (2 tickets) and $120 (1 ticket).
    const first = await createListing(seller.context, data);
    await createListing(seller.context, data, { priceCents: 12000, quantity: 1, section: 'Cat 4' });

    // Assert the summary on the concert page: totals and the lowest price.
    await buyer.page.goto(`/concerts/${data.concertId}`);
    const summary = buyer.page.locator('section').filter({ has: buyer.page.getByRole('heading', { name: 'Tickets for sale' }) });
    await expect(summary.getByText('3 tickets across 2 listings, from $120.00.')).toBeVisible();

    // Action: follow the link; the concert filter is pre-selected via the URL.
    await summary.getByRole('link', { name: 'View tickets' }).click();
    await expect(buyer.page).toHaveURL(new RegExp(`/tickets\\?concert=${data.concertId}$`));
    await expect(buyer.page.getByLabel('Concert', { exact: true })).toHaveValue(data.concertId);
    await expect(buyer.page.locator('article')).toHaveCount(2);
    await expect(buyer.page.locator('article').filter({ hasNotText: artist })).toHaveCount(0);

    // After the seller removes one listing, a reload shows only the other.
    await api(seller.context, `/tickets/${first.id}`, 'DELETE');
    await buyer.page.reload();
    await expect(buyer.page.locator('article')).toHaveCount(1);
    await expect(buyer.page.locator('article').getByText('Cat 4')).toBeVisible();
  } finally { await seller.context.close(); await buyer.context.close(); }
});

// Workflow: a seller uploads proof of purchase, an admin approves it on the admin
// page, and the listing then shows the Verified badge to everyone.
test('admin approves a proof of purchase and the listing becomes verified', async ({ browser, request }) => {
  const data = await fixture(request);
  const seller = await person(browser, data, 'hostA');
  const admin = await person(browser, data, 'admin');
  try {
    // Setup: a listing with a proof (a tiny PNG) waiting for review.
    const listing = await createListing(seller.context, data, { proofData: 'data:image/png;base64,iVBORw0KGgo=' });

    // Ordinary members get the admins-only notice instead of the queue.
    await seller.page.goto('/admin/verifications');
    await expect(seller.page.getByText('Admins only')).toBeVisible();

    // Action: the admin finds this listing in Pending and approves it.
    await admin.page.goto('/admin/verifications');
    await expect(admin.page.getByRole('heading', { name: 'Proof of purchase', exact: true })).toBeVisible();
    const item = admin.page.locator('li.item').filter({ hasText: `Test concert ${data.suffix},` });
    await item.getByRole('button', { name: 'Approve', exact: true }).click();

    // Assert: it leaves the queue, moves to Recent decisions, and the public listing is verified.
    await expect(item).toHaveCount(0);
    await admin.page.getByRole('tab', { name: /Recent decisions/ }).click();
    await expect(admin.page.locator('#admin-panel-history')).toContainText(`Test concert ${data.suffix}`);
    expect((await api(seller.context, `/tickets/${listing.id}`)).listing.verified).toBe(true);
  } finally {
    await seller.context.close();
    await admin.context.close();
  }
});

// Regression: after editing, the listing's back arrow returns to where the seller
// came from (the Tickets page), never to the edit form they just left.
test('after saving an edit, the back arrow skips the edit page', async ({ browser, request }) => {
  const data = await fixture(request);
  const seller = await person(browser, data, 'hostA');
  const artist = `Test concert ${data.suffix}`;
  try {
    const listing = await createListing(seller.context, data);
    await seller.page.goto('/tickets');
    await seller.page.getByLabel('Search').fill(artist);
    await seller.page.locator('article').filter({ hasText: artist }).getByRole('link', { name: artist }).click();
    await expect(seller.page).toHaveURL(new RegExp(`/tickets/${listing.id}$`));

    await seller.page.getByRole('button', { name: 'Edit listing' }).click();
    await expect(seller.page).toHaveURL(new RegExp(`/tickets/${listing.id}/edit$`));
    await seller.page.getByLabel('Total listing price (SGD)').fill('101');
    await seller.page.getByRole('button', { name: 'Save changes' }).click();
    await expect(seller.page.getByText('Listing updated.')).toBeVisible();
    await expect(seller.page).toHaveURL(new RegExp(`/tickets/${listing.id}$`));

    await seller.page.getByRole('button', { name: 'Go back' }).click();
    await expect(seller.page).toHaveURL(/\/tickets$/);
  } finally { await seller.context.close(); }
});
