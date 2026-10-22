<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useReducedMotion } from '../composables/useReducedMotion.js';
import { createComparison, preferComparisonGroup, refreshComparisonGroups, skipComparisonGroup } from '../utils/groupComparison.js';
import GroupListingCard from './GroupListingCard.vue';

const props = defineProps({
  groups: { type: Array, required: true },
  sessionKey: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  canApply: { type: Boolean, default: false },
  instructionsSeen: { type: Boolean, default: false },
  // Resolve true only after the application has been saved. False keeps the card.
  applyGroup: { type: Function, required: true },
});
const emit = defineEmits(['pending-change']);
const reducedMotion = useReducedMotion();
const state = ref(createComparison([]));
const transitioning = ref(false), pending = ref(false), leaving = ref(null), drag = ref(null);
const announcement = ref(''), submitted = ref(null);
const instructionsVisible = ref(true);
const deckElement = ref(null);
const locked = computed(() => props.disabled || transitioning.value || pending.value);
const visibleCount = computed(() => state.value.slots.filter(Boolean).length);
const unseenCount = computed(() => state.value.groups.length - state.value.nextIndex);
let epoch = 0, alive = true, animationTimer = null, resolveAnimation = null, pointer = null, suppressClickUntil = 0, snapshotInitialized = false;
const interactive = 'button, a, input, select, textarea, label, summary, [data-no-drag]';
const groupName = group => group.name || `${group.hostName || 'Your concert companion'}'s group`;
const acceptsRequests = group => group.status !== 'cancelled' && (group.canJoinQueue ?? group.remainingCapacity > 0);
const requestLabel = group => group.remainingCapacity < 1 ? 'Join waiting queue' : 'Request to join';
const canRequest = group => !locked.value && props.canApply && !submitted.value && acceptsRequests(group);

watch(() => pending.value || transitioning.value, value => emit('pending-change', value));

function cancelAnimation() {
  clearTimeout(animationTimer);
  animationTimer = null;
  const resolve = resolveAnimation;
  resolveAnimation = null;
  resolve?.(false);
}
function clearPointer() {
  if (pointer?.target?.hasPointerCapture?.(pointer.id)) pointer.target.releasePointerCapture(pointer.id);
  pointer = null;
  drag.value = null;
}
function reset() {
  epoch++;
  cancelAnimation();
  clearPointer();
  state.value = createComparison(props.groups);
  snapshotInitialized = state.value.groups.length > 0;
  transitioning.value = false;
  pending.value = false;
  leaving.value = null;
  submitted.value = null;
  announcement.value = '';
  suppressClickUntil = 0;
}
watch(() => props.sessionKey, async () => {
  reset();
  instructionsVisible.value = !props.instructionsSeen;
  const token = epoch;
  await nextTick();
  if (alive && token === epoch) { state.value = createComparison(props.groups); snapshotInitialized = state.value.groups.length > 0; }
}, { immediate: true });
watch(() => props.groups, groups => {
  state.value = snapshotInitialized ? refreshComparisonGroups(state.value, groups) : createComparison(groups);
  if (state.value.groups.length) snapshotInitialized = true;
});
function restart() {
  reset();
  announcement.value = 'All groups on this page are ready to compare again. No applications were changed.';
}
onUnmounted(() => { alive = false; epoch++; cancelAnimation(); clearPointer(); emit('pending-change', false); });
function stageEntered(element) {
  element.querySelector('.comparison-deck__candidate, .comparison-deck__instructions-title')?.focus({ preventScroll: true });
}
async function restoreCardFocus(slot, token) {
  await nextTick();
  if (!alive || token !== epoch || !deckElement.value || deckElement.value.contains(document.activeElement)) return;
  const next = deckElement.value.querySelector(`[data-comparison-slot="${slot}"]`) ?? deckElement.value.querySelector('.comparison-deck__candidate');
  next?.focus({ preventScroll: true });
}

