<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { isNavigationFailure, useRouter } from 'vue-router';
import { api, formatDate } from '../api.js';
import { currentUser } from '../auth.js';
import { sectionOptions } from '../market.js';
import SearchSelect from '../components/SearchSelect.vue';
import ProofUpload from '../components/market/ProofUpload.vue';
import ImagePicker from '../components/market/ImagePicker.vue';
import BackArrow from '../components/BackArrow.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const router = useRouter();
const creating = ref(false);
const error = ref('');
const createdListing = ref(null);
const notice = ref('');
const imagePreview = ref('');
const proof = ref('');
let alive = true, scopeVersion = 0;

// Discovery also saves provider events locally, so the selected ID can be listed.
const concerts = ref([]);
// Searchable by artist, date or venue in the concert picker.
const concertOptions = computed(() => concerts.value.map((concert) => ({
  value: concert.id,
  label: `${concert.artist}, ${formatDate(concert.event_date)}, ${concert.venue}`,
})));
const concertId = ref('');
const loadingConcerts = ref(true);
const concertError = ref('');

/**
 * Listings are for Ticketmaster concerts only. Live discovery comes first; if it
 * is unavailable, the Ticketmaster concerts already saved locally are offered.
 */
async function loadConcerts() {
  loadingConcerts.value = true;
  concertError.value = '';
  try {
    const { events } = await api.externalConcerts();
    if (!alive) return;
    concerts.value = events;
  } catch {
    if (!alive) return;
    concerts.value = [];
  }
  if (!concerts.value.length) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const saved = await api.concerts();
      if (!alive) return;
      concerts.value = saved.concerts.filter((concert) => concert.event_date >= today);
    } catch {
      if (!alive) return;
      concerts.value = [];
    }
  }
  if (!concerts.value.length) concertError.value = 'Could not load concerts right now. Please try again.';
  loadingConcerts.value = false;
}
onMounted(loadConcerts);

const listing = ref({
  price: '',
  description: '',
  quantity: 1,
  section: '',
});
watch(() => currentUser.value?.id, () => {
  scopeVersion++; creating.value = false; error.value = ''; notice.value = ''; createdListing.value = null;
  imagePreview.value = ''; proof.value = ''; concertId.value = '';
  listing.value = { price: '', description: '', quantity: 1, section: '' };
}, { flush: 'sync' });
onUnmounted(() => { alive = false; scopeVersion++; });

const ERROR_COPY = {
  concert_not_found: () => 'That concert is no longer available. Choose another.',
  concert_required: () => 'Choose a concert from the list.',
  concert_must_be_listed: () => 'Choose a concert from the list.',
  invalid_price: () => 'Enter a valid total listing price.',
  invalid_quantity: () => 'Choose between 1 and 10 tickets.',
  invalid_section: () => 'Choose a section from the list.',
  invalid_description: () => 'Add a description (up to 2,000 characters).',
  invalid_image: () => 'Choose a supported ticket image within the upload size limit.',
  proof_required: () => 'Upload proof of purchase for this listing.',
  proof_must_be_an_image_or_pdf: () => 'Use a PNG, JPG, WebP or PDF for proof of purchase.',
  proof_too_large: () => 'Proof of purchase must be no larger than 2 MB.',
};

async function submitListing() {
  if (creating.value) return;
  creating.value = true;
  const version = scopeVersion, userId = currentUser.value?.id;
  const current = () => alive && version === scopeVersion && userId === currentUser.value?.id;
  error.value = '';
  try {
    if (!createdListing.value) {
      const { listing: created } = await api.createTicket({
        concertId: concertId.value,
        priceCents: Math.round(Number(listing.value.price) * 100),
        quantity: Number(listing.value.quantity),
        section: listing.value.section,
        description: listing.value.description,
        ...(imagePreview.value ? { imageData: imagePreview.value } : {}),
        ...(proof.value ? { proofData: proof.value } : {}),
      });
      if (!current()) return;
      createdListing.value = created;
    }
    notice.value = 'Your listing was published.';
    try {
      const result = await router.push({ name: 'ticket-detail', params: { id: createdListing.value.id } });
      if (current() && isNavigationFailure(result)) notice.value = 'Your listing was published, but its page could not open. Open the published listing below.';
    } catch {
      if (current()) notice.value = 'Your listing was published, but its page could not open. Open the published listing below.';
    }
  } catch (err) {
    if (!current()) return;
    const code = err.body?.error ?? err.message;
    error.value = err.status === 401
      ? 'Please sign in before listing a ticket.'
      : (ERROR_COPY[code]?.() ?? 'Could not publish your listing. Check the details and try again.');
  } finally {
    if (current()) creating.value = false;
  }
}
</script>

