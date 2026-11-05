<script setup>
import { vibeChip } from '../../vibe.js';
/**
 * One profile, as it appears in the swipe deck.
 *
 * Shows real profile data and optional photos. Shared interests are only
 * labelled as shared when both profiles have the relevant vibe scores.
 */
import { computed, ref, watch } from 'vue';
import { avatarFor, sharedInterests } from '../../kaki.js';
import { LABELS, formatShortDate } from '../../api.js';
import UserAvatar from '../UserAvatar.vue';

const props = defineProps({
  person: { type: Object, required: true },
  /** The signed-in user, for working out shared interests. May be null. */
  viewer: { type: Object, default: null },
});

const avatar = computed(() => avatarFor(props.person.user));
const photoFailed = ref(false);
watch(() => props.person.user.avatarUrl, () => { photoFailed.value = false; });

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
      :class="{ 'kaki-card__portrait--photo': person.user.avatarUrl && !photoFailed }"
      :style="{ background: avatar.bg, color: avatar.fg }"
      role="presentation"
    >
      <!-- The face fills the whole picture area; a coloured initial only when there is no photo. -->
      <img v-if="person.user.avatarUrl && !photoFailed" class="kaki-card__photo" :src="person.user.avatarUrl" alt="" @error="photoFailed = true" />
      <UserAvatar v-else :src="null" :name="person.user.displayName" :size="112" />
    </div>

    <div class="kaki-card__body">
      <h3 class="kaki-card__name">{{ person.user.displayName }}</h3>
      <RouterLink class="kaki-card__profile" :to="`/people/${encodeURIComponent(person.user.id)}`" @pointerdown.stop @click.stop @keydown.stop>View concert vibe →</RouterLink>

      <p class="kaki-card__meta">
        {{ person.user.ageBand }}, {{ person.user.homeRegion.replace('_', ' ') }}
      </p>

      <p class="kaki-card__concert">
        {{ person.artist }}
        <span class="kaki-card__date">{{ formatShortDate(person.eventDate) }}</span>
      </p>

      <p class="kaki-card__section">
        {{ LABELS.section[person.sectionPref] }}, {{ LABELS.arrival[person.arrivalPref] }}
      </p>

      <template v-if="interests.items.length">
        <p class="kaki-card__interest-label">{{ interests.label }}</p>
        <ul class="kaki-card__chips">
          <li v-for="item in interests.items" :key="item" class="kaki-card__chip" v-bind="vibeChip(item)">{{ item }}</li>
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
  border-radius: var(--radius-md);
}

.kaki-card__portrait {
  display: grid;
  place-items: center;
  /* A consistent portrait area keeps the profile details easy to scan. */
  aspect-ratio: 16 / 7;
  min-height: 150px;
  flex-shrink: 0;
}
/* With a photo the picture area is a little taller and the face fills it. */
.kaki-card__portrait--photo {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
}
.kaki-card__photo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 30%;
  -webkit-user-drag: none;
  user-select: none;
}


.kaki-card__body {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 0;
  overflow-wrap: anywhere;
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
.kaki-card__profile { align-self:flex-start; display:inline-flex; align-items:center; min-height:44px; font-size:var(--step--1); color:var(--accent-400); }

.kaki-card__concert {
  margin: var(--space-2) 0 0;
  font-size: var(--step-0);
  font-weight: 700;
  color: var(--accent-400);
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
  color: var(--accent-400);
  background: var(--ink-850);
}
</style>
