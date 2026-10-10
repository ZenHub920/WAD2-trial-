<script setup>
/**
 * One profile, as it appears in the swipe deck.
 *
 * Layout follows the prototype: portrait block, name, "age, gender", the
 * concert, then interest chips. Two honest substitutions, because the data
 * behind them does not exist yet:
 *
 *   - the portrait is generated initials, not a stock photo
 *   - "You both like" becomes "They're into" when there is no overlap to
 *     claim, which includes every signed-out viewer
 */
import { computed } from 'vue';
import { avatarFor, displayAge, sharedInterests } from '../../kaki.js';
import { LABELS, formatShortDate } from '../../api.js';

const props = defineProps({
  person: { type: Object, required: true },
  /** The signed-in user, for working out shared interests. May be null. */
  viewer: { type: Object, default: null },
});

const avatar = computed(() => avatarFor(props.person.user));

const interests = computed(() => {
  const { shared, theirs } = sharedInterests(props.viewer, props.person.user);
  return shared.length > 0
    ? { label: 'You both like:', items: shared }
    : { label: 'They’re into:', items: theirs };
});
</script>

<template>
  <article class="kaki-card">
    <div
      class="kaki-card__portrait"
      :style="{ background: avatar.bg, color: avatar.fg }"
      aria-hidden="true"
    >
      <span class="kaki-card__initials">{{ avatar.initials }}</span>
    </div>

    <div class="kaki-card__body">
      <h3 class="kaki-card__name">{{ person.user.displayName }}</h3>

      <p class="kaki-card__meta">
        {{ displayAge(person.user.ageBand) }} · {{ person.user.homeRegion.replace('_', ' ') }}
        <span v-if="person.user.verified" class="kaki-card__verified" title="Verified account">
          ✓ verified
        </span>
      </p>

      <p class="kaki-card__concert">
        {{ person.artist }}
        <span class="kaki-card__date">{{ formatShortDate(person.eventDate) }}</span>
      </p>

      <p class="kaki-card__section">
        {{ LABELS.section[person.sectionPref] }} · {{ LABELS.arrival[person.arrivalPref] }}
      </p>

      <template v-if="interests.items.length">
        <p class="kaki-card__interest-label">{{ interests.label }}</p>
        <ul class="kaki-card__chips">
          <li v-for="item in interests.items" :key="item" class="kaki-card__chip">{{ item }}</li>
        </ul>
      </template>
    </div>
  </article>
</template>

<style scoped>
.kaki-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;

  background: var(--ink-800);
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.kaki-card__portrait {
  display: grid;
  place-items: center;
  /* Fixed ratio so every card in the stack is the same height regardless of
     how many interest chips the person has. */
  aspect-ratio: 4 / 3;
  flex-shrink: 0;
}

.kaki-card__initials {
  font-family: var(--font-display);
  font-size: var(--step-5);
  font-weight: 800;
  letter-spacing: 0.02em;
}

.kaki-card__body {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 0;
}

.kaki-card__name {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 800;
  color: var(--text-100);
  line-height: 1.15;
}

.kaki-card__meta {
  margin: 0;
  font-size: var(--step--1);
  font-weight: 600;
  color: var(--text-200);
  text-transform: capitalize;
}

.kaki-card__verified {
  margin-left: var(--space-2);
  color: var(--mint-400);
  font-weight: 700;
  text-transform: none;
}

.kaki-card__concert {
  margin: var(--space-2) 0 0;
  font-size: var(--step-0);
  font-weight: 700;
  color: var(--accent-500);
}

.kaki-card__date {
  margin-left: var(--space-2);
  font-size: var(--step--1);
  font-weight: 600;
  color: var(--text-300);
}

.kaki-card__section {
  margin: 0;
  font-size: var(--step--1);
  color: var(--text-300);
}

.kaki-card__interest-label {
  margin: var(--space-3) 0 var(--space-2);
  font-size: var(--step--1);
  font-weight: 700;
  color: var(--text-100);
}

.kaki-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.kaki-card__chip {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--accent-400);
  border-radius: var(--radius-pill);
  font-size: var(--step--2);
  font-weight: 600;
  color: var(--accent-500);
  background: var(--ink-850);
}
</style>
