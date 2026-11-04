<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { isNavigationFailure, useRouter } from 'vue-router';
import { api, formatDate } from '../api.js';
import { currentUser } from '../auth.js';
import { SECTION_SUGGESTIONS, flashListing, listingTitle, sectionLabel, useTicket } from '../market.js';
import ImagePicker from '../components/market/ImagePicker.vue';
import BackArrow from '../components/BackArrow.vue';
import MarketNotice from '../components/market/MarketNotice.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

/**
 * The seller's own page for changing a listing. Saving returns to the listing,
 * which confirms the update; Cancel goes back without changing anything.
 */
const props = defineProps({ id: { type: String, required: true } });

const router = useRouter();
const { listing, loading, error } = useTicket(() => props.id);

const isOwnListing = computed(() =>
  Boolean(currentUser.value?.id && listing.value?.seller?.id === currentUser.value.id),
);

const draft = ref({ price: 0, quantity: 1, section: '', description: '' });
const newImage = ref('');
const saving = ref(false);
const saveError = ref('');
const saveNotice = ref('');
let savedDraft = '';
let alive = true, scopeVersion = 0;
const fillDraft = current => {
  draft.value = { price: current.priceCents / 100, quantity: current.quantity, section: sectionLabel(current.section), description: current.description ?? '' };
};
watch([() => props.id, () => currentUser.value?.id], () => {
  scopeVersion++; saving.value = false; savedDraft = ''; newImage.value = ''; saveError.value = ''; saveNotice.value = '';
  if (listing.value?.id === props.id) fillDraft(listing.value);
}, { flush: 'sync' });
onUnmounted(() => { alive = false; scopeVersion++; });

// Prefill the form from the listing as soon as it arrives.
watch(listing, (current) => {
  if (!current) return;
  savedDraft = '';
  saveNotice.value = '';
  fillDraft(current);
}, { immediate: true });

const ERROR_COPY = {
  invalid_price: 'Enter a valid total listing price.',
  invalid_quantity: 'Enter a valid number of tickets.',
  invalid_section: 'Enter the section printed on the ticket (up to 120 characters).',
  invalid_description: 'Keep the description within 2,000 characters.',
  invalid_image: 'Choose a supported ticket image within the upload size limit.',
};

/**
 * Back to the listing without adding a history entry, so the listing's own back
 * arrow never lands on this form again. Normally the listing is the previous
 * entry; if this page was opened directly, it is swapped for the listing.
 */
function leave() {
  const listingPath = router.resolve({ name: 'ticket-detail', params: { id: props.id } }).fullPath;
  if (window.history.state?.back === listingPath) return router.back();
  return router.replace(listingPath);
}

async function save() {
  if (saving.value || loading.value || !isOwnListing.value) return;
  saving.value = true;
  saveError.value = '';
  saveNotice.value = '';
  const id = props.id, userId = currentUser.value?.id, version = scopeVersion;
  const current = () => alive && version === scopeVersion && id === props.id && userId === currentUser.value?.id;
  const changes = {
    priceCents: Math.round(Number(draft.value.price) * 100),
    quantity: Number(draft.value.quantity), section: draft.value.section,
    description: draft.value.description,
    ...(newImage.value ? { imageData: newImage.value } : {}),
  };
  const snapshot = JSON.stringify(changes);
  try {
    if (savedDraft !== snapshot) await api.updateTicket(id, changes);
    if (!current()) return;
    savedDraft = snapshot;
    flashListing(id, 'Listing updated.');
    saveNotice.value = 'Listing updated.';
    try {
      const result = await leave();
      if (current() && isNavigationFailure(result)) saveNotice.value = 'Listing updated, but its page could not open. Use Back to listing to open the saved result.';
    } catch {
      if (current()) saveNotice.value = 'Listing updated, but its page could not open. Use Back to listing to open the saved result.';
    }
  } catch (err) {
    if (current()) saveError.value = ERROR_COPY[err.body?.error] ?? 'Could not save this listing. Check the details and try again.';
  } finally {
    if (current()) saving.value = false;
  }
}
</script>

