<script setup>
/** Where the buyer is in checkout: review → pay → done. */
defineProps({
  current: { type: Number, required: true }, // 1-indexed
});

const STEPS = ['Review order', 'Payment', 'Confirmation'];
</script>

<template>
  <ol class="steps" aria-label="Checkout progress">
    <li
      v-for="(label, index) in STEPS"
      :key="label"
      class="steps__step"
      :class="{
        'steps__step--done': index + 1 < current,
        'steps__step--current': index + 1 === current,
      }"
      :aria-current="index + 1 === current ? 'step' : undefined"
    >
      <span class="steps__dot tabular" aria-hidden="true">{{ index + 1 < current ? '✓' : index + 1 }}</span>
      <span class="steps__label">{{ label }}</span>
    </li>
  </ol>
</template>

<style scoped>
.steps {
  display: flex;
  gap: var(--space-2);
  padding: 0;
  list-style: none;
}

.steps__step {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-400);
  font-size: var(--step--2);
  font-weight: 500;
}

.steps__step:not(:last-child)::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--ink-600);
}

.steps__dot {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: var(--border-hairline);
  font-size: 0.7rem;
}

.steps__step--current {
  color: var(--text-100);
}

.steps__step--current .steps__dot {
  background: var(--accent-500);
  border-color: var(--accent-500);
  color: #fff;
}

.steps__step--done {
  color: var(--text-300);
}

.steps__step--done .steps__dot {
  border-color: var(--accent-500);
  color: var(--accent-400);
}

@media (max-width: 480px) {
  .steps__step:not(.steps__step--current) .steps__label {
    display: none;
  }
}
</style>
