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
    <template v-else-if="name === 'cart'">
      <path d="M2.5 3.5h2.6l2.3 11.2h11l2.1-7.9H6.2" />
      <circle cx="9.2" cy="19.2" r="1.3" />
      <circle cx="17" cy="19.2" r="1.3" />
    </template>
    <template v-else-if="name === 'check-circle'">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.2 12.2 2.6 2.6 5-5.2" />
    </template>
    <template v-else-if="name === 'back'">
      <path d="M20 12H4.5M11 5l-7 7 7 7" />
    </template>
    <template v-else-if="name === 'more'">
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </template>
    <template v-else-if="name === 'chat'">
      <path d="M4 5.5h16v10.5H9.5L5 19.5V16H4z" />
    </template>
    <template v-else-if="name === 'lock'">
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </template>
  </svg>
</template>
