import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace the network layer with mock functions (vi.fn()). Every other export
// of api.js (labels, date formatters) stays real via importOriginal().
// Each test then decides what the "server" returns, for example
// api.ticket.mockResolvedValue(...) for success or mockRejectedValue(...) for an error.
vi.mock('../src/api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: {
      ticket: vi.fn(), startChat: vi.fn(), updateTicket: vi.fn(), deleteTicket: vi.fn(),
      myTickets: vi.fn(), submitProof: vi.fn(), createTicket: vi.fn(), externalConcerts: vi.fn(),
    },
  };
});

// Imported after vi.mock() so the components receive the mocked api.
const { api } = await import('../src/api.js');
const { currentUser } = await import('../src/auth.js');
const { default: OrderItem } = await import('../src/components/market/OrderItem.vue');
const { default: TicketDetailView } = await import('../src/views/TicketDetailView.vue');
const { default: MyListingsView } = await import('../src/views/MyListingsView.vue');
const { default: ListingView } = await import('../src/views/ListingView.vue');
const { default: EditListingView } = await import('../src/views/EditListingView.vue');
const { flashListing, takeListingFlash } = await import('../src/market.js');

// Test data: a typical active, unverified listing; tests override what they need.
function makeListing(overrides = {}) {
  return {
    id: 'ticket_1', priceCents: 31000, quantity: 2, section: 'Cat 3', status: 'active',
    verified: false, description: 'Two seats together.', imageUrl: null,
    concert: { id: 'concert_1', artist: 'Coldplay', venue: 'National Stadium', event_date: '2030-01-01' },
    seller: { id: 'seller_1', displayName: 'Sam Seller' },
    verification: { status: 'none', note: null },
    ...overrides,
  };
}
// Builds an error shaped like the ones api.js throws (status + body.error code).
function apiError(status, error) {
  return Object.assign(new Error(error ?? `request_failed_${status}`), { status, body: error ? { error } : null });
}
const Blank = { template: '<div />' };
// Mounts a page with a real in-memory router so RouterLink and navigation work,
// then waits (flushPromises) for the page's first API call to finish.
// Returns the router too, so tests can check where the user ended up.
async function mountPage(component, path, props = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Blank },
      { path: '/login', name: 'login', component: Blank },
      { path: '/concerts', component: Blank },
      { path: '/list-ticket', component: Blank },
      { path: '/my-listings', component: Blank },
      { path: '/tickets/:id', name: 'ticket-detail', component: Blank },
      { path: '/tickets/:id/edit', name: 'ticket-edit', component: Blank },
      { path: '/chat/:id', name: 'chat-thread', component: Blank },
    ],
  });
  await router.push(path);
  const wrapper = mount(component, { props, global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}
// Finds a button by its visible text, the way a user would find it.
const button = (wrapper, name) => wrapper.findAll('button').find(b => b.text().includes(name));

// Every test starts signed out unless it signs a user in itself.
beforeEach(() => { currentUser.value = null; });
afterEach(() => { currentUser.value = null; });

// OrderItem uses two real children: TicketPoster (image or generated poster)
// and VerifiedBadge. These tests check the three render together correctly.
describe('Integration: OrderItem + TicketPoster + VerifiedBadge', () => {
  // No image: TicketPoster generates a poster showing the artist name.
  it('Test1: shows the listing title, seller, generated poster and verified badge together', () => {
    const wrapper = mount(OrderItem, { props: { listing: makeListing({ verified: true }) } });
    expect(wrapper.get('h2').text()).toBe('Coldplay, Cat 3');
    expect(wrapper.text()).toContain('Seller: Sam Seller');
    expect(wrapper.get('.poster__artist').text()).toBe('Coldplay'); // no image, so a poster is generated
    expect(wrapper.text()).toContain('Ticket verified');
  });
  // With an image URL, the real <img> is shown; unverified means no badge.
  it('Test2: uses the listing photo when there is one, and no badge when unverified', () => {
    const wrapper = mount(OrderItem, { props: { listing: makeListing({ imageUrl: '/uploads/t1.jpg' }) } });
    expect(wrapper.get('img').attributes('alt')).toBe('Coldplay poster');
    expect(wrapper.text()).not.toContain('Ticket verified');
  });
  // Simulates a broken image (the browser fires "error"): the card must
  // swap to the generated poster instead of showing an empty box.
  it('Test3: falls back to the generated poster when the photo fails to load', async () => {
    const wrapper = mount(OrderItem, { props: { listing: makeListing({ imageUrl: '/broken.jpg' }) } });
    await wrapper.get('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('.poster__artist').text()).toBe('Coldplay');
  });
});

// The ticket page as seen by a buyer (signed out, or signed in as someone
// other than the seller): TicketDetailView + the real ListingDetailCard.
describe('Integration: TicketDetailView + ListingDetailCard (buyer)', () => {
  // By default the "server" returns the standard listing.
  beforeEach(() => { api.ticket.mockResolvedValue({ listing: makeListing() }); });

  // The page asks the API for the id in the route and passes the result to the card.
  it('Test1: loads the listing by id and shows it in the card', async () => {
    const { wrapper } = await mountPage(TicketDetailView, '/tickets/ticket_1', { id: 'ticket_1' });
    expect(api.ticket).toHaveBeenCalledWith('ticket_1');
    expect(wrapper.get('h2').text()).toBe('Coldplay, Cat 3');
    expect(button(wrapper, 'Message seller')).toBeTruthy();
  });
  // Full chain: the click in the card → `chat` event → page calls startChat →
  // router navigates to the conversation the server returned.
  it('Test2: Message seller opens the chat thread for this listing', async () => {
    api.startChat.mockResolvedValue({ conversation: { id: 'conv_9' } });
    const { wrapper, router } = await mountPage(TicketDetailView, '/tickets/ticket_1', { id: 'ticket_1' });
    await button(wrapper, 'Message seller').trigger('click');
    await flushPromises();
    expect(api.startChat).toHaveBeenCalledWith('ticket_1');
    expect(router.currentRoute.value.fullPath).toBe('/chat/conv_9');
  });
  // A 401 (not signed in) sends the user to sign in, with ?redirect= set
  // so they come back to this listing afterwards.
  it('Test3: a signed-out buyer is sent to sign in and brought back afterwards', async () => {
    api.startChat.mockRejectedValue(apiError(401));
    const { wrapper, router } = await mountPage(TicketDetailView, '/tickets/ticket_1', { id: 'ticket_1' });
    await button(wrapper, 'Message seller').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/tickets/ticket_1');
  });
  // Any other failure shows a status message and the user stays on the page.
  it('Test4: other chat failures are announced without leaving the page', async () => {
    api.startChat.mockRejectedValue(apiError(500));
    const { wrapper, router } = await mountPage(TicketDetailView, '/tickets/ticket_1', { id: 'ticket_1' });
    await button(wrapper, 'Message seller').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe('Could not open the chat. Please try again.');
    expect(router.currentRoute.value.fullPath).toBe('/tickets/ticket_1');
  });
  // 404 from the API: a friendly "not found" notice instead of the card.
  it('Test5: a missing listing shows "Listing not found"', async () => {
    api.ticket.mockRejectedValue(apiError(404, 'not_found'));
    const { wrapper } = await mountPage(TicketDetailView, '/tickets/gone', { id: 'gone' });
    expect(wrapper.text()).toContain('Listing not found');
    expect(wrapper.find('article').exists()).toBe(false);
  });
  // Other load errors show the error notice (MarketNotice with role="alert").
  it('Test6: a server error shows the retry message as an alert', async () => {
    api.ticket.mockRejectedValue(apiError(500));
    const { wrapper } = await mountPage(TicketDetailView, '/tickets/ticket_1', { id: 'ticket_1' });
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load this listing');
  });
});

// The same page viewed by the listing's own seller (currentUser.id matches
// listing.seller.id), which switches the card to Edit / Remove.
describe('Integration: TicketDetailView + ListingDetailCard (seller)', () => {
  beforeEach(() => {
    currentUser.value = { id: 'seller_1', displayName: 'Sam Seller' };
    api.ticket.mockResolvedValue({ listing: makeListing() });
  });

  // Editing has its own page: the button navigates there instead of opening a form.
  it('Test1: Edit listing opens the separate edit page', async () => {
    const { wrapper, router } = await mountPage(TicketDetailView, '/tickets/ticket_1', { id: 'ticket_1' });
    expect(button(wrapper, 'Message seller')).toBeUndefined();
    await button(wrapper, 'Edit listing').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/tickets/ticket_1/edit');
    expect(wrapper.find('form').exists()).toBe(false);
  });
  // Coming back from a successful save confirms it once, without touching the URL.
  it('Test2: returning from the edit page confirms the update', async () => {
    flashListing('ticket_1', 'Listing updated.');
    const { wrapper, router } = await mountPage(TicketDetailView, '/tickets/ticket_1', { id: 'ticket_1' });
    expect(wrapper.get('[role="status"]').text()).toBe('Listing updated.');
    expect(router.currentRoute.value.fullPath).toBe('/tickets/ticket_1');
    expect(takeListingFlash('ticket_1')).toBe(''); // shown once, then gone
  });
  // window.confirm() is mocked to return true (the user clicked OK).
  // The listing is deleted and the user is sent to My listings.
  it('Test3: removing the listing after confirming returns to My listings', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.deleteTicket.mockResolvedValue({});
    const { wrapper, router } = await mountPage(TicketDetailView, '/tickets/ticket_1', { id: 'ticket_1' });
    await button(wrapper, 'Remove listing').trigger('click');
    await flushPromises();
    expect(api.deleteTicket).toHaveBeenCalledWith('ticket_1');
    expect(router.currentRoute.value.fullPath).toBe('/my-listings');
  });
  // The user clicks Cancel in the confirm box: no delete request is sent.
  it('Test4: cancelling the confirmation keeps the listing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { wrapper, router } = await mountPage(TicketDetailView, '/tickets/ticket_1', { id: 'ticket_1' });
    await button(wrapper, 'Remove listing').trigger('click');
    await flushPromises();
    expect(api.deleteTicket).not.toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe('/tickets/ticket_1');
  });
});