function animate(slot, direction) {
  leaving.value = { slot, direction };
  if (reducedMotion.value) return Promise.resolve(true);
  return new Promise(resolve => {
    resolveAnimation = resolve;
    animationTimer = setTimeout(() => {
      animationTimer = null;
      resolveAnimation = null;
      resolve(true);
    }, 230);
  });
}
async function skip(slot) {
  if (locked.value || !state.value.slots[slot]) return;
  const token = epoch, group = state.value.slots[slot];
  transitioning.value = true;
  clearPointer();
  if (!await animate(slot, 'left') || !alive || token !== epoch) return;
  if (state.value.slots[slot]?.id === group.id) state.value = skipComparisonGroup(state.value, slot);
  announcement.value = `Skipped ${groupName(group)} for this comparison. ${unseenCount.value} unseen groups remain.`;
  leaving.value = null;
  transitioning.value = false;
  void restoreCardFocus(slot, token);
}
async function prefer(slot) {
  if (locked.value || !state.value.slots[slot]) return;
  const token = epoch, group = state.value.slots[slot], otherSlot = 1 - slot;
  const otherId = state.value.slots[otherSlot]?.id;
  const next = preferComparisonGroup(state.value, slot);
  if (!state.value.slots[otherSlot]) {
    state.value = next;
    announcement.value = `${groupName(group)} is your local favorite. No application has been sent.`;
    return;
  }
  transitioning.value = true;
  state.value = { ...state.value, favoriteId: group.id };
  clearPointer();
  if (!await animate(otherSlot, 'left') || !alive || token !== epoch) return;
  if (state.value.slots[slot]?.id === group.id && state.value.slots[otherSlot]?.id === otherId) state.value = preferComparisonGroup(state.value, slot);
  announcement.value = `Kept ${groupName(group)}. ${state.value.slots[otherSlot] ? 'The other group was replaced.' : 'You have compared all groups on this page.'} No application has been sent.`;
  leaving.value = null;
  transitioning.value = false;
}
async function request(slot) {
  const group = state.value.slots[slot];
  if (!group || !canRequest(group)) return;
  const token = epoch;
  pending.value = true;
  clearPointer();
  announcement.value = `Sending your request to ${groupName(group)}.`;
  try {
    const saved = await props.applyGroup(group);
    if (!alive || token !== epoch) return;
    if (saved !== true) {
      announcement.value = `Your request to ${groupName(group)} was not sent. Review the message above and try again.`;
      return;
    }
    submitted.value = group;
    if (!await animate(slot, 'right') || !alive || token !== epoch) return;
    announcement.value = `Request sent to ${groupName(group)}. Check Your applications for its queue position and deadline.`;
  } catch {
    if (alive && token === epoch) announcement.value = 'Could not send your application. Your group card has been kept. Please try again.';
  } finally {
    if (alive && token === epoch) { pending.value = false; leaving.value = null; }
  }
}

