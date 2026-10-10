<script setup>
/**
 * The market's line icons, drawn on one 24px grid with a shared stroke so they
 * read as a set. Decorative by default — the control that holds one gives the label.
 */
defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 22 },
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.9"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="name === 'bookmark'">
      <path d="M6 3.5h12v17l-6-4.2-6 4.2z" />
    </template>
    <template v-else-if="name === 'bookmark-filled'">
      <path d="M6 3.5h12v17l-6-4.2-6 4.2z" fill="currentColor" />
    </template>
  </svg>
</template>
