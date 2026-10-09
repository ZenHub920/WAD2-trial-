<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, LABELS } from '../api.js';

const router = useRouter();
const creating = ref(false);
const error = ref('');
const imagePreview = ref('');
const imageInput = ref(null);

const listing = ref({
  title: '',
  venue: '',
  eventDate: '',
  price: '',
  description: '',
  capacity: 1,
  section: 'seated_any',
});

function chooseImage() {
  imageInput.value?.click();
}

function previewImage(event) {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    imagePreview.value = String(reader.result);
  };
  reader.readAsDataURL(file);
}

async function submitListing() {
  const user = JSON.parse(localStorage.getItem('encore-user') ?? 'null');
  if (!user?.id) {
    error.value = 'Please sign in again before listing a ticket.';
    return;
  }

  creating.value = true;
  error.value = '';
  try {
    const price = Number(listing.value.price);
    const spendBand = price <= 100 ? 1 : price <= 250 ? 2 : price <= 500 ? 3 : 4;
    const { concert } = await api.createConcert({
      artist: listing.value.title.trim(),
      venue: listing.value.venue.trim(),
      event_date: listing.value.eventDate,
    });
    await api.createParty(concert.id, {
      host_user_id: user.id,
      capacity: Number(listing.value.capacity),
      section: listing.value.section,
      spend_band: spendBand,
      price_cents: Math.round(price * 100),
      image_data: imagePreview.value || null,
      // Listings still use the matching schema internally, but sellers do not
      // need to provide a meetup arrival preference.
      arrival_plan: 'doors',
      notes: `${listing.value.title}\n${listing.value.description}`.trim(),
    });
    await router.push('/marketplace');
  } catch (err) {
    error.value = err.body?.error ?? err.message;
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <main class="listing-page">
    <div class="listing-page__shell container">
      <RouterLink to="/marketplace" class="listing-page__back">← Back to ticket market</RouterLink>

      <header class="listing-page__header">
        <p class="eyebrow">Sell with Encore</p>
        <h1>List your ticket</h1>
        <p>Share your spare ticket with someone who wants to be there too.</p>
      </header>

      <form class="listing-form" @submit.prevent="submitListing">
        <section class="listing-form__section">
          <h2>Listing details</h2>
          <label class="listing-form__field listing-form__field--wide">
            Add images
            <button type="button" class="image-picker" @click="chooseImage">
              <img v-if="imagePreview" :src="imagePreview" alt="Selected ticket image preview" />
              <span v-else aria-hidden="true">+</span>
              <small>{{ imagePreview ? 'Change image' : 'Add an image' }}</small>
            </button>
            <input ref="imageInput" type="file" accept="image/*" hidden @change="previewImage" />
          </label>

          <label class="listing-form__field listing-form__field--wide">
            Concert title
            <input v-model.trim="listing.title" required placeholder="Enter the artist or concert title" />
          </label>

          <label class="listing-form__field listing-form__field--wide">
            Venue
            <input v-model.trim="listing.venue" required placeholder="Enter the concert venue" />
          </label>

          <label class="listing-form__field">
            Event date
            <input v-model="listing.eventDate" type="date" lang="en-GB" required />
          </label>

          <label class="listing-form__field">
            Ticket price
            <input v-model.number="listing.price" type="number" min="0" step="0.01" required placeholder="0.00" />
          </label>

          <label class="listing-form__field listing-form__field--wide">
            Description
            <textarea v-model.trim="listing.description" rows="4" placeholder="Tell buyers about your ticket..." />
          </label>

          <label class="listing-form__field">
            Number of tickets
            <input v-model.number="listing.capacity" type="number" min="1" max="10" required />
          </label>
          <label class="listing-form__field">
            Seat section
            <select v-model="listing.section">
              <option v-for="(label, section) in LABELS.section" :key="section" :value="section">{{ label }}</option>
            </select>
          </label>
        </section>

        <p v-if="error" class="listing-form__error" role="alert">{{ error }}</p>
        <div class="listing-form__actions">
          <RouterLink to="/marketplace" class="btn btn--ghost">Cancel</RouterLink>
          <button class="btn btn--primary" :disabled="creating">
            {{ creating ? 'Publishing…' : 'Publish listing' }}
          </button>
        </div>
      </form>
    </div>
  </main>
</template>

<style scoped>
.listing-page {
  min-height: calc(100vh - var(--header-height));
  padding-block: var(--space-7) var(--space-9);
  background: radial-gradient(circle at 90% 0%, color-mix(in oklab, var(--accent-500) 12%, transparent), transparent 32rem), var(--ink-900);
}
.listing-page__shell { max-width: 820px; }
.listing-page__back { color: var(--text-300); text-decoration: none; font-size: var(--step--1); }
.listing-page__header { margin-block: var(--space-7) var(--space-6); }
.listing-page__header h1 { margin-top: var(--space-2); }
.listing-page__header p:last-child { margin-top: var(--space-3); color: var(--text-300); }
.listing-form { display: grid; gap: var(--space-5); }
.listing-form__section { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); padding: var(--space-5); border: var(--border-soft); border-radius: var(--radius-lg); background: var(--ink-850); }
.listing-form__section h2 { grid-column: 1 / -1; font-size: var(--step-1); }
.listing-form__field { display: grid; gap: var(--space-2); color: var(--text-300); font-size: var(--step--1); }
.listing-form__field--wide { grid-column: 1 / -1; }
.listing-form input, .listing-form select, .listing-form textarea { width: 100%; padding: var(--space-3); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-700); }
.listing-form textarea { resize: vertical; }
.image-picker { position: relative; display: grid; place-items: center; min-height: 170px; overflow: hidden; border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-700); color: var(--accent-300); font-size: 2rem; }
.image-picker img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.image-picker small { position: absolute; right: var(--space-3); bottom: var(--space-3); padding: 3px 8px; border-radius: var(--radius-pill); background: rgb(0 0 0 / 60%); color: white; font-size: var(--step--2); }
.listing-form__error { color: var(--rose-400); }
.listing-form__actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
@media (max-width: 600px) {
  .listing-form__section { grid-template-columns: 1fr; }
  .listing-form__field--wide { grid-column: auto; }
  .listing-form__actions { justify-content: stretch; }
  .listing-form__actions .btn { flex: 1; text-align: center; }
}
</style>