function onCardClick(event, slot) {
  if (Date.now() < suppressClickUntil || event.target.closest(interactive)) return;
  void prefer(slot);
}
function onKeydown(event, slot) {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); void skip(slot); }
  if (event.key === 'ArrowRight') { event.preventDefault(); void request(slot); }
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void prefer(slot); }
}
function onPointerDown(event, slot) {
  if (locked.value || pointer || event.button !== 0 || event.target.closest(interactive)) return;
  pointer = { id: event.pointerId, slot, x: event.clientX, y: event.clientY, target: event.currentTarget, horizontal: false };
}
function onPointerMove(event) {
  if (!pointer || event.pointerId !== pointer.id) return;
  const x = event.clientX - pointer.x, y = event.clientY - pointer.y;
  if (!pointer.horizontal) {
    if (Math.abs(y) > 12 && Math.abs(y) > Math.abs(x)) { clearPointer(); return; }
    if (Math.abs(x) < 12 || Math.abs(x) < Math.abs(y) * 1.25) return;
    pointer.horizontal = true;
    pointer.target.setPointerCapture?.(pointer.id);
  }
  if (event.cancelable) event.preventDefault();
  drag.value = { slot: pointer.slot, x };
}
function onPointerUp(event) {
  if (!pointer || event.pointerId !== pointer.id) return;
  const { slot, horizontal, target } = pointer;
  const x = event.clientX - pointer.x;
  const threshold = Math.min(100, Math.max(48, target.getBoundingClientRect().width * 0.25));
  clearPointer();
  if (!horizontal) return;
  suppressClickUntil = Date.now() + 400;
  if (Math.abs(x) < threshold) return;
  if (x > 0) void request(slot); else void skip(slot);
}
function cardStyle(slot) {
  const exit = leaving.value?.slot === slot ? leaving.value.direction : null;
  if (exit) return { transform: `translateX(${exit === 'right' ? '110%' : '-110%'}) rotate(${exit === 'right' ? 5 : -5}deg)`, opacity: 0 };
  if (drag.value?.slot === slot) return { transform: `translateX(${drag.value.x}px) rotate(${drag.value.x / 35}deg)`, transition: 'none' };
  return {};
}
</script>

<template>
  <section ref="deckElement" class="comparison-deck" aria-label="Compare groups" :aria-busy="pending || transitioning">
    <Transition name="comparison-stage" mode="out-in" @after-enter="stageEntered">
    <div v-if="instructionsVisible" key="instructions" class="comparison-deck__instructions">
      <div class="comparison-deck__intro"><div><h3 class="comparison-deck__instructions-title" tabindex="-1">Find your concert crew, two groups at a time.</h3><p>Compare the groups before you decide where to apply.</p></div><span class="comparison-deck__progress">{{ state.groups.length }} compatible {{ state.groups.length === 1 ? 'group' : 'groups' }} on this page</span></div>
      <ol class="comparison-deck__steps">
        <li><span class="comparison-deck__step-number" aria-hidden="true">1</span><div><h4>Compare</h4><p>Tap the group you prefer, or choose <strong>Prefer this group</strong>. It stays in place while the other card slides away and the next group appears. You can also skip either card by swiping left. Comparing sends no application.</p></div></li>
        <li><span class="comparison-deck__step-number" aria-hidden="true">2</span><div><h4>Request to join</h4><p>Found a group you want? Swipe its card right or choose <strong>Request to join</strong>. This sends your application to the host for approval. Requests share an arrival-order queue; your application shows whether a place is held or you are waiting.</p></div></li>
      </ol>
      <div class="comparison-deck__start"><button type="button" class="btn btn--primary" :disabled="locked || !state.groups.length" @click="instructionsVisible = false">Start comparing</button><p>You can have one pending application per concert. Neither comparing nor applying makes you a confirmed member.</p></div>
    </div>
    <div v-else key="cards" class="comparison-deck__content">
    <div class="comparison-deck__intro">
      <div><h3>Which group feels more like you?</h3><p>Keep one to compare with the next group. When you find your people, request to join either card.</p></div>
      <div class="comparison-deck__tools"><p class="comparison-deck__progress">{{ state.nextIndex }} of {{ state.groups.length }} groups shown<span v-if="unseenCount"> · {{ unseenCount }} more to compare</span></p><button type="button" class="btn btn--ghost" :disabled="locked" @click="instructionsVisible = true">How this works</button></div>
    </div>
    <p class="comparison-deck__help">Tap a card or choose <strong>Prefer this group</strong> to replace the other one. This comparison stays on this page and sends no request. Swipe right or use <strong>Request to join</strong> to apply; swipe left to skip. You can have one pending application per concert.</p>
    <p v-if="!canApply && !submitted" class="comparison-deck__notice">You can compare groups. Set up and activate direct joining, or resolve your current application or offer, before applying.</p>
    <p v-if="submitted" class="comparison-deck__notice" role="status">Request sent to <strong>{{ groupName(submitted) }}</strong>. See Your applications for its queue position, whether a place is held and its deadline.</p>
    <div v-if="visibleCount" class="comparison-deck__pair">
      <div v-for="(group, slot) in state.slots" :key="slot" class="comparison-deck__position">
        <div v-if="group" :key="group.id" class="comparison-deck__candidate" :class="{ 'comparison-deck__candidate--favorite': state.favoriteId === group.id, 'comparison-deck__candidate--dragging': drag?.slot === slot }" :style="cardStyle(slot)" :data-comparison-slot="slot" tabindex="0" role="group" :aria-label="`${groupName(group)}. Enter to prefer; left arrow to skip; right arrow to request to join.`" :aria-disabled="locked" @click="onCardClick($event, slot)" @keydown="onKeydown($event, slot)" @pointerdown="onPointerDown($event, slot)" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="clearPointer">
          <span v-if="state.favoriteId === group.id" class="comparison-deck__favorite">Your comparison favorite</span>
          <GroupListingCard :group="group">
            <button type="button" class="btn btn--ghost comparison-deck__prefer" :disabled="locked" :aria-pressed="state.favoriteId === group.id" @click.stop="prefer(slot)">{{ state.slots[1 - slot] ? 'Prefer this group' : 'Keep this group' }}</button>
            <div class="comparison-deck__actions">
              <button type="button" class="btn btn--ghost" :disabled="locked" @click.stop="skip(slot)">Skip</button>
              <button type="button" class="btn btn--primary" :disabled="!canRequest(group)" @click.stop="request(slot)">{{ submitted?.id === group.id ? 'Request sent' : !acceptsRequests(group) ? 'Unavailable' : requestLabel(group) }}</button>
            </div>
          </GroupListingCard>
        </div>
        <div v-else class="comparison-deck__empty-position"><p>You have seen every other group on this page.</p><p>You can choose the remaining group, review this page again or change your filters.</p></div>
      </div>
    </div>
    <div v-else class="comparison-deck__empty"><p>{{ state.groups.length ? 'You have compared all the groups on this page.' : 'No groups to compare with these filters.' }}</p><p v-if="state.groups.length">Skipping a group here does not reject it permanently.</p></div>
    <div v-if="state.skippedIds.length" class="comparison-deck__review"><span>{{ state.skippedIds.length }} skipped in this comparison.</span><button type="button" class="btn btn--ghost" :disabled="locked || !!submitted" @click="restart">Review this page again</button></div>
    </div>
    </Transition>
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
  </section>
