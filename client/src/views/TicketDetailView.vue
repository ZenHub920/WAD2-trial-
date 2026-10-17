<script setup>
import { computed, ref, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { currentUser } from '../auth.js';
import { SECTION_SUGGESTIONS, sectionLabel, useSavedListings, useTicket } from '../market.js';
import ListingDetailCard from '../components/market/ListingDetailCard.vue';
import MarketNotice from '../components/market/MarketNotice.vue';
import MarketPageHead from '../components/market/MarketPageHead.vue';

/**
 * One ticket listing, as the full listing card. Buyers can chat with the seller
 * or buy; the seller can edit or remove their own listing instead.
 */
const props = defineProps({ id: { type: String, required: true } });

const route = useRoute();
const router = useRouter();
const { listing, loading, error } = useTicket(() => props.id);
const { isSaved, toggle } = useSavedListings();

const isOwnListing = computed(() =>
  Boolean(currentUser.value?.id && listing.value?.seller?.id === currentUser.value.id),
);
const busy = ref(false);

// One polite status line for actions that do not navigate.
const message = ref('');
let clear;
function announce(text) {
  message.value = text;
  clearTimeout(clear);
  clear = setTimeout(() => { message.value = ''; }, 3200);
}
onUnmounted(() => clearTimeout(clear));

function signInFirst() {
  router.push({ name: 'login', query: { redirect: route.fullPath } });
}

function buy() {
  router.push({ name: 'order-review', params: { id: props.id } });
}

/** Open (or reopen) this buyer's conversation with the seller about this listing. */
async function chat() {
  // No up-front sign-in check: the session may still be loading, so let the API decide.
  busy.value = true;
  try {
    const { conversation } = await api.startChat(props.id);
    router.push({ name: 'chat-thread', params: { id: conversation.id } });
  } catch (err) {
    if (err.status === 401) return signInFirst();
    announce('Could not open the chat. Please try again.');
  } finally {
    busy.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    announce('Link copied.');
  } catch {
    announce('Could not copy the link.');
  }
}

async function removeListing() {
  if (!window.confirm('Remove this listing?')) return;
  busy.value = true;
  try {
    await api.deleteTicket(listing.value.id);
    await router.push('/my-listings');
  } catch (err) {
    announce(err.body?.error ?? err.message);
  } finally {
    busy.value = false;
  }
}

// ---- Editing (seller only)
const editing = ref(false);
const saving = ref(false);
const editImage = ref('');
const editError = ref('');
const draft = ref({ price: 0, quantity: 1, section: '', description: '' });

function startEditing() {
  draft.value = {
    price: listing.value.priceCents / 100,
    quantity: listing.value.quantity,
    section: sectionLabel(listing.value.section),
    description: listing.value.description ?? '',
  };
  editImage.value = '';
  editError.value = '';
  editing.value = true;
}

function previewEditImage(event) {
  const [file] = event.target.files;
  if (!file) return;
  editError.value = '';
  const reader = new FileReader();
  reader.onload = () => { editImage.value = String(reader.result); };
  reader.onerror = () => { editError.value = 'Could not read the selected image.'; };
  reader.readAsDataURL(file);
}

async function saveListing() {
  saving.value = true;
  editError.value = '';
  try {
    const { listing: updated } = await api.updateTicket(listing.value.id, {
      priceCents: Math.round(Number(draft.value.price) * 100),
      quantity: Number(draft.value.quantity),
      section: draft.value.section,
      description: draft.value.description,
      ...(editImage.value ? { imageData: editImage.value } : {}),
    });
    listing.value = updated;
    editing.value = false;
    announce('Listing updated.');
  } catch (err) {
    const code = err.body?.error ?? err.message;
    editError.value = code === 'quantity_locked_by_ticket_numbers'
      ? 'The number of tickets is fixed once ticket numbers are attached.'
      : code;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="container flow">
    <MarketPageHead title="Listing details" />

    <div v-if="loading" class="skeleton" aria-busy="true" />

    <MarketNotice v-else-if="error?.status === 404" title="Listing not found">
      It may have been removed. <RouterLink :to="{ name: 'marketplace' }">Back to the market</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error" tone="error" title="Could not load this listing">
      <p>Please refresh the page to try again.</p>
    </MarketNotice>

    <template v-else>
      <ListingDetailCard
        :listing="listing"
        :saved="isSaved(listing.id)"
        :own="isOwnListing"
        :busy="busy || editing"
        @toggle-save="toggle"
        @buy="buy"
        @chat="chat"
        @edit="startEditing"
        @remove="removeListing"
        @copy-link="copyLink"
      />

      <form v-if="isOwnListing && editing" class="edit" @submit.prevent="saveListing">
        <h2>Edit listing</h2>
        <label>Ticket price
          <input v-model.number="draft.price" type="number" min="0" step="0.01" required />
        </label>
        <label>Number of tickets
          <input v-model.number="draft.quantity" type="number" min="1" max="10" required />
        </label>
        <label>Section
          <input v-model.trim="draft.section" list="edit-section-suggestions" required maxlength="120" />
          <datalist id="edit-section-suggestions">
            <option v-for="s in SECTION_SUGGESTIONS" :key="s" :value="s" />
          </datalist>
        </label>
        <label>Description
          <textarea v-model.trim="draft.description" rows="4" />
        </label>
        <label>Replace image
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="previewEditImage" />
        </label>
        <img v-if="editImage" class="edit__preview" :src="editImage" alt="New listing image preview" />
        <p v-if="editError" class="edit__error" role="alert">{{ editError }}</p>
        <div class="edit__actions">
          <button class="btn btn--ghost" type="button" :disabled="saving" @click="editing = false">Cancel</button>
          <button class="btn btn--primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save changes' }}</button>
        </div>
      </form>
    </template>

    <p class="toast" role="status" aria-live="polite">
      <span v-if="message">{{ message }}</span>
    </p>
  </div>
</template>

<style scoped>
.flow {
  max-width: 620px;
  padding-block: var(--space-5) var(--space-8);
}

.skeleton {
  height: 720px;
}

.edit {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-5);
  padding: var(--space-5);
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  background: var(--ink-800);
}

.edit h2 {
  font-size: var(--step-1);
}

.edit label {
  display: grid;
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
}

.edit input,
.edit textarea {
  width: 100%;
  padding: var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--ink-700);
}

.edit__preview {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
}

.edit__error {
  color: var(--rose-400);
  font-size: var(--step--1);
}

.edit__actions {
  display: flex;
  gap: var(--space-3);
}

.edit__actions .btn {
  flex: 1;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: calc(var(--tabbar-height, 0px) + var(--space-5));
  transform: translateX(-50%);
  z-index: 50;
  max-width: calc(100% - 2 * var(--gutter));
}

.toast span {
  display: block;
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-pill);
  background: var(--text-100);
  color: var(--ink-900);
  font-size: var(--step--1);
  font-weight: 500;
  box-shadow: var(--shadow-lg);
}
</style>
