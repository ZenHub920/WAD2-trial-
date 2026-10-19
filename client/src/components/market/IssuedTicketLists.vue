<script setup>
import { ref, onMounted } from 'vue';
import { api, formatDate } from '../../api.js';
import LoadingSpinner from '../LoadingSpinner.vue';

/**
 * Operator: the official issued-ticket list for each concert. A seller's ticket
 * numbers are verified automatically against these, so a concert needs a list
 * before its listings can verify without proof review.
 */
const concerts = ref([]);
const loading = ref(true);
const error = ref('');
const openId = ref('');
const csv = ref('');
const importing = ref(false);
const reading = ref(false);
const result = ref({});

async function load() {
  try {
    concerts.value = (await api.issuedTicketSummary()).concerts;
  } catch (err) {
    error.value = 'Could not load issued ticket lists. Refresh the page to try again.';
  } finally {
    loading.value = false;
  }
}

function toggle(id) {
  openId.value = openId.value === id ? '' : id;
  csv.value = '';
}

async function readFile(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  reading.value = true;
  try {
    csv.value = await file.text();
  } finally {
    reading.value = false;
  }
}

async function importList(concert) {
  importing.value = true;
  result.value = { ...result.value, [concert.id]: '' };
  try {
    const { added, skipped } = await api.importIssuedTickets(concert.id, csv.value);
    result.value = {
      ...result.value,
      [concert.id]: `Added ${added} ticket number${added === 1 ? '' : 's'}${skipped ? ` (${skipped} already on the list)` : ''}.`,
    };
    csv.value = '';
    openId.value = '';
    await load();
  } catch (err) {
    result.value = {
      ...result.value,
      [concert.id]: err.message === 'invalid_ticket_numbers'
        ? `Some lines aren’t valid ticket numbers: line ${err.body.lines.join(', ')}.`
        : err.message === 'no_ticket_numbers' ? 'No ticket numbers found.' : 'Import failed.',
    };
  } finally {
    importing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="issued">
    <h2>Issued ticket lists</h2>
    <p class="issued__lede">
      Import the ticket numbers issued for each concert. Matching numbers verify a ticket
      listing, not a seller or a completed transfer. Uploaded proofs appear in the review queue.
    </p>
    <p v-if="importing && !openId" class="loading-state"><LoadingSpinner /> Importing…</p>

    <p v-if="error" class="issued__error" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="loading-state" role="status"><LoadingSpinner /> Loading issued ticket lists…</p>
    <p v-else-if="!concerts.length" class="issued__lede">No concerts are available for ticket number imports.</p>

    <ul v-else class="issued__list">
      <li v-for="concert in concerts" :key="concert.id" class="row">
        <div class="row__main">
          <div class="row__name">
            <strong>{{ concert.artist }}</strong>
            <span>{{ formatDate(concert.event_date) }}, {{ concert.venue }}</span>
          </div>
          <span class="row__count tabular" :class="{ 'row__count--none': !concert.issued }">
            {{ concert.issued ? `${concert.issued} issued, ${concert.listed} listed` : 'No list' }}
          </span>
          <button class="btn btn--ghost row__btn" type="button" :aria-expanded="openId === concert.id" @click="toggle(concert.id)">
            {{ openId === concert.id ? 'Cancel' : 'Import' }}
          </button>
        </div>
        <p v-if="result[concert.id]" class="row__result" role="status">{{ result[concert.id] }}</p>

        <form v-if="openId === concert.id" class="row__import" @submit.prevent="importList(concert)">
          <label>
            One ticket per line: <code>ticket_number,category</code> (category optional)
            <textarea v-model="csv" rows="5" spellcheck="false" placeholder="ticket_number,category&#10;SER-CAT3-0001,Cat 3&#10;SER-CAT3-0002,Cat 3" />
          </label>
          <div class="row__actions">
            <label class="row__file">
              Or choose a .csv file
              <input type="file" accept=".csv,text/csv,text/plain" @change="readFile" />
              <span v-if="reading" class="loading-state"><LoadingSpinner /> Loading file…</span>
            </label>
            <button class="btn btn--primary" type="submit" :disabled="importing || !csv.trim()">
              <LoadingSpinner v-if="importing" />
              {{ importing ? 'Importing…' : 'Import list' }}
            </button>
          </div>
        </form>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.issued {
  margin-bottom: var(--space-7);
  padding: var(--space-5);
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  background: var(--ink-800);
}

.issued h2 {
  font-size: var(--step-1);
}

.issued__lede {
  margin-top: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
}

.issued__error {
  margin-top: var(--space-3);
  color: var(--rose-400);
}

.issued__list {
  display: grid;
  margin-top: var(--space-4);
  padding: 0;
  list-style: none;
}

.row {
  padding-block: var(--space-3);
  min-width: 0;
  overflow-wrap: anywhere;
  border-top: var(--border-hairline);
}

.row__main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.row__name {
  flex: 1;
  min-width: min(200px, 100%);
  display: grid;
}

.row__name strong {
  color: var(--text-100);
}

.row__name span {
  color: var(--text-400);
  font-size: var(--step--2);
}

.row__count {
  color: var(--mint-400);
  font-size: var(--step--1);
}

.row__count--none {
  color: var(--text-400);
}

.row__btn {
  padding-block: var(--space-2);
}

.row__result {
  margin-top: var(--space-2);
  color: var(--text-200);
  font-size: var(--step--1);
}

.row__import {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.row__import label {
  display: grid;
  min-width: 0;
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
}

.row__import textarea {
  width: 100%;
  padding: var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--ink-700);
  font-family: var(--font-mono);
  font-size: var(--step--1);
}

.row__actions {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.row__file input {
  max-width: 100%;
  font-size: var(--step--2);
}
</style>
