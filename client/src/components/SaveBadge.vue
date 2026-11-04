<script setup>
// The small status shown in an autosaving card's header: "Saving…" while a
// save is in flight, then the green "Saved" (its tick comes from .group-success).
import '../assets/groups.css';

defineProps({
  // '' hides the badge; otherwise 'saving' or 'saved'.
  state: { type: String, default: '' },
});
</script>

<template>
  <Transition name="save-badge">
    <p
      v-if="state"
      class="save-badge"
      :class="state === 'saved' ? 'group-success' : 'save-badge--saving'"
      role="status"
    >{{ state === 'saved' ? 'Saved' : 'Saving…' }}</p>
  </Transition>
</template>

<style scoped>
/* Floats at the right of its header (which must be position: relative and
   leave room on the right), so showing or hiding it never moves the content. */
.save-badge {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  margin: 0;
  font-size: var(--step--1);
  white-space: nowrap;
}
.save-badge--saving {
  padding: var(--space-2) var(--space-3);
  color: var(--text-300);
  font-weight: 600;
}
.save-badge-enter-active,
.save-badge-leave-active {
  transition: opacity var(--dur-slow) var(--ease-out);
}
.save-badge-enter-from,
.save-badge-leave-to {
  opacity: 0;
}
</style>
