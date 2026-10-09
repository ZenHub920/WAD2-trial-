<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { formatShortDate } from '../../api.js';
import { priceParts } from '../../market.js';
import MarketIcon from './MarketIcon.vue';
import TicketPoster from './TicketPoster.vue';
import VerifiedBadge from './VerifiedBadge.vue';

/**
 * The full listing card: poster, title, verification, price, description and the
 * Chat / Buy actions. It only renders and emits — the view that hosts it decides
 * what buying or chatting means, which is what lets the same card be reused
 * anywhere a listing needs to be shown in full.
 *
 * Override the buttons with the `actions` slot if a host needs different ones.
 */
const props = defineProps({
  listing: { type: Object, required: true },
  saved: { type: Boolean, default: false },
});

const emit = defineEmits(['buy', 'chat', 'toggle-save', 'add-to-cart', 'copy-link']);

const price = computed(() => priceParts(props.listing.priceCents, props.listing.currency));
const available = computed(() => props.listing.status === 'open');

const facts = computed(() => {
  const l = props.listing;
  const seat = [l.seatRow && `Row ${l.seatRow}`, l.seatNumbers && `Seat ${l.seatNumbers}`]
    .filter(Boolean)
    .join(' · ');
  return [
    l.category,
    l.showDate && formatShortDate(l.showDate),
    seat,
    `${l.quantity} ticket${l.quantity === 1 ? '' : 's'}`,
  ].filter(Boolean);
});

// ---- Description: clamp, and offer "Read more" only if it actually overflows.
const expanded = ref(false);
const overflowing = ref(false);
const descEl = ref(null);

async function measure() {
  expanded.value = false;
  await nextTick();
  const el = descEl.value;
  overflowing.value = Boolean(el && el.scrollHeight > el.clientHeight + 1);
}

onMounted(measure);
watch(() => props.listing.description, measure);

// ---- Overflow menu
const menuOpen = ref(false);
const menuEl = ref(null);

function closeMenuOnBlur(event) {
  if (!menuEl.value?.contains(event.relatedTarget)) menuOpen.value = false;
}

function copyLink() {
  menuOpen.value = false;
  emit('copy-link', props.listing);
}
</script>

<template>
  <article class="dcard" :aria-labelledby="`listing-${listing.id}-title`">
    <div ref="menuEl" class="dcard__menu" @focusout="closeMenuOnBlur" @keydown.esc="menuOpen = false">
      <button
        class="icon-btn"
        aria-label="More options"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <MarketIcon name="more" />
      </button>
      <div v-if="menuOpen" class="dcard__popover" role="menu">
        <button role="menuitem" @click="copyLink">Copy link</button>
      </div>
    </div>

    <TicketPoster :listing="listing" ratio="2 / 1" />

    <h2 :id="`listing-${listing.id}-title`" class="dcard__title">{{ listing.title }}</h2>

    <div class="dcard__row">
      <VerifiedBadge v-if="listing.verified" />
      <span v-else class="tag">Unverified</span>
      <span v-if="!available" class="tag tag--rose">Sold</span>

      <div class="dcard__quick">
        <button
          class="icon-btn"
          aria-label="Add to cart"
          :disabled="!available"
          @click="emit('add-to-cart', listing)"
        >
          <MarketIcon name="cart" />
        </button>
        <button
          class="icon-btn"
          :class="{ 'icon-btn--on': saved }"
          :aria-pressed="saved"
          :aria-label="saved ? 'Remove from saved' : 'Save listing'"
          @click="emit('toggle-save', listing.id)"
        >
          <MarketIcon :name="saved ? 'bookmark-filled' : 'bookmark'" />
        </button>
      </div>
    </div>

    <p class="dcard__price tabular" :aria-label="`Price ${price.symbol}${price.whole}${price.fraction}`">
      <span class="dcard__symbol">{{ price.symbol }}</span>{{ price.whole }}<span
        v-if="price.fraction" class="dcard__fraction">{{ price.fraction }}</span>
    </p>

    <ul class="dcard__facts" aria-label="Ticket details">
      <li v-for="fact in facts" :key="fact">{{ fact }}</li>
    </ul>

    <section v-if="listing.description" class="dcard__desc">
      <h3>Ticket Description</h3>
      <p
        :id="`listing-${listing.id}-desc`"
        ref="descEl"
        class="dcard__text"
        :class="{ 'dcard__text--clamped': !expanded }"
      >{{ listing.description }}</p>
      <button
        v-if="overflowing"
        class="dcard__more"
        :aria-expanded="expanded"
        :aria-controls="`listing-${listing.id}-desc`"
        @click="expanded = !expanded"
      >
        {{ expanded ? 'Show less' : 'Read More' }}
      </button>
    </section>

    <div class="dcard__actions">
      <slot name="actions" :listing="listing" :available="available">
        <button class="dcard__btn" @click="emit('chat', listing)">Chat</button>
        <button class="dcard__btn" :disabled="!available" @click="emit('buy', listing)">
          {{ available ? 'Buy' : 'Sold' }}
        </button>
      </slot>
    </div>
  </article>
