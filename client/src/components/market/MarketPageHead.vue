<script setup>
import { useRouter } from 'vue-router';
import BackArrow from '../BackArrow.vue';

/**
 * Back arrow + centred title, as on each step of the buying flow. Back goes to
 * the previous page when there is one in this tab, otherwise to `fallback`.
 */
const props = defineProps({
  title: { type: String, required: true },
  fallback: { type: [String, Object], default: () => ({ name: 'tickets' }) },
});

const router = useRouter();

function back() {
  if (window.history.state?.back) router.back();
  else router.push(props.fallback);
}
</script>

<template>
  <header class="mhead">
    <BackArrow @click="back" />
    <h1 class="mhead__title">{{ title }}</h1>
  </header>
</template>

<style scoped>
.mhead {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: center;
  margin-bottom: var(--space-5);
}

.mhead__title {
  text-align: center;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--step-2);
}
</style>
