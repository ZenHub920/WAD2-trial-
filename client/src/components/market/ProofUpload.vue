<script setup>
import { ref } from 'vue';
import LoadingSpinner from '../LoadingSpinner.vue';

/**
 * Pick a proof-of-purchase file (screenshot or PDF) and hand it back as a data URL.
 * Only an admin ever sees it; buyers just see the badge once it is approved.
 */
const model = defineModel({ type: String, default: '' });

// The server caps the data URL at ~3M chars; base64 adds a third, so 2MB of file fits.
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

const input = ref(null);
const fileName = ref('');
const error = ref('');
const reading = ref(false);

function pick(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  error.value = '';
  if (!ACCEPT.split(',').includes(file.type)) {
    error.value = 'Use a PNG, JPG, WebP or PDF.';
    return;
  }
  if (file.size > MAX_BYTES) {
    error.value = 'That file is over 2 MB. Try a cropped screenshot.';
    return;
  }
  reading.value = true;
  const reader = new FileReader();
  reader.onload = () => {
    model.value = String(reader.result);
    fileName.value = file.name;
  };
  reader.onloadend = () => { reading.value = false; };
  reader.readAsDataURL(file);
}

function clear() {
  model.value = '';
  fileName.value = '';
}
</script>

<template>
  <div class="proof">
    <div class="proof__row">
      <button type="button" class="proof__pick" :disabled="reading" @click="input?.click()">
        <LoadingSpinner v-if="reading" />
        {{ model ? 'Change file' : 'Upload proof of purchase' }}
      </button>
      <span v-if="model" class="proof__name">{{ fileName || 'File attached' }}</span>
      <button v-if="model" type="button" class="proof__clear" :disabled="reading" @click="clear">Remove</button>
    </div>
    <input ref="input" type="file" :accept="ACCEPT" hidden @change="pick" />
    <p class="proof__hint">
      A screenshot or PDF of your order confirmation or e-ticket, showing the event and
      order number. Only reviewers see it; buyers see a ticket verification badge once approved.
    </p>
    <p v-if="error" class="proof__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.proof__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.proof__pick {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: 1px dashed var(--accent-400);
  border-radius: var(--radius-md);
  color: var(--accent-400);
  font-size: var(--step--1);
  font-weight: 500;
}

.proof__pick:hover {
  background: color-mix(in oklab, var(--accent-500) 10%, transparent);
}

.proof__name {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-200);
  font-size: var(--step--1);
}

.proof__clear {
  color: var(--text-400);
  font-size: var(--step--2);
  text-decoration: underline;
}

.proof__hint {
  margin-top: var(--space-2);
  color: var(--text-400);
  font-size: var(--step--2);
}

.proof__error {
  margin-top: var(--space-2);
  color: var(--rose-400);
  font-size: var(--step--1);
}
</style>
