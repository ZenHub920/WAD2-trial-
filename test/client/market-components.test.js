import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ListingDetailCard from '../../client/src/components/market/ListingDetailCard.vue';
import MarketNotice from '../../client/src/components/market/MarketNotice.vue';
import OrderSummary from '../../client/src/components/market/OrderSummary.vue';
import ProofUpload from '../../client/src/components/market/ProofUpload.vue';

// Test data: a typical active, unverified listing. Each test overrides only the
// fields it cares about, e.g. makeListing({ quantity: 1 }).
function makeListing(overrides = {}) {
  return {
    id: 'ticket_1',
    priceCents: 31000,
    quantity: 2,
    section: 'Cat 3',
    status: 'active',
    verified: false,
    description: 'Two seats together.',
    imageUrl: null,
    concert: { id: 'concert_1', artist: 'Coldplay', venue: 'National Stadium', event_date: '2030-01-01' },
    seller: { id: 'seller_1', displayName: 'Sam Seller' },
    ...overrides,
  };
}

// OrderSummary shows the order amount, delivery fee and total.
describe('TestSuite: OrderSummary', () => {
  // With no delivery fee prop, the fee reads "Free" and the total equals the subtotal.
  it('Test1: shows a free delivery fee and a total equal to the order amount', () => {
    const wrapper = mount(OrderSummary, { props: { subtotalCents: 31000 } });
    expect(wrapper.text()).toContain('Free');
    expect(wrapper.findAll('dd').map(dd => dd.text())).toEqual(['SGD $310.00', 'Free', 'SGD $310.00']);
  });

  // Computed property check: total = subtotal + delivery fee.
  it('Test2: adds the delivery fee into the order total', () => {
    const wrapper = mount(OrderSummary, { props: { subtotalCents: 31000, deliveryFeeCents: 550 } });
    expect(wrapper.text()).toContain('SGD $5.50');
    expect(wrapper.text()).toContain('SGD $315.50');
    expect(wrapper.text()).not.toContain('Free');
  });

  // Conditional rendering: the <h3> appears only when the heading prop is set.
  it('Test3: shows a heading only when one is given', () => {
    expect(mount(OrderSummary, { props: { subtotalCents: 0 } }).find('h3').exists()).toBe(false);
    const withHeading = mount(OrderSummary, { props: { subtotalCents: 0, heading: 'Price breakdown' } });
    expect(withHeading.get('h3').text()).toBe('Price breakdown');
  });
});

// MarketNotice is the box used for empty states and errors on market pages.
describe('TestSuite: MarketNotice', () => {
  // An error uses role="alert" so screen readers announce it straight away.
  // The `slots` option passes in content, like writing between the tags.
  it('Test1: an error notice is announced as an alert with its title and message', () => {
    const wrapper = mount(MarketNotice, {
      props: { tone: 'error', title: 'Could not load this listing' },
      slots: { default: '<p>Please refresh.</p>' },
    });
    expect(wrapper.attributes('role')).toBe('alert');
    expect(wrapper.get('h2').text()).toBe('Could not load this listing');
    expect(wrapper.text()).toContain('Please refresh.');
  });

  // The default (neutral) notice is just information, so it is not an alert.
  it('Test2: a neutral notice is not an alert and can omit the title', () => {
    const wrapper = mount(MarketNotice, { slots: { default: 'You have no orders.' } });
    expect(wrapper.attributes('role')).toBeUndefined();
    expect(wrapper.find('h2').exists()).toBe(false);
  });
});

