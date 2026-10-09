<script setup>
import { useRouter } from 'vue-router';
import MarketIcon from './MarketIcon.vue';

/**
 * Back arrow + centred title, as on each step of the buying flow. Back goes to
 * the previous page when there is one in this tab, otherwise to `fallback`.
 */
const props = defineProps({
  title: { type: String, required: true },
  fallback: { type: [String, Object], default: () => ({ name: 'market' }) },
});

const router = useRouter();

function back() {
  if (window.history.state?.back) router.back();
  else router.push(props.fallback);
}
</script>

<template>
  <header class="mhead">
    <button class="mhead__back" aria-label="Go back" @click="back">
      <MarketIcon name="back" :size="26" />
    </button>
    <h1 class="mhead__title">{{ title }}</h1>
  </header>
</template>

<style scoped>
.mhead {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  margin-bottom: var(--space-5);
}

.mhead__back {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  color: var(--text-100);
  transition: background var(--dur-fast) var(--ease-out);
}

.mhead__back:hover {
  background: var(--ink-750);
}

.mhead__title {
  text-align: center;
  font-size: var(--step-2);
}
</style>
