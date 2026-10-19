<script setup>
import { nextTick, ref, watch } from 'vue';
import LoadingSpinner from './LoadingSpinner.vue';

/**
 * A confirmation step for actions that cannot be undone.
 *
 * Teleported to the body because the panels it is opened from are stacking
 * contexts: a dialog left inside one renders beneath the fixed site header
 * however high its z-index goes.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Confirm' },
  cancelLabel: { type: String, default: 'Keep it' },
  /** Styles the confirm button as destructive. */
  danger: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['confirm', 'cancel']);

const confirmEl = ref(null);

// Focus lands on the confirm button, so Enter answers and Escape backs out.
watch(() => props.open, async (open) => {
  if (!open) return;
  await nextTick();
  confirmEl.value?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="confirm"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      @click.self="!busy && emit('cancel')"
      @keydown.esc="!busy && emit('cancel')"
    >
      <div class="confirm__panel">
        <h2 class="confirm__title">{{ title }}</h2>
        <p v-if="body" class="confirm__body">{{ body }}</p>
        <div class="confirm__actions">
          <button type="button" class="btn btn--ghost" :disabled="busy" @click="emit('cancel')">
            {{ cancelLabel }}
          </button>
          <button
            ref="confirmEl"
            type="button"
            class="btn"
            :class="danger ? 'confirm__danger' : 'btn--primary'"
            :disabled="busy"
            @click="emit('confirm')"
          >
            <LoadingSpinner v-if="busy" />
            {{ busy ? 'Working…' : confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: grid;
  place-items: center;
  overflow-y: auto;
  padding: var(--space-5);
  background: color-mix(in oklab, var(--ink-900) 62%, transparent);
  backdrop-filter: blur(3px);
  animation: confirm-in var(--dur-fast) var(--ease-out);
}

.confirm__panel {
  width: min(420px, 100%);
  box-sizing: border-box;
  min-width: 0;
  max-height: calc(100dvh - var(--space-5) * 2);
  overflow-y: auto;
  overflow-wrap: anywhere;
  padding: var(--space-6);
  border: var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--ink-800);
  box-shadow: var(--shadow-lg);
  animation: confirm-rise var(--dur-base) var(--ease-settle);
}

.confirm__title { font-size: var(--step-1); }
.confirm__body { margin-top: var(--space-3); color: var(--text-300); font-size: var(--step--1); line-height: 1.55; }

.confirm__actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
.confirm__actions .btn { white-space: normal; }

.confirm__danger {
  border: 1px solid var(--rose-400);
  background: var(--rose-400);
  color: #fff;
}

.confirm__danger:hover:not(:disabled) { background: var(--rose-500); border-color: var(--rose-500); }

@keyframes confirm-in { from { opacity: 0; } }
@keyframes confirm-rise { from { opacity: 0; transform: translateY(8px) scale(0.98); } }

@media (prefers-reduced-motion: reduce) {
  .confirm, .confirm__panel { animation: none; }
}
</style>
