<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, formatDate } from '../api.js';
import { SECTION_SUGGESTIONS } from '../market.js';
import ProofUpload from '../components/market/ProofUpload.vue';

const router = useRouter();
const creating = ref(false);
const error = ref('');
const imagePreview = ref('');
const imageInput = ref(null);
const proof = ref('');

// Listing against an existing concert is what lets ticket numbers be checked
// against that concert's issued list; a newly added concert has no list yet.
const concerts = ref([]);
const concertId = ref('');
const addingConcert = ref(false);

onMounted(async () => {
  try {
    concerts.value = (await api.concerts()).concerts;
    if (!concerts.value.length) addingConcert.value = true;
  } catch {
    addingConcert.value = true; // still lets the seller list by adding the concert
  }
});

const listing = ref({
  title: '',
  venue: '',
  eventDate: '',
  price: '',
  description: '',
  quantity: 1,
  section: '',
});

// One ticket-number box per ticket, keeping whatever was already typed.
const ticketNumbers = ref(['']);
const badNumber = ref('');
watch(() => listing.value.quantity, (count) => {
  const n = Math.min(Math.max(Number(count) || 1, 1), 10);
  ticketNumbers.value = Array.from({ length: n }, (_, i) => ticketNumbers.value[i] ?? '');
});

const normalise = (n) => n.trim().toUpperCase().replace(/[\s-]+/g, '-');

const ERROR_COPY = {
  ticket_number_not_issued: (n) => `${n} isn’t on this concert’s issued ticket list. Check it against your ticket.`,
  ticket_category_mismatch: (n) => `${n} was issued for a different section. Check the section matches your ticket.`,
  ticket_number_already_listed: (n) => `${n} is already listed for sale.`,
  duplicate_ticket_number: (n) => `${n} is entered more than once.`,
  invalid_ticket_number: () => 'Ticket numbers use letters, digits, spaces and dashes (3–40 characters).',
  one_ticket_number_per_ticket: () => 'Enter a ticket number for every ticket, or leave them all blank.',
};

function chooseImage() {
  imageInput.value?.click();
}

function previewImage(event) {
  const [file] = event.target.files;
  if (!file) return;
  error.value = '';
  const reader = new FileReader();
  reader.onload = () => {
    imagePreview.value = String(reader.result);
  };
  reader.onerror = () => { error.value = 'Could not read the selected image.'; };
  reader.readAsDataURL(file);
}

async function submitListing() {
  creating.value = true;
  error.value = '';
  badNumber.value = '';
  const numbers = ticketNumbers.value.map((n) => n.trim());
  try {
    const { listing: created } = await api.createTicket({
      ...(addingConcert.value
        ? {
          concert: {
            artist: listing.value.title.trim(),
            venue: listing.value.venue.trim(),
            event_date: listing.value.eventDate,
          },
        }
        : { concertId: concertId.value }),
      priceCents: Math.round(Number(listing.value.price) * 100),
      quantity: Number(listing.value.quantity),
      section: listing.value.section,
      description: listing.value.description,
      ...(imagePreview.value ? { imageData: imagePreview.value } : {}),
      // Numbers are optional, but all-or-none: one per ticket when given.
      ...(numbers.some(Boolean) ? { ticketNumbers: numbers } : {}),
      ...(proof.value ? { proofData: proof.value } : {}),
    });
    await router.push({ name: 'ticket-detail', params: { id: created.id } });
  } catch (err) {
    const code = err.body?.error ?? err.message;
    badNumber.value = err.body?.ticketNumber ?? '';
    error.value = err.status === 401
      ? 'Please sign in before listing a ticket.'
      : (ERROR_COPY[code]?.(badNumber.value) ?? code);
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
        <h1>List your ticket</h1>
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
            <input ref="imageInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden @change="previewImage" />
          </label>

          <label v-if="!addingConcert" class="listing-form__field listing-form__field--wide">
            Concert
            <select v-model="concertId" required>
              <option value="" disabled>Choose the concert</option>
              <option v-for="concert in concerts" :key="concert.id" :value="concert.id">
                {{ concert.artist }}, {{ formatDate(concert.event_date) }}, {{ concert.venue }}
              </option>
            </select>
            <button type="button" class="listing-form__link" @click="addingConcert = true">
              Concert not listed? Add it
            </button>
          </label>

          <template v-else>
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
            <p v-if="concerts.length" class="listing-form__field listing-form__field--wide listing-form__hint">
              New concerts require proof of purchase for verification.
              <button type="button" class="listing-form__link" @click="addingConcert = false">Choose an existing concert instead</button>
            </p>
          </template>

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
            <input v-model.number="listing.quantity" type="number" min="1" max="10" required />
          </label>
          <label class="listing-form__field">
            Section
            <input v-model.trim="listing.section" list="section-suggestions" required maxlength="120" placeholder="As printed on the ticket, e.g. Cat 3" />
            <datalist id="section-suggestions">
              <option v-for="s in SECTION_SUGGESTIONS" :key="s" :value="s" />
            </datalist>
          </label>
        </section>

        <section class="listing-form__section">
          <h2>Get the Verified badge <small class="listing-form__optional">optional</small></h2>
          <p class="listing-form__field listing-form__field--wide listing-form__hint">
            Enter the ticket number printed on each ticket. If they’re on the concert’s official
            issued list, your listing is verified straight away. Numbers are only shown to you and,
            after payment, to your buyer.
          </p>
          <label v-for="(_, index) in ticketNumbers" :key="index" class="listing-form__field">
            Ticket {{ index + 1 }} number
            <input
              v-model="ticketNumbers[index]"
              :class="{ 'listing-form__input--bad': badNumber && normalise(ticketNumbers[index]) === badNumber }"
              placeholder="e.g. SER-CAT3-0020"
              autocomplete="off"
              spellcheck="false"
              maxlength="40"
            />
          </label>
          <div class="listing-form__field listing-form__field--wide">
            <p class="listing-form__hint">You can also upload proof of purchase for review.</p>
            <ProofUpload v-model="proof" />
          </div>
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
.listing-form__hint { color: var(--text-400); font-size: var(--step--2); }
.listing-form__link { justify-self: start; padding: 0; color: var(--accent-300); font-size: var(--step--2); text-decoration: underline; }
.listing-form__optional { margin-left: var(--space-2); color: var(--text-400); font-family: var(--font-body); font-size: var(--step--2); font-weight: 400; }
.listing-form__input--bad { border-color: var(--rose-400) !important; }
.listing-form__actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
@media (max-width: 600px) {
  .listing-form__section { grid-template-columns: 1fr; }
  .listing-form__field--wide { grid-column: auto; }
  .listing-form__actions { justify-content: stretch; }
  .listing-form__actions .btn { flex: 1; text-align: center; }
}
</style>