// The seller's "My listings" page, including the real ProofUpload child
// used to send proof of purchase for verification.
describe('Integration: MyListingsView + ProofUpload', () => {
  // Empty state for a seller with no listings.
  it('Test1: an empty account is invited to list its first ticket', async () => {
    api.myTickets.mockResolvedValue({ listings: [] });
    const { wrapper } = await mountPage(MyListingsView, '/my-listings');
    expect(wrapper.text()).toContain('You have no listings yet.');
  });
  // Two listings in different verification states. Only "none" and
  // "rejected" may (re)submit proof, so exactly one upload control appears.
  it('Test2: shows each listing with its verification state and reviewer note', async () => {
    api.myTickets.mockResolvedValue({ listings: [
      makeListing({ id: 'a', verification: { status: 'pending' } }),
      makeListing({ id: 'b', concert: { ...makeListing().concert, artist: 'IU' }, verification: { status: 'rejected', note: 'Order number hidden' } }),
    ] });
    const { wrapper } = await mountPage(MyListingsView, '/my-listings');
    expect(wrapper.findAll('article.listing-card')).toHaveLength(2);
    expect(wrapper.text()).toContain('Ticket verification pending review');
    expect(wrapper.text()).toContain('Reviewer: “Order number hidden”');
    expect(wrapper.text()).toContain('$310.00 total');
    // Only the rejected listing can be re-submitted, so only one upload control.
    expect(wrapper.findAll('.proof')).toHaveLength(1);
  });
  // Child → parent → API: ProofUpload reads the file and emits it via v-model,
  // which makes the page show "Submit for review". Clicking it calls the API,
  // and the card updates to the "pending" state the server returned.
  it('Test3: uploading proof and submitting it moves the listing to pending review', async () => {
    api.myTickets.mockResolvedValue({ listings: [makeListing()] });
    api.submitProof.mockResolvedValue({ listing: makeListing({ verification: { status: 'pending' } }) });
    const { wrapper } = await mountPage(MyListingsView, '/my-listings');
    expect(wrapper.text()).toContain('Ticket not verified');
    expect(button(wrapper, 'Submit for review')).toBeUndefined();

    const input = wrapper.get('.proof input[type="file"]');
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['x'], 'r.png', { type: 'image/png' })] });
    await input.trigger('change');
    await vi.waitFor(() => expect(button(wrapper, 'Submit for review')).toBeTruthy());
    await button(wrapper, 'Submit for review').trigger('click');
    await flushPromises();

    expect(api.submitProof).toHaveBeenCalledWith('ticket_1', expect.stringMatching(/^data:image\/png;base64,/));
    expect(wrapper.text()).toContain('Ticket verification pending review');
    expect(wrapper.find('.proof').exists()).toBe(false);
  });
  // After confirming, the removed listing disappears without a page reload.
  // The confirm text names the concert, so the seller knows which listing it is.
  it('Test4: removing a listing takes it off the page', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.myTickets.mockResolvedValue({ listings: [makeListing()] });
    api.deleteTicket.mockResolvedValue({});
    const { wrapper } = await mountPage(MyListingsView, '/my-listings');
    await wrapper.get('.remove-button').trigger('click');
    await flushPromises();
    expect(window.confirm).toHaveBeenCalledWith('Remove your listing for Coldplay?');
    expect(wrapper.findAll('article.listing-card')).toHaveLength(0);
  });

  it('serializes removal across listing cards and keeps a failed removal available for retry', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.myTickets.mockResolvedValue({ listings: [makeListing(), makeListing({ id: 'ticket_2' })] });
    let finishFirst, failSecond;
    api.deleteTicket.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    const { wrapper } = await mountPage(MyListingsView, '/my-listings');
    const removals = wrapper.findAll('.remove-button');
    // Two rapid clicks on different cards must not race the shared pending state.
    removals[0].element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    removals[1].element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(api.deleteTicket).toHaveBeenCalledExactlyOnceWith('ticket_1');
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll('.remove-button').every(item => item.element.disabled)).toBe(true);
    expect(wrapper.findAll('article.listing-card')).toHaveLength(2);
    finishFirst({});
    await flushPromises();
    expect(wrapper.findAll('article.listing-card')).toHaveLength(1);
    expect(wrapper.get('.remove-button').element.disabled).toBe(false);

    api.deleteTicket.mockImplementationOnce(() => new Promise((resolve, reject) => { failSecond = reject; }));
    await wrapper.get('.remove-button').trigger('click');
    expect(api.deleteTicket).toHaveBeenLastCalledWith('ticket_2');
    expect(wrapper.get('.remove-button').text()).toContain('Removing');
    failSecond(apiError(503));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Could not remove this listing. Please try again.');
    expect(wrapper.findAll('article.listing-card')).toHaveLength(1);
    expect(wrapper.get('.remove-button').element.disabled).toBe(false);
    api.deleteTicket.mockResolvedValueOnce({});
    await wrapper.get('.remove-button').trigger('click');
    await flushPromises();
    expect(api.deleteTicket).toHaveBeenCalledTimes(3);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.findAll('article.listing-card')).toHaveLength(0);
  });

  it('preserves both listings when native removal confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    api.myTickets.mockResolvedValue({ listings: [makeListing(), makeListing({ id: 'ticket_2' })] });
    const { wrapper } = await mountPage(MyListingsView, '/my-listings');
    await wrapper.get('.remove-button').trigger('click');
    expect(api.deleteTicket).not.toHaveBeenCalled();
    expect(wrapper.findAll('article.listing-card')).toHaveLength(2);
    expect(wrapper.findAll('.remove-button').every(item => !item.element.disabled)).toBe(true);
  });
  // A 401 from the API becomes a clear "sign in" message.
  it('Test5: a signed-out visitor is told to sign in', async () => {
    api.myTickets.mockRejectedValue(apiError(401));
    const { wrapper } = await mountPage(MyListingsView, '/my-listings');
    expect(wrapper.get('[role="alert"]').text()).toBe('Sign in to manage your listings.');
  });
});