</template>

<style scoped>
.comparison-deck { display: grid; gap: var(--space-4); min-width: 0; }
.comparison-deck__content, .comparison-deck__instructions { display: grid; gap: var(--space-4); min-width: 0; }
.comparison-deck__instructions { padding: var(--space-5); border: var(--border-hairline); border-radius: var(--radius-lg); background: var(--ink-800); }
.comparison-deck__steps { padding: 0; margin: 0; list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.comparison-deck__steps li { display: flex; align-items: start; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius-md); background: var(--ink-750); }
.comparison-deck__step-number { flex: 0 0 28px; display: grid; place-items: center; height: 28px; border-radius: 50%; background: var(--accent-glow); color: var(--accent-400); font-weight: 600; }
.comparison-deck__steps h4 { margin: 0 0 var(--space-2); font-size: var(--step-0); }
.comparison-deck__steps p, .comparison-deck__start p { margin: 0; line-height: 1.6; color: var(--text-300); }
.comparison-deck__start { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); }
.comparison-deck__start p { max-width: 58ch; font-size: var(--step--1); }
.comparison-deck__tools { display: flex; align-items: center; justify-content: end; gap: var(--space-3); flex-wrap: wrap; }
.comparison-deck__intro { display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: var(--space-3); }
.comparison-deck__intro h3 { margin: 0 0 var(--space-2); font-size: var(--step-1); }
.comparison-deck__intro p, .comparison-deck__help { margin: 0; color: var(--text-300); line-height: 1.6; max-width: 78ch; }
.comparison-deck__progress { font-size: var(--step--1); }
.comparison-deck__notice { margin: 0; padding: var(--space-3) var(--space-4); border-left: 3px solid var(--accent-400); background: var(--ink-750); line-height: 1.6; }
.comparison-deck__pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); align-items: stretch; overflow: hidden; padding: 4px; margin: -4px; }
.comparison-deck__position { min-width: 0; display: flex; }
.comparison-deck__candidate { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; border-radius: var(--radius-lg); touch-action: pan-y; cursor: pointer; transition: transform 230ms ease, opacity 180ms ease; animation: comparison-arrive 180ms ease-out; }
.comparison-deck__candidate > :deep(.group-card) { flex: 1; }
.comparison-deck__candidate--favorite > :deep(.group-card) { border-color: var(--accent-400); }
.comparison-deck__candidate--dragging { user-select: none; }
.comparison-deck__candidate:focus-visible { outline: 2px solid var(--accent-400); outline-offset: 2px; }
.comparison-deck__favorite { padding: var(--space-2) var(--space-3); background: var(--accent-glow); color: var(--accent-400); border-radius: var(--radius-sm); font-size: var(--step--1); font-weight: 600; margin-bottom: var(--space-2); }
.comparison-deck__candidate :deep(.group-card__actions) { width: 100%; box-sizing: border-box; }
.comparison-deck__prefer { width: 100%; }
.comparison-deck__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); width: 100%; }
.comparison-deck__actions .btn { flex: 1 1 auto; white-space: normal; }
.comparison-deck__empty-position, .comparison-deck__empty { width: 100%; box-sizing: border-box; display: grid; align-content: center; gap: var(--space-3); padding: var(--space-5); border: var(--border-hairline); border-radius: var(--radius-lg); background: var(--ink-750); color: var(--text-300); line-height: 1.6; }
.comparison-deck__empty-position p, .comparison-deck__empty p { margin: 0; }
.comparison-deck__review { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); color: var(--text-300); font-size: var(--step--1); }
@media (max-width: 600px) {
  .comparison-deck__instructions { padding: var(--space-4); }
  .comparison-deck__steps { grid-template-columns: minmax(0, 1fr); }
  .comparison-deck__pair { gap: var(--space-2); }
  .comparison-deck__candidate :deep(.group-card) { padding: var(--space-3); gap: var(--space-3); font-size: var(--step--2); }
  .comparison-deck__candidate :deep(.group-card__head h3) { font-size: var(--step-0); }
  .comparison-deck__candidate :deep(.group-card__head) { gap: var(--space-2); }
  .comparison-deck__candidate :deep(.group-card__title) { flex-basis: 100%; }
  .comparison-deck__candidate :deep(.group-card__facts) { grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
  .comparison-deck__candidate :deep(.group-card__reasons) { padding-left: var(--space-3); }
  .comparison-deck__candidate :deep(.group-card__fit) { padding: var(--space-2); }
  .comparison-deck__candidate .btn { padding-inline: var(--space-2); font-size: var(--step--2); min-height: 44px; }
  .comparison-deck__actions { flex-direction: column; }
  .comparison-deck__empty-position { padding: var(--space-3); font-size: var(--step--1); }
}
.comparison-stage-enter-active, .comparison-stage-leave-active { transition: opacity 180ms ease, transform 180ms ease; }
.comparison-stage-enter-from { opacity: 0; transform: translateY(10px); }
.comparison-stage-leave-to { opacity: 0; transform: translateY(-6px); }
@keyframes comparison-arrive { from { opacity: 0.3; translate: 0 7px; } to { opacity: 1; translate: 0 0; } }
@media (prefers-reduced-motion: reduce) { .comparison-deck__candidate, .comparison-stage-enter-active, .comparison-stage-leave-active { transition: none; animation: none; } .comparison-stage-enter-from, .comparison-stage-leave-to { transform: none; } }
</style>
