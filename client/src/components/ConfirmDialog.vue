<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
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
  initialFocus: { type: String, default: 'confirm', validator: value => ['confirm', 'cancel'].includes(value) },
});
const emit = defineEmits(['confirm', 'cancel']);

const confirmEl = ref(null);
const cancelEl = ref(null);
const dialog = ref(null);
let returnFocus = null;
let focusVersion = 0;

function restoreFocus(container = dialog.value) {
  if (returnFocus?.isConnected && (document.activeElement === document.body || container?.contains(document.activeElement))) {
    returnFocus.focus();
  }
  returnFocus = null;
}

// Keep the existing initial action, with a stable focus target while saving.
watch(() => props.open, async (open) => {
  const version = ++focusVersion;
  if (open) returnFocus = document.activeElement;
  await nextTick();
  if (version !== focusVersion) return;
  if (open) (props.busy ? dialog.value : props.initialFocus === 'cancel' ? cancelEl.value : confirmEl.value)?.focus();
  else restoreFocus();
}, { immediate: true });
watch(() => props.busy, async busy => {
  if (!busy || !props.open) return;
  await nextTick();
  if (props.open && props.busy) dialog.value?.focus();
});
onBeforeUnmount(() => { focusVersion++; restoreFocus(); });

function onKeydown(event) {
  if (!props.open || !dialog.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (!props.busy) emit('cancel');
  } else if (event.key === 'Tab') {
    const buttons = [...dialog.value.querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1), active = document.activeElement;
    if (!first) {
      event.preventDefault();
      dialog.value.focus();
    } else if (event.shiftKey && (active === first || !buttons.includes(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !buttons.includes(active))) {
      event.preventDefault();
      first.focus();
    }
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-shell" @before-leave="element => { restoreFocus(element); element.setAttribute('inert', ''); element.setAttribute('aria-hidden', 'true'); }">
    <div
      v-if="open"
      ref="dialog"
      class="confirm"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      :aria-busy="busy"
      tabindex="-1"
      @click.self="!busy && emit('cancel')"
      @keydown="onKeydown"
    >
      <div class="confirm__panel">
        <h2 class="confirm__title">{{ title }}</h2>
        <p v-if="body" class="confirm__body">{{ body }}</p>
        <div class="confirm__actions">
          <button ref="cancelEl" type="button" class="btn btn--ghost" :disabled="busy" @click="emit('cancel')">
            {{ cancelLabel }}
          </button>
          <button
            ref="confirmEl"
            type="button"
            class="btn"
            :class="danger ? 'btn--danger' : 'btn--primary'"
            :disabled="busy"
            @click="emit('confirm')"
          >
            <LoadingSpinner v-if="busy" />
            {{ busy ? 'Working…' : confirmLabel }}
          </button>
        </div>
      </div>
    </div>
    </Transition>
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
}

.confirm__panel {
  width: min(420px, 100%);
  box-sizing: border-box;
  min-width: 0;
  max-height: calc(100dvh - var(--space-5) * 2);
  overflow-y: auto;
  overflow-wrap: anywhere;
  padding: var(--space-6);
  border: 1px solid var(--floating-edge);
  border-radius: var(--radius-lg);
  background: var(--surface-floating);
  box-shadow: var(--floating-shadow);
}

.confirm__title {
  font-size: var(--step-1);
}
.confirm__body {
  margin-top: var(--space-3);
  color: var(--text-300);
  font-size: var(--step--1);
  line-height: 1.55;
}

.confirm__actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
.confirm__actions .btn {
  white-space: normal;
}

.confirm-shell-enter-active { transition: opacity 160ms var(--ease-out); }
.confirm-shell-enter-active .confirm__panel { transition: transform var(--dur-panel) var(--ease-settle); }
.confirm-shell-leave-active { pointer-events: none; transition: opacity 120ms var(--ease-out); }
.confirm-shell-enter-from, .confirm-shell-leave-to { opacity: 0; }
.confirm-shell-enter-from .confirm__panel { transform: translateY(10px) scale(.985); }

@media (prefers-reduced-motion: reduce) {
  .confirm-shell-enter-active, .confirm-shell-leave-active,
  .confirm-shell-enter-active .confirm__panel { transition: none; }
  .confirm-shell-enter-from .confirm__panel { transform: none; }
}
</style>
