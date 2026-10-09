<script setup>
import { computed } from 'vue';
import { hueFor } from '../../market.js';

/** Initials on a colour derived from the user id — there are no profile photos yet. */
const props = defineProps({
  user: { type: Object, required: true },
  size: { type: Number, default: 34 },
});

const initials = computed(() =>
  (props.user.displayName ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join(''),
);
</script>

<template>
  <span
    class="avatar"
    :style="{ '--hue': hueFor(user.id), '--size': `${size}px` }"
    aria-hidden="true"
  >{{ initials }}</span>
</template>

<style scoped>
.avatar {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--size);
  height: var(--size);
  border-radius: 50%;
  background: hsl(var(--hue) 55% 42%);
  color: #fff;
  font-size: calc(var(--size) * 0.38);
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