</template>

<style scoped>
.dcard {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: var(--space-6) var(--space-5) var(--space-5);
  background: var(--ink-800);
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

/* ---- Overflow menu ---------------------------------------------------- */

.dcard__menu {
  position: absolute;
  top: var(--space-1);
  right: var(--space-2);
  z-index: 2;
}

.dcard__popover {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  min-width: 150px;
  padding: var(--space-1);
  background: var(--ink-850);
  border: var(--border-hairline);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
}

.dcard__popover button {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  text-align: left;
  font-size: var(--step--1);
  color: var(--text-200);
}

.dcard__popover button:hover,
.dcard__popover button:focus-visible {
  background: var(--ink-700);
  color: var(--text-100);
}

/* ---- Body ------------------------------------------------------------- */

.dcard__title {
  margin-top: var(--space-5);
  font-size: var(--step-3);
  line-height: 1.12;
}

.dcard__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.dcard__quick {
  display: flex;
  gap: var(--space-1);
  margin-left: auto;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  color: var(--text-100);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.icon-btn:hover:not(:disabled) {
  background: var(--ink-700);
}

.icon-btn--on {
  color: var(--accent-400);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dcard__price {
  margin-top: var(--space-4);
  font-family: var(--font-display);
  font-size: var(--step-6);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.04em;
  color: var(--text-100);
}

.dcard__symbol {
  font-size: 0.45em;
  vertical-align: 0.95em;
  margin-right: 0.04em;
}

.dcard__fraction {
  font-size: 0.45em;
}

.dcard__facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding: 0;
  list-style: none;
}

.dcard__facts li {
  padding: 2px var(--space-3);
  border-radius: var(--radius-pill);
  border: var(--border-hairline);
  font-size: var(--step--2);
  color: var(--text-300);
}

.dcard__desc {
  margin-top: var(--space-5);
}

.dcard__desc h3 {
  font-family: var(--font-body);
  font-size: var(--step-0);
  font-weight: 700;
  letter-spacing: 0;
}

.dcard__text {
  margin-top: var(--space-2);
  color: var(--text-200);
  white-space: pre-line;
}

.dcard__text--clamped {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dcard__more {
  margin-top: var(--space-1);
  padding: 0;
  color: var(--text-300);
  text-decoration: underline;
  text-underline-offset: 0.2em;
  font-size: var(--step--1);
}

.dcard__more:hover {
  color: var(--text-100);
}

/* ---- Actions ---------------------------------------------------------- */

.dcard__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  margin-top: var(--space-6);
}

.dcard__btn {
  min-height: 56px;
  border-radius: var(--radius-md);
  background: var(--accent-500);
  color: #fff;
  font-size: var(--step-1);
  font-weight: 500;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.dcard__btn:hover:not(:disabled) {
  background: var(--accent-400);
}

.dcard__btn:active:not(:disabled) {
  transform: translateY(1px);
}

.dcard__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
