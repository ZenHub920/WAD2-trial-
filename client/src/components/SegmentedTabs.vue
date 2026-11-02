<script setup>
import { computed } from 'vue';

/**
 * Icon tabs with a bubble that slides to whichever is selected.
 *
 * The bubble is one element sized to a single segment and moved by transform,
 * rather than a highlight re-drawn on each tab. That is what makes the travel
 * continuous: the browser interpolates one transform instead of cross-fading
 * two backgrounds, so the bubble reads as a single object moving between
 * positions, and interrupting it mid-slide redirects rather than restarts.
 */
const props = defineProps({
  modelValue: { type: String, required: true },
  /** `[{ id, label, icon, count }]` — count is an optional unread badge. */
  tabs: { type: Array, required: true },
  ariaLabel: { type: String, default: 'View' },
});
const emit = defineEmits(['update:modelValue']);

const index = computed(() => Math.max(0, props.tabs.findIndex((t) => t.id === props.modelValue)));
const bubble = computed(() => ({
  width: `calc((100% - 8px) / ${Math.max(1, props.tabs.length)})`,
  transform: `translateX(${index.value * 100}%)`,
}));

function navigate(event, current) {
  if (!props.tabs.length) return;
  let next;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = props.tabs.length - 1;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    const direction = getComputedStyle(event.currentTarget.parentElement).direction === 'rtl' ? -1 : 1;
    next = (current + (event.key === 'ArrowRight' ? direction : -direction) + props.tabs.length) % props.tabs.length;
  } else return;
  event.preventDefault();
  if (next !== current) emit('update:modelValue', props.tabs[next].id);
  event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
}
</script>

<template>
  <div class="segs" role="tablist" :aria-label="ariaLabel">
    <span v-if="tabs.length" class="segs__bubble" :style="bubble" aria-hidden="true" />
    <button
      v-for="(tab, tabIndex) in tabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="segs__tab"
      :class="{ 'segs__tab--on': tab.id === modelValue }"
      :aria-selected="tab.id === modelValue"
      :tabindex="tabIndex === index ? 0 : -1"
      @click="$emit('update:modelValue', tab.id)"
      @keydown="navigate($event, tabIndex)"
    >
      <svg viewBox="0 0 24 24" class="segs__icon" aria-hidden="true">
        <template v-if="tab.icon === 'companion'">
          <circle cx="12" cy="8" r="3.6" />
          <path d="M4.8 20c.6-3.6 3.6-5.6 7.2-5.6s6.6 2 7.2 5.6" />
        </template>
        <template v-else-if="tab.icon === 'ticket'">
          <path d="M3 8.6V6.4h18v2.2a2.3 2.3 0 0 0 0 4.6v4.4H3v-4.4a2.3 2.3 0 0 0 0-4.6Z" />
          <path d="M13.5 6.4v11.2" stroke-dasharray="2 2.6" />
        </template>
        <template v-else-if="tab.icon === 'group'">
          <circle cx="9" cy="9" r="3.1" />
          <path d="M2.8 19.5c.5-3.1 3-4.9 6.2-4.9s5.7 1.8 6.2 4.9" />
          <path d="M16.2 6.4a3.1 3.1 0 0 1 0 6" />
          <path d="M17.4 14.9c2.2.5 3.6 2.2 3.9 4.6" />
        </template>
      </svg>
      <span class="segs__label">{{ tab.label }}</span>
      <span v-if="tab.count" class="segs__count tabular">{{ tab.count > 9 ? '9+' : tab.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.segs {
  position: relative;
  display: flex;
  padding: 4px;
  border: var(--border-hairline);
  border-radius: var(--radius-pill);
  background: var(--ink-850);
  box-shadow: inset 0 1px 3px rgba(47, 25, 95, 0.06);
}

.segs__bubble {
  position: absolute;
  inset: 4px auto 4px 4px;
  border-radius: var(--radius-pill);
  background: var(--accent-500);
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur-base) var(--ease-settle);
  /* The bubble's box is one segment wide; `left` stays at the first segment
     and only the transform moves, so there is a single animated property. */
  will-change: transform;
}

.segs__tab {
  position: relative;
  z-index: 1;
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-pill);
  background: none;
  color: var(--text-300);
  font-size: var(--step--1);
  font-weight: 600;
  transition: color var(--dur-base) var(--ease-out), transform var(--dur-fast) var(--ease-settle);
}
.segs__tab:active {
  transform: translateY(1px);
}

.segs__tab--on {
  color: #fff;
}
.segs__tab:not(.segs__tab--on):hover {
  color: var(--text-100);
}

.segs__icon {
  width: 19px;
  height: 19px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.segs__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.segs__count {
  display: grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding-inline: 5px;
  border-radius: var(--radius-pill);
  background: var(--accent-600);
  color: #fff;
  font-size: var(--step--2);
}

.segs__tab--on .segs__count {
  background: rgba(255, 255, 255, 0.26);
}

/* Keep the words on mobile: an unfamiliar icon should not be a guessing game. */
@media (max-width: 560px) {
  .segs__label {
    font-size: .75rem;
    max-width: 100%;
  }
  .segs__tab {
    flex-direction: column;
    gap: 3px;
    min-height: 54px;
    padding: 6px 4px;
  }
  .segs__icon { width: 17px; height: 17px; }
  .segs__count { position: absolute; top: 3px; right: 3px; min-width: 16px; height: 16px; padding-inline: 3px; font-size: .6rem; }
}

@media (prefers-reduced-motion: reduce) {
  .segs__bubble {
    transition: none;
  }
  .segs__tab:active { transform: none; }
}
</style>