<template>
  <div class="edit-page">
    <div class="edit-page__shell container">
      <BackArrow label="Back to listing" @click="leave" />

      <div v-if="loading" class="loading-state" aria-busy="true"><LoadingSpinner /> Loading listing…</div>

      <MarketNotice v-else-if="error?.status === 404" title="Listing not found">
        It may have been removed. <RouterLink to="/my-listings">Back to my listings</RouterLink>
      </MarketNotice>

      <MarketNotice v-else-if="error" tone="error" title="Could not load this listing">
        <p>Please refresh the page to try again.</p>
      </MarketNotice>

      <MarketNotice v-else-if="!isOwnListing" title="Only the seller can edit this listing">
        <RouterLink :to="{ name: 'ticket-detail', params: { id } }">View the listing</RouterLink>
      </MarketNotice>

      <MarketNotice v-else-if="listing.status !== 'active'" title="This listing can no longer be edited">
        It has been sold or removed. <RouterLink to="/my-listings">Back to my listings</RouterLink>
      </MarketNotice>

      <template v-else>
        <header class="edit-page__header">
          <h1>Edit listing</h1>
          <p>{{ listingTitle(listing) }} · {{ formatDate(listing.concert.event_date) }} · {{ listing.concert.venue }}</p>
        </header>

        <form class="edit-form" @submit.prevent="save">
          <ImagePicker v-model="newImage" :current-url="listing.imageUrl ?? ''" class="edit-form__wide" @error="saveError = $event" />

          <label class="edit-form__field">
            Total listing price (SGD)
            <input v-model.number="draft.price" type="number" min="0" step="0.01" required />
          </label>
          <label class="edit-form__field">
            Number of tickets
            <input v-model.number="draft.quantity" type="number" min="1" max="10" required />
          </label>
          <label class="edit-form__field edit-form__wide">
            Section
            <input v-model.trim="draft.section" list="edit-section-suggestions" required maxlength="120" />
            <datalist id="edit-section-suggestions">
              <option v-for="s in SECTION_SUGGESTIONS" :key="s" :value="s" />
            </datalist>
          </label>
          <label class="edit-form__field edit-form__wide">
            Description
            <textarea v-model.trim="draft.description" rows="4" maxlength="2000" placeholder="Describe the ticket, section and any transfer arrangements." />
          </label>

          <p v-if="saveError" class="edit-form__error edit-form__wide" role="alert">{{ saveError }}</p>
          <p v-if="saveNotice" class="edit-form__wide" role="status">{{ saveNotice }}</p>
          <div class="edit-form__actions edit-form__wide">
            <button type="button" class="btn btn--ghost" @click="leave">Cancel</button>
            <button class="btn btn--primary" type="submit" :disabled="saving">
              <LoadingSpinner v-if="saving" /> {{ saving ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
        </form>
      </template>
    </div>
  </div>
</template>

<style scoped>
.edit-page {
  min-height: calc(100vh - var(--header-height));
  padding-block: var(--space-7) var(--space-9);
}
.edit-page__shell {
  max-width: 820px;
}
.edit-page__header {
  margin-block: var(--space-4) var(--space-5);
}
.edit-page__header h1 {
  font-size: var(--step-3);
}
.edit-page__header p {
  margin-top: var(--space-1);
  color: var(--text-300);
}
.edit-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  padding: var(--space-5);
  border: var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--ink-850);
}
.edit-form__wide {
  grid-column: 1 / -1;
}
.edit-form__field {
  display: grid;
  min-width: 0;
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
}
.edit-form input,
.edit-form textarea {
  width: 100%;
  min-width: 0;
  padding: var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--field-bg);
}
.edit-form textarea {
  resize: vertical;
}
.edit-form__error {
  color: var(--rose-400);
}
.edit-form__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-3);
}
@media (max-width: 600px) {
  .edit-form {
    grid-template-columns: 1fr;
  }
  .edit-form__wide {
    grid-column: auto;
  }
  .edit-form__actions .btn {
    flex: 1;
    text-align: center;
  }
}
</style>
