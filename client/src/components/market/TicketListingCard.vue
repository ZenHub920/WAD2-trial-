<script setup>
import { formatShortDate } from '../../api.js';
import { formatMoney, sectionLabel } from '../../market.js';
import MarketIcon from './MarketIcon.vue';
import TicketPoster from './TicketPoster.vue';
import UserAvatar from './UserAvatar.vue';
import VerifiedBadge from './VerifiedBadge.vue';
import TicketFacts from './TicketFacts.vue';

/**
 * One listing in the ticket marketplace grid. The title link covers the whole
 * card, so clicking anywhere opens the listing; the save button sits above it.
 */
defineProps({
  listing: { type: Object, required: true },
  saved: { type: Boolean, default: false },
});
const emit = defineEmits(['toggle-save']);
</script>

<template>
  <article class="tcard" :aria-labelledby="`tcard-${listing.id}`">
    <TicketPoster :listing="listing" ratio="16 / 9" />
    <button
      type="button"
      class="tcard__save"
      :class="{ 'tcard__save--on': saved }"
      :aria-pressed="saved"
      :aria-label="saved ? 'Remove from saved' : 'Save listing'"
      @click="emit('toggle-save', listing.id)"
    >
      <MarketIcon :name="saved ? 'bookmark-filled' : 'bookmark'" :size="18" />
    </button>

    <div class="tcard__body">
      <h3 :id="`tcard-${listing.id}`" class="tcard__title">
        <RouterLink :to="{ name: 'ticket-detail', params: { id: listing.id } }" class="tcard__link">
          {{ listing.concert.artist }}
        </RouterLink>
      </h3>
      <p class="tcard__when">{{ formatShortDate(listing.concert.event_date) }} · {{ listing.concert.venue }}</p>

      <TicketFacts :facts="[['Section', sectionLabel(listing.section)], ['No. of tickets', listing.quantity]]" />

      <VerifiedBadge v-if="listing.verified" class="tcard__badge" />
      <span v-else class="tag tcard__badge">Unverified ticket</span>

      <footer class="tcard__foot">
        <span class="tcard__seller">
          <UserAvatar :user="listing.seller" :size="26" />
          {{ listing.seller.displayName }}
        </span>
        <span class="tcard__price">
          <strong class="tabular">{{ formatMoney(listing.priceCents) }}</strong>
          <small>total</small>
        </span>
      </footer>
    </div>
  </article>
</template>

<style scoped>
.tcard {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-lg);
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
  transition: border-color var(--dur-fast) var(--ease-settle), box-shadow var(--dur-fast) var(--ease-settle), transform var(--dur-fast) var(--ease-settle);
}
.tcard:hover,
.tcard:focus-within {
  border-color: color-mix(in oklab, var(--accent-500) 55%, var(--ink-600));
  box-shadow: inset 0 1px 0 var(--panel-highlight), var(--shadow-md);
}
.tcard:hover {
  transform: translateY(-2px);
}
.tcard :deep(.poster) {
  border-radius: 0;
}
.tcard__save {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  z-index: 2;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgb(0 0 0 / 55%);
  color: #fff;
  box-shadow: inset 0 1px 0 #ffffff20, var(--shadow-sm);
  transition: background-color var(--dur-fast), box-shadow var(--dur-fast), transform var(--dur-press) var(--ease-settle);
}
.tcard__save:hover { background: rgba(0, 0, 0, .8); }
.tcard__save:active { transform: translateY(1px) scale(.96); box-shadow: inset 0 2px 4px #00000040; }
.tcard__save--on {
  background: var(--action-start);
}
.tcard__save--on:hover { background: var(--action-hover); }
.tcard__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5) var(--space-5);
}
.tcard__title {
  font-size: var(--step-1);
  line-height: 1.2;
}
.tcard__link {
  color: inherit;
  text-decoration: none;
}
/* Stretch the title link over the whole card. */
.tcard__link::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
}
.tcard__link:focus-visible {
  outline: none;
}
.tcard:has(.tcard__link:focus-visible) {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.tcard__when {
  color: var(--text-300);
  font-size: var(--step--1);
}
.tcard__badge {
  align-self: start;
}
.tcard__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: auto;
  padding-top: var(--space-3);
  border-top: var(--border-hairline);
}
.tcard__seller {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  color: var(--text-300);
  font-size: var(--step--1);
}
.tcard__price {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1);
}
.tcard__price strong {
  color: var(--highlight-ink);
  font-size: var(--step-1);
}
.tcard__price small {
  color: var(--text-400);
  font-size: var(--step--2);
}
@media (prefers-reduced-motion: reduce) {
  .tcard {
    transition: none;
  }
  .tcard:hover {
    transform: none;
  }
  .tcard__save:active { transform: none; }
}
</style>
