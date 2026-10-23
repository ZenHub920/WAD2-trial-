<script setup>
/**
 * Choose, replace or remove a profile picture.
 *
 * Optional by design: "Remove" is always offered once a picture exists, and
 * the empty state is a silhouette with a quiet invitation rather than a
 * prompt that implies something is missing.
 *
 * The file is read to a data URL in the browser and sent as JSON, matching how
 * ticket photos already travel in this app — no multipart handling to add on
 * the server. Size is checked here for a fast, clear error; the server
 * re-validates the actual bytes regardless, because a client-side check is a
 * courtesy, not a control.
 */

import { ref } from 'vue';
import UserAvatar from './UserAvatar.vue';
import LoadingSpinner from './LoadingSpinner.vue';

const props = defineProps({
  src: { type: String, default: null },
  name: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  size: { type: Number, default: 96 },
});

const emit = defineEmits(['select', 'remove']);

const input = ref(null);
const error = ref('');
const reading = ref(false);

/** Matches the server's limit, so the failure is explained before upload. */
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function choose() {
  error.value = '';
  input.value?.click();
}

function onFile(event) {
  const file = event.target.files?.[0];
  // Clear immediately so picking the same file twice still fires a change.
  event.target.value = '';
  if (!file) return;

  if (!ACCEPTED.includes(file.type)) {
    error.value = 'Use a PNG, JPEG, GIF or WebP image.';
    return;
  }
  if (file.size > MAX_BYTES) {
    error.value = 'That image is over 2MB. Try a smaller one.';
    return;
  }

  const reader = new FileReader();
  reading.value = true;
  reader.onload = () => emit('select', reader.result);
  reader.onerror = () => { error.value = 'Could not read that file.'; };
  reader.onloadend = () => { reading.value = false; };
  reader.readAsDataURL(file);
}
</script>

<template>
  <div class="picker">
    <slot name="preview"><UserAvatar :src="src" :name="name" :size="size" /></slot>

    <div class="picker__actions">
      <button class="btn btn--ghost" type="button" :disabled="busy || reading" @click="choose">
        {{ src ? 'Change picture' : 'Add a picture' }}
        <LoadingSpinner v-if="busy || reading" />
      </button>
      <button
        v-if="src"
        class="picker__remove"
        type="button"
        :disabled="busy || reading"
        @click="emit('remove')"
      >Remove</button>

      <p class="picker__hint">
        Optional. PNG, JPEG, GIF or WebP, up to 2MB.
      </p>
      <p v-if="error" class="picker__error" role="alert">{{ error }}</p>
    </div>

    <input
      ref="input"
      hidden
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      :disabled="busy || reading"
      @change="onFile"
    />
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  align-items: center;
  gap: var(--space-5);
}

.picker__actions { display: grid; min-width: 0; gap: var(--space-2); justify-items: start; overflow-wrap: anywhere; }

.picker__remove {
  border: 0;
  background: none;
  padding: 0;
  color: var(--rose-400);
  font: inherit;
  font-size: var(--step--1);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.picker__remove:disabled { opacity: 0.5; cursor: not-allowed; }

.picker__hint { margin: 0; font-size: var(--step--2); color: var(--text-400); max-width: 34ch; }
.picker__error { margin: 0; font-size: var(--step--2); color: var(--rose-400); }

@media (max-width: 520px) {
  .picker { flex-direction: column; align-items: flex-start; }
}
</style>
