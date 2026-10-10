<script setup>
import { computed, ref, watch } from 'vue';
import { api, formatDate, LABELS } from '../api.js';
import { currentUser } from '../auth.js';
import { useRouter } from 'vue-router';

const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();
const listing = ref(null);
const loading = ref(true);
const error = ref('');
const message = ref('');
const removing = ref(false);
const editing = ref(false);
const saving = ref(false);
const editImage = ref('');
const draft = ref({ price: 0, quantity: 1, section: 'seated_any', description: '' });

const isOwnListing = computed(() =>
  Boolean(currentUser.value?.id && listing.value?.seller?.id === currentUser.value.id),
);

watch(() => props.id, async (id) => {
  loading.value = true;
  error.value = '';
  listing.value = null;
  editing.value = false;
  try {
    listing.value = (await api.ticket(id)).listing;
  } catch (err) {
    error.value = err.body?.error ?? err.message;
  } finally {
    loading.value = false;
  }
}, { immediate: true });

function startEditing() {
  draft.value = {
    price: listing.value.priceCents / 100,
    quantity: listing.value.quantity,
    section: listing.value.section,
    description: listing.value.description ?? '',
  };
  editImage.value = '';
  message.value = '';
  editing.value = true;
}

function previewEditImage(event) {
  const [file] = event.target.files;
  if (!file) return;
  message.value = '';
  const reader = new FileReader();
  reader.onload = () => { editImage.value = String(reader.result); };
  reader.onerror = () => { message.value = 'Could not read the selected image.'; };
  reader.readAsDataURL(file);
}

async function saveListing() {
  saving.value = true;
  message.value = '';
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
    message.value = 'Listing updated.';
  } catch (err) {
    message.value = err.body?.error ?? err.message;
  } finally {
    saving.value = false;
  }
}

function showMessage(text) {
  message.value = text;
}

async function removeListing() {
  if (!window.confirm('Remove this listing?')) return;
  removing.value = true;
  message.value = '';
  try {
    await api.deleteTicket(listing.value.id);
    await router.push('/my-listings');
  } catch (err) {
    message.value = err.body?.error ?? err.message;
  } finally {
    removing.value = false;
  }
}
</script>

<template>
  <main class="ticket-detail-page">
    <div class="ticket-detail-page__shell container">
      <RouterLink to="/marketplace" class="ticket-detail__back">← Back to ticket market</RouterLink>

      <div v-if="loading" class="ticket-detail__loading">Loading ticket details…</div>
      <div v-else-if="error" class="notice notice--error">{{ error }}</div>
      <article v-else class="ticket-detail">
        <img v-if="listing.imageUrl" class="ticket-detail__image" :src="listing.imageUrl" alt="Ticket listing" />
        <div class="ticket-detail__content">
          <div class="ticket-detail__seller">
            <span class="seller-avatar">{{ listing.seller.displayName.slice(0, 1) }}</span>
            <span>Listed by {{ listing.seller.displayName }}</span>
          </div>
          <p class="eyebrow">Ticket listing</p>
          <h1>{{ listing.concert.artist }}</h1>
          <p class="ticket-detail__date">
            {{ formatDate(listing.concert.event_date) }} · {{ listing.concert.venue }}
          </p>
          <p v-if="listing.description" class="ticket-detail__description">{{ listing.description }}</p>
          <div class="ticket-detail__meta">
            <span>{{ LABELS.section[listing.section] }}</span>
            <span>{{ listing.quantity }} {{ listing.quantity === 1 ? 'ticket' : 'tickets' }}</span>
            <strong>${{ (listing.priceCents / 100).toFixed(2) }}</strong>
          </div>
          <form v-if="isOwnListing && editing" class="ticket-detail__edit" @submit.prevent="saveListing">
            <label>Ticket price
              <input v-model.number="draft.price" type="number" min="0" step="0.01" required />
            </label>
            <label>Number of tickets
              <input v-model.number="draft.quantity" type="number" min="1" max="10" required />
            </label>
            <label>Seat section
              <select v-model="draft.section">
                <option v-for="(label, section) in LABELS.section" :key="section" :value="section">{{ label }}</option>
              </select>
            </label>
            <label>Description
              <textarea v-model.trim="draft.description" rows="4" />
            </label>
            <label>Replace image
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="previewEditImage" />
            </label>
            <img v-if="editImage" class="ticket-detail__edit-preview" :src="editImage" alt="New listing image preview" />
            <div class="ticket-detail__actions">
              <button class="btn btn--ghost" type="button" :disabled="saving" @click="editing = false">Cancel</button>
              <button class="btn btn--primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save changes' }}</button>
            </div>
          </form>
          <div v-else-if="isOwnListing" class="ticket-detail__actions">
            <button class="btn btn--ghost" type="button" @click="startEditing">Edit listing</button>
            <button class="btn btn--primary" type="button" :disabled="removing" @click="removeListing">
              {{ removing ? 'Removing…' : 'Remove listing' }}
            </button>
          </div>
          <div v-else class="ticket-detail__actions">
            <button class="btn btn--ghost" type="button" @click="showMessage('Chat will be available soon.')">Chat</button>
            <button class="btn btn--primary" type="button" @click="showMessage('Buying tickets will be available soon.')">Buy</button>
          </div>
          <p v-if="message" class="ticket-detail__message" role="status">{{ message }}</p>
        </div>
      </article>
    </div>
  </main>
