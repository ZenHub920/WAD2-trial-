<script setup>
import { ref } from 'vue';
import LoadingSpinner from '../LoadingSpinner.vue';

/**
 * A large clickable tile for choosing a listing image. Shows the new image, else
 * the current one, else a "+" prompt. v-model holds the newly chosen image as a
 * data URL ('' until the user picks one).
 */
const props = defineProps({
  modelValue: { type: String, default: '' },
  /** The image already on the listing, shown until a new one is chosen. */
  currentUrl: { type: String, default: '' },
  label: { type: String, default: 'Listing image' },
});
const emit = defineEmits(['update:modelValue', 'error']);

const input = ref(null);
const reading = ref(false);

function pick(event) {
  const [file] = event.target.files;
  if (!file) return;
  reading.value = true;
  const reader = new FileReader();
  reader.onload = () => emit('update:modelValue', String(reader.result));
  reader.onerror = () => emit('error', 'Could not read the selected image.');
  reader.onloadend = () => { reading.value = false; };
  reader.readAsDataURL(file);
}
</script>

<template>
  <div class="image-field">
    <span class="image-field__label">{{ label }}</span>
    <button type="button" class="image-picker" :aria-label="modelValue || currentUrl ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`" @click="input?.click()">
      <img v-if="modelValue || currentUrl" :src="modelValue || currentUrl" alt="" />
      <span v-else aria-hidden="true">+</span>
      <small>{{ modelValue || currentUrl ? 'Change image' : 'Add an image' }}</small>
    </button>
    <input ref="input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden @change="pick" />
    <span v-if="reading" class="loading-state"><LoadingSpinner /> Loading image…</span>
    <span v-else class="image-field__hint">PNG, JPG, GIF or WebP, up to 2 MB.<template v-if="modelValue && currentUrl"> Saving replaces the current image.</template></span>
  </div>
</template>

<style scoped>
.image-field {
  display: grid;
  min-width: 0;
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
}
.image-picker {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 170px;
  overflow: hidden;
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--ink-700);
  color: var(--accent-400);
  font-size: 2rem;
}
.image-picker:hover,
.image-picker:focus-visible {
  border-color: var(--accent-400);
}
.image-picker img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.image-picker small {
  position: absolute;
  right: var(--space-3);
  bottom: var(--space-3);
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: rgb(0 0 0 / 60%);
  color: white;
  font-size: var(--step--2);
}
.image-field__hint {
  color: var(--text-400);
  font-size: var(--step--2);
}
</style>