// The "List a ticket" form: what it sends to the API and how it reacts.
describe('Integration: ListingView (create a listing)', () => {
  // Fills the hand-entered concert fields plus price and section, the way a user types them.
  async function fillManualConcert(wrapper) {
    await wrapper.get('input[placeholder="Enter the artist or concert title"]').setValue('  Coldplay  ');
    await wrapper.get('input[placeholder="Enter the concert venue"]').setValue('National Stadium');
    await wrapper.get('input[type="date"]').setValue('2030-01-01');
    await wrapper.get('input[placeholder="0.00"]').setValue('120.5');
    await wrapper.get('input[list="section-suggestions"]').setValue('Cat 3');
  }

  // If Ticketmaster is not set up, the form switches to typing the concert by
  // hand. The exact request body is checked: spaces are trimmed, $120.50 is sent
  // as 12050 cents, and after success the user lands on the new listing.
  it('Test1: without Ticketmaster the seller enters the concert by hand and is taken to the new listing', async () => {
    api.externalConcerts.mockRejectedValue(apiError(503, 'concert_provider_not_configured'));
    api.createTicket.mockResolvedValue({ listing: { id: 'new_1' } });
    const { wrapper, router } = await mountPage(ListingView, '/list-ticket');
    expect(wrapper.get('[role="alert"]').text()).toContain('Ticketmaster discovery is not configured');

    await fillManualConcert(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.createTicket).toHaveBeenCalledWith({
      concert: { artist: 'Coldplay', venue: 'National Stadium', event_date: '2030-01-01' },
      priceCents: 12050, quantity: 1, section: 'Cat 3', description: '',
    });
    expect(router.currentRoute.value.fullPath).toBe('/tickets/new_1');
  });
  // When concerts load, picking one from the dropdown sends only its id.
  // The server rejects a request containing both `concertId` and `concert`.
  it('Test2: choosing a Ticketmaster concert sends only its id', async () => {
    api.externalConcerts.mockResolvedValue({ events: [{ id: 'tm_1', artist: 'IU', venue: 'Indoor Stadium', event_date: '2030-02-02' }] });
    api.createTicket.mockResolvedValue({ listing: { id: 'new_2' } });
    const { wrapper } = await mountPage(ListingView, '/list-ticket');
    await wrapper.get('select').setValue('tm_1');
    await wrapper.get('input[placeholder="0.00"]').setValue('80');
    await wrapper.get('input[list="section-suggestions"]').setValue('VIP');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createTicket).toHaveBeenCalledWith(expect.objectContaining({ concertId: 'tm_1', priceCents: 8000, section: 'VIP' }));
    expect(api.createTicket.mock.calls[0][0]).not.toHaveProperty('concert');
  });
  // The server's error code ("invalid_price") is turned into a readable
  // sentence, and the user stays on the form to fix it.
  it('Test3: a server validation error is shown in plain language', async () => {
    api.externalConcerts.mockResolvedValue({ events: [] });
    api.createTicket.mockRejectedValue(apiError(400, 'invalid_price'));
    const { wrapper, router } = await mountPage(ListingView, '/list-ticket');
    await fillManualConcert(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('.listing-form__error[role="alert"]').text()).toBe('Enter a valid total listing price.');
    expect(router.currentRoute.value.fullPath).toBe('/list-ticket');
  });
});