<template>
  <div class="listing-page">
    <div class="listing-page__shell container">
      <BackArrow to="/tickets" label="Back to tickets" />

      <header class="listing-page__header page-banner">
        <div>
          <h1>List a ticket</h1>
          <p>Sell a ticket you can no longer use to another fan.</p>
        </div>
        <RouterLink to="/my-listings" class="btn btn--outline-light">My listings</RouterLink>
      </header>

      <form class="listing-form" @submit.prevent="submitListing">
        <fieldset class="listing-form__fields" :disabled="creating || Boolean(createdListing)">
        <section class="listing-form__section">
          <h2>Listing details</h2>
          <p v-if="loadingConcerts" class="listing-form__field listing-form__field--wide listing-form__hint loading-state" role="status" aria-busy="true">
            <LoadingSpinner /> Loading Ticketmaster concerts…
          </p>
          <p v-else-if="concertError" class="listing-form__field listing-form__field--wide listing-form__error" role="alert">
            {{ concertError }}
            <button type="button" class="listing-form__link" @click="loadConcerts">Try again</button>
          </p>
          <ImagePicker v-model="imagePreview" class="listing-form__field--wide" @error="error = $event" />

          <label class="listing-form__field listing-form__field--wide">
            Ticketmaster concert
            <SearchSelect
              v-model="concertId"
              :options="concertOptions"
              :disabled="loadingConcerts"
              required
              placeholder="Type an artist, venue or date"
              empty-text="No concerts match. Try another word."
            />
          </label>

          <label class="listing-form__field">
            Total listing price (SGD)
            <input v-model.number="listing.price" type="number" min="0" step="0.01" required placeholder="0.00" />
          </label>

          <label class="listing-form__field listing-form__field--wide">
            Description
            <textarea v-model.trim="listing.description" rows="4" required maxlength="2000" placeholder="Describe the ticket, section and any transfer arrangements." />
          </label>

          <label class="listing-form__field">
            Number of tickets
            <input v-model.number="listing.quantity" type="number" min="1" max="10" required />
          </label>
          <label class="listing-form__field">
            Section
            <SearchSelect v-model="listing.section" :options="sectionOptions()" required placeholder="Choose a section, e.g. Cat 3" empty-text="No section matches. Choose one from the list." />
          </label>
        </section>

        <section class="listing-form__section">
          <h2>Verify your tickets <small class="listing-form__optional">optional</small></h2>
          <div class="listing-form__field listing-form__field--wide">
            <ProofUpload v-model="proof" />
          </div>
        </section>
        </fieldset>

        <p v-if="error" class="listing-form__error" role="alert">{{ error }}</p>
        <p v-if="notice" role="status">{{ notice }} <RouterLink :to="{ name: 'ticket-detail', params: { id: createdListing.id } }">Open published listing</RouterLink></p>
        <div class="listing-form__actions">
          <RouterLink to="/tickets" class="btn btn--ghost">Cancel</RouterLink>
          <button class="btn btn--primary" :disabled="creating || loadingConcerts">
            <LoadingSpinner v-if="creating" />
            {{ creating ? (createdListing ? 'Opening…' : 'Publishing…') : createdListing ? 'Open published listing' : 'Publish listing' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.listing-page {
  min-height: calc(100vh - var(--header-height));
  padding-block: var(--space-7) var(--space-9);
  background: radial-gradient(circle at 90% 0%, color-mix(in oklab, var(--accent-500) 12%, transparent), transparent 32rem), var(--ink-900);
}
.listing-page__shell {
  max-width: 820px;
}
.listing-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-block: var(--space-4) var(--space-5);
}

.listing-form {
  display: grid;
  gap: var(--space-5);
}
.listing-form__fields { display:grid; gap:var(--space-5); min-width:0; padding:0; margin:0; border:0; }
.listing-form__section {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  padding: var(--space-5);
  border: var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--ink-850);
}
.listing-form__section h2 {
  grid-column: 1 / -1;
  font-size: var(--step-1);
}
.listing-form__field {
  display: grid;
  /* Stack from the top, so a neighbour's error message does not push this box down. */
  align-content: start;
  min-width: 0;
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
}
.listing-form__field--wide {
  grid-column: 1 / -1;
}
/* :deep reaches the boxes inside SearchSelect, so they match the other fields. */
.listing-form input, .listing-form :deep(.suggest > input), .listing-form textarea {
  width: 100%;
  min-width: 0;
  padding: var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--field-bg);
}
.listing-form textarea {
  resize: vertical;
}
.listing-form__error {
  color: var(--rose-400);
}
.listing-form__hint {
  color: var(--text-400);
  font-size: var(--step--2);
}
.listing-form__link {
  justify-self: start;
  padding: 0;
  color: var(--accent-400);
  font-size: var(--step--2);
  text-decoration: underline;
  text-align: left;
}
.listing-form__optional {
  margin-left: var(--space-2);
  color: var(--text-400);
  font-family: var(--font-body);
  font-size: var(--step--2);
  font-weight: 400;
}
.listing-form__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-3);
}
@media (max-width: 600px) {
  .listing-form__section {
    grid-template-columns: 1fr;
  }
  .listing-form__field--wide {
    grid-column: auto;
  }
  .listing-form__actions {
    justify-content: stretch;
  }
  .listing-form__actions .btn {
    flex: 1;
    text-align: center;
  }
}
</style>
