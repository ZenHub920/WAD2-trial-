<script setup>
import { formatMoney, formatRelative } from '../../market.js';
import MarketIcon from './MarketIcon.vue';
import TicketPoster from './TicketPoster.vue';
import UserAvatar from './UserAvatar.vue';

/**
 * Compact listing card for the Discover grid. The whole card is one link (the
 * title's hit area is stretched over it); the bookmark sits above that layer so
 * it can be pressed without opening the listing.
 */
defineProps({
  listing: { type: Object, required: true },
  saved: { type: Boolean, default: false },
});

defineEmits(['toggle-save']);
</script>

<template>
  <article class="lcard">
    <header class="lcard__seller">
      <UserAvatar :user="listing.seller" :size="30" />
      <span class="lcard__name">{{ listing.seller.displayName }}</span>
      <time class="lcard__time" :datetime="listing.createdAt">
        {{ formatRelative(listing.createdAt) }}
      </time>
    </header>

    <TicketPoster :listing="listing" ratio="3 / 2" compact />

    <h3 class="lcard__title">
      <RouterLink :to="{ name: 'listing', params: { id: listing.id } }" class="lcard__link">
        {{ listing.title }}
      </RouterLink>
    </h3>

    <footer class="lcard__foot">
      <span class="lcard__price tabular">{{ formatMoney(listing.priceCents, listing.currency) }}</span>
      <button
        class="lcard__save"
        :aria-pressed="saved"
        :aria-label="saved ? 'Remove from saved' : 'Save listing'"
        @click="$emit('toggle-save', listing.id)"
      >
        <MarketIcon :name="saved ? 'bookmark-filled' : 'bookmark'" :size="20" />
      </button>
    </footer>
  </article>
</template>

<style scoped>
.lcard {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--ink-800);
  border: var(--border-hairline);
  border-radius: var(--radius-md);
  transition:
    border-color var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.lcard:hover {
  border-color: var(--ink-500);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.lcard:focus-within {
  border-color: var(--accent-500);
}

.lcard__seller {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.lcard__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-100);
  font-size: var(--step--1);
  font-weight: 500;
}

.lcard__time {
  flex: none;
  color: var(--text-400);
  font-size: var(--step--2);
}

.lcard__title {
  flex: 1;
  font-family: var(--font-body);
  font-size: var(--step--1);
  font-weight: 500;
  line-height: 1.35;
  letter-spacing: 0;
  /* Two lines keeps every card in a row the same height. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.lcard__link {
  color: var(--text-100);
  text-decoration: none;
}

.lcard__link:focus-visible {
  outline: none;
}

.lcard__link::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.lcard__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.lcard__price {
  color: var(--text-100);
  font-weight: 700;
  font-size: var(--step-0);
}

.lcard__save {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  margin: -6px;
  border-radius: var(--radius-sm);
  color: var(--text-200);
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.lcard__save:hover,
.lcard__save[aria-pressed='true'] {
  color: var(--accent-400);
}

.lcard__save:hover {
  background: var(--ink-700);
}
</style>