// The seller's separate edit page: prefilled from the listing, saves as cents,
// and returns to the listing on success.
describe('Integration: EditListingView', () => {
  beforeEach(() => {
    currentUser.value = { id: 'seller_1', displayName: 'Sam Seller' };
    api.ticket.mockResolvedValue({ listing: makeListing() });
  });

  it('Test1: the form is prefilled and saving sends cents, then returns to the listing', async () => {
    api.updateTicket.mockResolvedValue({ listing: makeListing({ priceCents: 35050, quantity: 1 }) });
    const { wrapper, router } = await mountPage(EditListingView, '/tickets/ticket_1/edit', { id: 'ticket_1' });
    expect(wrapper.get('h1').text()).toBe('Edit listing');
    const [price, quantity] = wrapper.findAll('input[type="number"]');
    expect(price.element.value).toBe('310'); // prefilled from the listing
    expect(wrapper.text()).toContain('Add an image'); // no image yet: the picker invites one
    await price.setValue('350.5');
    await quantity.setValue('1');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.updateTicket).toHaveBeenCalledWith('ticket_1', expect.objectContaining({ priceCents: 35050, quantity: 1, section: 'Cat 3' }));
    expect(api.updateTicket.mock.calls[0][1]).not.toHaveProperty('imageData'); // image untouched
    // Opened directly, the edit page swaps itself for the listing and hands over the message.
    expect(router.currentRoute.value.fullPath).toBe('/tickets/ticket_1');
    expect(takeListingFlash('ticket_1')).toBe('Listing updated.');
  });

  // Reached from the listing, leaving steps back instead of pushing, so the
  // listing's back arrow cannot return to this form.
  it('Test1b: Cancel steps back to the listing it came from', async () => {
    const { wrapper, router } = await mountPage(EditListingView, '/tickets/ticket_1/edit', { id: 'ticket_1' });
    const state = vi.spyOn(window.history, 'state', 'get').mockReturnValue({ back: '/tickets/ticket_1' });
    const back = vi.spyOn(router, 'back').mockImplementation(() => {});
    const push = vi.spyOn(router, 'push');
    await button(wrapper, 'Cancel').trigger('click');
    expect(back).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    state.mockRestore();
  });

  it('Test2: a listing with an image shows it, ready to change', async () => {
    api.ticket.mockResolvedValue({ listing: makeListing({ imageUrl: '/ticket-images/one.png' }) });
    const { wrapper } = await mountPage(EditListingView, '/tickets/ticket_1/edit', { id: 'ticket_1' });
    expect(wrapper.get('.image-picker img').attributes('src')).toBe('/ticket-images/one.png');
    expect(wrapper.text()).toContain('Change image');
  });

  it('Test3: a failed save stays on the page with an explanation', async () => {
    api.updateTicket.mockRejectedValue(apiError(400, 'invalid_price'));
    const { wrapper, router } = await mountPage(EditListingView, '/tickets/ticket_1/edit', { id: 'ticket_1' });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Enter a valid total listing price.');
    expect(router.currentRoute.value.fullPath).toBe('/tickets/ticket_1/edit');
  });

  it('Test4: someone other than the seller sees no form', async () => {
    currentUser.value = { id: 'buyer_1', displayName: 'Bea Buyer' };
    const { wrapper } = await mountPage(EditListingView, '/tickets/ticket_1/edit', { id: 'ticket_1' });
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.text()).toContain('Only the seller can edit this listing');
  });
});
