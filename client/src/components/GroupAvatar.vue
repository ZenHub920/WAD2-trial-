<script setup>
/**
 * A group's picture, or its initials on the accent colour when it has none.
 *
 * Rounded square rather than a circle, so a group never reads as a person.
 */
import { computed, ref, watch } from 'vue';

const props = defineProps({
  src: { type: String, default: null },
  name: { type: String, default: '' },
  size: { type: Number, default: 48 },
});

const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });

const initials = computed(() => props.name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  .map(word => [...word][0]).join('').toUpperCase() || '♪');
const dimension = computed(() => `${props.size}px`);
</script>

<template>
  <span class="group-avatar" :style="{ width: dimension, height: dimension, fontSize: `${Math.round(size * 0.36)}px` }">
    <img v-if="src && !failed" :src="src" :alt="name ? `${name} group picture` : 'Group picture'" @error="failed = true" />
    <span v-else aria-hidden="true">{{ initials }}</span>
  </span>
</template>

<style scoped>
.group-avatar { display: inline-grid; place-items: center; flex: none; overflow: hidden; border-radius: 22%; background: linear-gradient(135deg, var(--accent-500), var(--accent-400)); color: #fff; font-weight: 700; line-height: 1; letter-spacing: .02em; }
.group-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
