// Week 10b: component and integration tests for the Tickets marketplace page.
// TicketListingCard is tested on its own first (component test); then the whole
// TicketMarketplaceView is mounted with its real cards and a real router, with only
// the network API mocked (integration test).
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Replace only the network calls; labels and date helpers in api.js stay real.
vi.mock('../src/api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { tickets: vi.fn() } };
});

const { api } = await import('../src/api.js');
const { useSavedListings } = await import('../src/market.js');
const { default: TicketListingCard } = await import('../src/components/market/TicketListingCard.vue');
const { default: TicketMarketplaceView } = await import('../src/views/TicketMarketplaceView.vue');

// Test data: one listing; each test overrides only what it needs.
function makeListing(overrides = {}) {
  return {
    id: 't1', priceCents: 15000, quantity: 2, section: 'Cat 2', status: 'active', verified: false,
    imageUrl: null, createdAt: '2026-01-01 10:00:00',
    concert: { id: 'c1', artist: 'Coldplay', venue: 'National Stadium', event_date: '2030-03-01' },
    seller: { id: 's1', displayName: 'Sam Seller' },
    ...overrides,
  };
}
// Three upcoming listings across two concerts, plus one for a concert that has
// already happened (which the page must hide).
const coldplayCheap = makeListing({ id: 'a', priceCents: 9000, createdAt: '2026-01-01 09:00:00' });
const coldplayVerified = makeListing({ id: 'b', priceCents: 20000, verified: true, section: 'VIP', createdAt: '2026-01-03 09:00:00' });
const iu = makeListing({
  id: 'c', priceCents: 12000, quantity: 1, createdAt: '2026-01-02 09:00:00',
  concert: { id: 'c2', artist: 'IU', venue: 'Indoor Stadium', event_date: '2030-01-15' },
  seller: { id: 's2', displayName: 'Jo Buyer' },
});
const past = makeListing({ id: 'old', concert: { id: 'c0', artist: 'Old Show', venue: 'Expo', event_date: '2020-01-01' } });