</template>

<style scoped>
.ticket-detail-page { min-height: calc(100vh - var(--header-height)); padding-block: var(--space-5) 4rem; background: var(--ink-900); }
.ticket-detail-page__shell { max-width: 760px; }
.ticket-detail__back { color: var(--text-300); text-decoration: none; font-size: var(--step--1); }
.ticket-detail { display: grid; grid-template-columns: 1fr; margin-top: var(--space-4); overflow: hidden; border: var(--border-soft); border-radius: var(--radius-lg); background: var(--ink-850); }
.ticket-detail__image { display: block; width: 100%; max-height: 240px; object-fit: cover; }
.ticket-detail__content { padding: var(--space-5); }
.ticket-detail__seller { display: flex; align-items: center; gap: var(--space-2); color: var(--text-300); font-size: var(--step--1); margin-bottom: var(--space-3); }
.ticket-detail h1 { margin-top: var(--space-2); font-size: var(--step-3); }
.ticket-detail__date { margin-top: var(--space-2); color: var(--text-300); }
.ticket-detail__description { margin-top: var(--space-3); white-space: pre-line; color: var(--text-200); }
.ticket-detail__meta { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4); }
.ticket-detail__meta span { padding: 5px 9px; border-radius: var(--radius-pill); background: var(--ink-700); color: var(--text-300); font-size: var(--step--1); }
.ticket-detail__meta strong { margin-left: auto; color: var(--accent-300); font-size: var(--step-1); }
.ticket-detail__edit { display: grid; gap: var(--space-3); margin-top: var(--space-4); }
.ticket-detail__edit label { display: grid; gap: var(--space-2); color: var(--text-300); }
.ticket-detail__edit input, .ticket-detail__edit select, .ticket-detail__edit textarea { width: 100%; padding: var(--space-3); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-700); }
.ticket-detail__edit-preview { max-width: 100%; max-height: 180px; object-fit: contain; }
.ticket-detail__actions { display: flex; gap: var(--space-3); margin-top: var(--space-4); }
.ticket-detail__actions .btn { flex: 1; text-align: center; }
.ticket-detail__message { margin-top: var(--space-3); color: var(--text-300); text-align: center; }
.ticket-detail__loading { padding: 6rem 0; color: var(--text-300); }
@media (max-width: 650px) {
  .ticket-detail__image { max-height: 200px; }
  .ticket-detail__content { padding: var(--space-5); }
}
</style>