// ProofUpload lets a seller attach a screenshot or PDF as proof of purchase.
// It sends the file to its parent through v-model (the update:modelValue event).
describe('TestSuite: ProofUpload', () => {
  // Simulates a user choosing a file. Browsers do not let scripts set
  // input.files directly, so the test defines it and then fires "change".
  async function pick(wrapper, file) {
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
    await input.trigger('change');
  }

  // Initial state: only the upload button, with no Remove button yet.
  it('Test1: starts with an upload button and no file', () => {
    const wrapper = mount(ProofUpload);
    expect(wrapper.get('button').text()).toBe('Upload proof of purchase');
    expect(wrapper.text()).not.toContain('Remove');
  });
  // A valid file is read by FileReader, which finishes asynchronously, so
  // vi.waitFor() retries the assertion until the event has been emitted.
  it('Test2: a valid PNG is emitted to the parent as a data URL', async () => {
    const wrapper = mount(ProofUpload);
    await pick(wrapper, new File(['receipt'], 'receipt.png', { type: 'image/png' }));
    await vi.waitFor(() => expect(wrapper.emitted('update:modelValue')).toHaveLength(1));
    expect(wrapper.emitted('update:modelValue')[0][0]).toMatch(/^data:image\/png;base64,/);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  // Invalid input: a text file is refused with a message and nothing is emitted.
  it('Test3: rejects an unsupported file type with a message', async () => {
    const wrapper = mount(ProofUpload);
    await pick(wrapper, new File(['hi'], 'notes.txt', { type: 'text/plain' }));
    expect(wrapper.get('[role="alert"]').text()).toBe('Use a PNG, JPG, WebP or PDF.');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
  // Boundary: one byte over the 2 MB limit is rejected.
  it('Test4: rejects a file over 2 MB', async () => {
    const wrapper = mount(ProofUpload);
    await pick(wrapper, new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' }));
    expect(wrapper.get('[role="alert"]').text()).toContain('over 2 MB');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
  // Boundary: exactly 2 MB is still allowed (tests "<=" rather than "<").
  it('Test5: accepts a file of exactly 2 MB (boundary)', async () => {
    const wrapper = mount(ProofUpload);
    await pick(wrapper, new File([new Uint8Array(2 * 1024 * 1024)], 'max.pdf', { type: 'application/pdf' }));
    await vi.waitFor(() => expect(wrapper.emitted('update:modelValue')).toBeTruthy());
  });
  // Starting with a file already attached (passed in as the v-model value):
  // the button changes to "Change file", and Remove emits an empty value.
  it('Test6: with a file attached, Remove clears it', async () => {
    const wrapper = mount(ProofUpload, { props: { modelValue: 'data:application/pdf;base64,AA==' } });
    expect(wrapper.text()).toContain('File attached');
    expect(wrapper.get('.proof__pick').text()).toBe('Change file');
    await wrapper.get('.proof__clear').trigger('click');
    expect(wrapper.emitted('update:modelValue')[0]).toEqual(['']);
  });
});

// ListingDetailCard is the full listing shown on a ticket's page. It does not call
// the API itself; it emits events (chat, edit, remove, …) for its parent page.
describe('TestSuite: ListingDetailCard', () => {
  // TicketPoster and UserAvatar are covered elsewhere, so they are stubbed here.
  // `stubs: { Name: true }` replaces a child with an empty placeholder, which
  // keeps this test focused on the card alone.
  const mountCard = (props = {}) => mount(ListingDetailCard, {
    props: { listing: makeListing(), ...props },
    global: { stubs: { TicketPoster: true, UserAvatar: true } },
  });
  // Finds a button by its visible text, the way a user would find it.
  const button = (wrapper, name) => wrapper.findAll('button').find(b => b.text().includes(name));

  // Rendering from props: title, price, the four detail facts and the seller.
  it('Test1: shows the title, price, ticket details and seller', () => {
    const wrapper = mountCard();
    expect(wrapper.get('h2').text()).toBe('Coldplay, Cat 3');
    expect(wrapper.get('.dcard__price').attributes('aria-label')).toBe('Price $310');
    // Each detail is its own labelled line, not a chip.
    const facts = wrapper.findAll('.ticket-facts__row').map(row => `${row.get('dt').text()} ${row.get('dd').text()}`);
    expect(facts).toHaveLength(4);
    expect(facts).toContain('Section: Cat 3');
    expect(facts).toContain('Venue: National Stadium');
    expect(facts).toContain('No. of tickets: 2');
    expect(wrapper.text()).toContain('Seller: Sam Seller');
  });
  // The count is a plain number after its label, whatever the quantity.
  it('Test2: shows a single ticket as "No. of tickets: 1"', () => {
    const wrapper = mountCard({ listing: makeListing({ quantity: 1 }) });
    const row = wrapper.findAll('.ticket-facts__row').find(r => r.get('dt').text() === 'No. of tickets:');
    expect(row.get('dd').text()).toBe('1');
  });
  // A price with cents keeps them on the card.
  it('Test3: shows a price with cents', () => {
    const wrapper = mountCard({ listing: makeListing({ priceCents: 12050 }) });
    expect(wrapper.get('.dcard__price').attributes('aria-label')).toBe('Price $120.50');
  });
  // Conditional rendering: verified listings get the badge, others a warning tag.
  it('Test4: an unverified listing is labelled, a verified one gets the badge', () => {
    expect(mountCard().text()).toContain('Unverified ticket');
    const verified = mountCard({ listing: makeListing({ verified: true }) });
    expect(verified.text()).toContain('Ticket verified');
    expect(verified.text()).not.toContain('Unverified ticket');
  });
  // Buyer view: clicking "Message seller" emits `chat` with the listing.
  // Checkout stays disabled because no payment provider is connected.
  it('Test5: a buyer can message the seller but checkout is disabled', async () => {
    const wrapper = mountCard();
    await button(wrapper, 'Message seller').trigger('click');
    expect(wrapper.emitted('chat')[0][0].id).toBe('ticket_1');
    expect(button(wrapper, 'Checkout unavailable').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('No payment provider is connected');
    expect(button(wrapper, 'Edit listing')).toBeUndefined();
  });
  // Seller view (own = true): management buttons replace the buyer buttons,
  // and each one emits its own event.
  it('Test6: the seller sees Edit and Remove instead of buyer actions', async () => {
    const wrapper = mountCard({ own: true });
    expect(button(wrapper, 'Message seller')).toBeUndefined();
    await button(wrapper, 'Edit listing').trigger('click');
    await button(wrapper, 'Remove listing').trigger('click');
    expect(wrapper.emitted('edit')).toHaveLength(1);
    expect(wrapper.emitted('remove')).toHaveLength(1);
  });
  // A sold listing is labelled and can no longer be edited or removed.
  it('Test7: a sold listing is marked Sold and cannot be managed', () => {
    const wrapper = mountCard({ own: true, listing: makeListing({ status: 'sold' }) });
    expect(wrapper.text()).toContain('Sold');
    expect(button(wrapper, 'Listing unavailable').attributes('disabled')).toBeDefined();
    expect(button(wrapper, 'Edit listing').attributes('disabled')).toBeDefined();
  });
  // Any other non-active status is shown to buyers as removed.
  it('Test8: a removed listing is marked as removed for buyers', () => {
    const wrapper = mountCard({ listing: makeListing({ status: 'deleted' }) });
    expect(wrapper.text()).toContain('Listing removed');
    expect(button(wrapper, 'Listing unavailable')).toBeTruthy();
  });
  // While the parent page is waiting on a request (busy), buttons are
  // disabled so a double-click cannot send the request twice.
  it('Test9: busy disables the actions so a request cannot be sent twice', () => {
    const wrapper = mountCard({ busy: true });
    expect(button(wrapper, 'Message seller').attributes('disabled')).toBeDefined();
  });
  // The bookmark button: its label and aria-pressed follow the `saved` prop,
  // and clicking it emits `toggle-save` with the listing id.
  it('Test10: the save button reflects state and emits the listing id', async () => {
    const unsaved = mountCard();
    const save = unsaved.get('[aria-label="Save listing"]');
    expect(save.attributes('aria-pressed')).toBe('false');
    await save.trigger('click');
    expect(unsaved.emitted('toggle-save')[0]).toEqual(['ticket_1']);
    expect(mountCard({ saved: true }).get('[aria-label="Remove from saved"]').attributes('aria-pressed')).toBe('true');
  });
  // The "More options" menu is hidden at first, opens on click, and closes
  // again after "Copy link" is chosen.
  it('Test11: the More options menu offers Copy link', async () => {
    const wrapper = mountCard();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    await wrapper.get('[aria-label="More options"]').trigger('click');
    await wrapper.get('[role="menuitem"]').trigger('click');
    expect(wrapper.emitted('copy-link')).toHaveLength(1);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });
  // The description section only appears when the seller wrote one.
  it('Test12: no description section when the seller left none', () => {
    expect(mountCard().text()).toContain('Two seats together.');
    expect(mountCard({ listing: makeListing({ description: '' }) }).text()).not.toContain('Ticket description');
  });
});