function makeRouter() {
  const Blank = { template: '<div />' };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/tickets', name: 'tickets', component: Blank },
      { path: '/tickets/:id', name: 'ticket-detail', component: Blank },
      { path: '/my-listings', component: Blank },
      { path: '/list-ticket', component: Blank },
    ],
  });
}
// Mounts the page at a URL (so ?concert= can be tested) and waits for the API call.
async function mountPage(path = '/tickets') {
  const router = makeRouter();
  await router.push(path);
  const wrapper = mount(TicketMarketplaceView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}
// The artist names of the visible cards, in on-screen order.
const titles = (wrapper) => wrapper.findAll('article h3').map((h3) => h3.text());

// Saved listings are shared module-wide; start every test with none saved.
beforeEach(() => {
  const { isSaved, toggle } = useSavedListings();
  for (const id of ['a', 'b', 'c', 't1']) if (isSaved(id)) toggle(id);
});

describe('TestSuite: TicketListingCard (component)', () => {
  const mountCard = (props = {}) => mount(TicketListingCard, {
    props: { listing: makeListing(), ...props },
    global: { plugins: [makeRouter()], stubs: { TicketPoster: true, UserAvatar: true } },
  });

  // Renders the key facts a buyer scans for: artist, venue, section, quantity, price, seller.
  it('Test1: shows the concert, section, quantity, total price and seller', () => {
    const wrapper = mountCard();
    expect(wrapper.get('h3').text()).toBe('Coldplay');
    expect(wrapper.text()).toContain('National Stadium');
    expect(wrapper.findAll('[aria-label="Ticket details"] li').map((li) => li.text())).toEqual(['Cat 2', '2 tickets']);
    expect(wrapper.text()).toContain('$150.00');
    expect(wrapper.text()).toContain('Sam Seller');
  });
  // The title link goes to that listing's detail page.
  it('Test2: links to the listing page', () => {
    expect(mountCard().get('a').attributes('href')).toBe('/tickets/t1');
  });
  // Singular wording for one ticket.
  it('Test3: says "1 ticket" for a single ticket', () => {
    expect(mountCard({ listing: makeListing({ quantity: 1 }) }).text()).toContain('1 ticket');
  });
  // Verified listings get the badge; others are labelled unverified.
  it('Test4: shows the verified badge only for verified listings', () => {
    expect(mountCard().text()).toContain('Unverified ticket');
    expect(mountCard({ listing: makeListing({ verified: true }) }).text()).toContain('Ticket verified');
  });
  // The save button reflects the prop and emits the id for the parent to toggle.
  it('Test5: the save button emits the listing id', async () => {
    const wrapper = mountCard();
    const save = wrapper.get('[aria-label="Save listing"]');
    expect(save.attributes('aria-pressed')).toBe('false');
    await save.trigger('click');
    expect(wrapper.emitted('toggle-save')[0]).toEqual(['t1']);
    expect(mountCard({ saved: true }).find('[aria-label="Remove from saved"]').exists()).toBe(true);
  });
});

describe('Integration: TicketMarketplaceView + TicketListingCard', () => {
  beforeEach(() => { api.tickets.mockResolvedValue({ listings: [coldplayCheap, coldplayVerified, iu, past] }); });

  // Default view: every upcoming listing, soonest concert first (IU in January,
  // then Coldplay in March, cheapest first). Past concerts are hidden.
  it('Test1: lists upcoming tickets from every concert, soonest first', async () => {
    const { wrapper } = await mountPage();
    expect(titles(wrapper)).toEqual(['IU', 'Coldplay', 'Coldplay']);
    expect(wrapper.text()).not.toContain('Old Show');
    expect(wrapper.get('#market-results').text()).toBe('3 listings');
    expect(wrapper.text()).toContain('5 tickets for sale');
  });
  // The concert dropdown is built from the listings, one option per upcoming concert.
  it('Test2: offers each concert with tickets in the concert filter', async () => {
    const { wrapper } = await mountPage();
    const options = wrapper.findAll('select')[0].findAll('option').map((o) => o.text());
    expect(options).toEqual(['All concerts', 'IU · 15 Jan', 'Coldplay · 1 Mar']);
  });
  // Arriving from a concert page (?concert=c1) shows only that concert's tickets.
  it('Test3: ?concert= in the URL pre-selects that concert', async () => {
    const { wrapper } = await mountPage('/tickets?concert=c1');
    expect(wrapper.findAll('select')[0].element.value).toBe('c1');
    expect(titles(wrapper)).toEqual(['Coldplay', 'Coldplay']);
  });
  // Changing the dropdown updates the URL, so the filtered page can be shared or refreshed.
  it('Test4: choosing a concert updates the URL, and clearing it removes the filter', async () => {
    const { wrapper, router } = await mountPage();
    await wrapper.findAll('select')[0].setValue('c2');
    await flushPromises();
    expect(router.currentRoute.value.query.concert).toBe('c2');
    expect(titles(wrapper)).toEqual(['IU']);
    await wrapper.findAll('select')[0].setValue('');
    await flushPromises();
    expect(router.currentRoute.value.query.concert).toBeUndefined();
    expect(titles(wrapper)).toHaveLength(3);
  });
  // Search matches the artist, venue, section or seller name, ignoring case.
  it('Test5: search matches artist, venue, section or seller', async () => {
    const { wrapper } = await mountPage();
    const search = wrapper.get('input[type="search"]');
    await search.setValue('coldplay');
    expect(titles(wrapper)).toEqual(['Coldplay', 'Coldplay']);
    await search.setValue('indoor');
    expect(titles(wrapper)).toEqual(['IU']);
    await search.setValue('vip');
    expect(titles(wrapper)).toEqual(['Coldplay']);
    await search.setValue('jo buyer');
    expect(titles(wrapper)).toEqual(['IU']);
  });
  // Each sort option orders the cards by its rule.
  it('Test6: sorts by price both ways and by newest listing', async () => {
    const { wrapper } = await mountPage();
    const sort = wrapper.findAll('select')[1];
    const prices = () => wrapper.findAll('.tcard__price strong').map((s) => s.text());
    await sort.setValue('price-asc');
    expect(prices()).toEqual(['$90.00', '$120.00', '$200.00']);
    await sort.setValue('price-desc');
    expect(prices()).toEqual(['$200.00', '$120.00', '$90.00']);
    await sort.setValue('newest');
    expect(prices()).toEqual(['$200.00', '$120.00', '$90.00']); // b (3 Jan), c (2 Jan), a (1 Jan)
  });
  // "Verified tickets only" hides unverified listings.
  it('Test7: the verified filter shows only verified tickets', async () => {
    const { wrapper } = await mountPage();
    await wrapper.findAll('input[type="checkbox"]')[0].setValue(true);
    expect(wrapper.findAll('article')).toHaveLength(1);
    expect(wrapper.text()).toContain('$200.00');
  });
  // Saving a card (child event → shared saved list) feeds the "Saved listings only" filter.
  it('Test8: saving a card and filtering by saved shows just that listing', async () => {
    const { wrapper } = await mountPage();
    await wrapper.findAll('[aria-label="Save listing"]')[0].trigger('click'); // the IU card
    await wrapper.findAll('input[type="checkbox"]')[1].setValue(true);
    expect(titles(wrapper)).toEqual(['IU']);
  });
  // No matches: a friendly empty state, and Clear filters brings everything back.
  it('Test9: shows an empty state when nothing matches and can clear filters', async () => {
    const { wrapper } = await mountPage();
    await wrapper.get('input[type="search"]').setValue('nobody plays this');
    expect(wrapper.text()).toContain('No tickets match your filters');
    const clear = wrapper.findAll('button').find((b) => b.text() === 'Clear filters');
    await clear.trigger('click');
    expect(titles(wrapper)).toHaveLength(3);
  });
  // With no listings at all, the page invites sellers instead of showing a blank grid.
  it('Test10: with no tickets at all, invites fans to list one', async () => {
    api.tickets.mockResolvedValue({ listings: [past] });
    const { wrapper } = await mountPage();
    expect(wrapper.text()).toContain('No tickets for sale yet');
    expect(wrapper.find('a[href="/list-ticket"]').exists()).toBe(true);
  });
  // A failed load shows an alert; Try again calls the API a second time and recovers.
  it('Test11: a load error can be retried', async () => {
    api.tickets.mockRejectedValueOnce(new Error('offline'));
    const { wrapper } = await mountPage();
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load tickets for sale');
    await wrapper.findAll('button').find((b) => b.text() === 'Try again').trigger('click');
    await flushPromises();
    expect(api.tickets).toHaveBeenCalledTimes(2);
    expect(titles(wrapper)).toHaveLength(3);
  });
  // The seller tools now live on this page.
  it('Test12: links to My listings and List a ticket', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find('a[href="/my-listings"]').exists()).toBe(true);
    expect(wrapper.find('a[href="/list-ticket"]').exists()).toBe(true);
  });
});
