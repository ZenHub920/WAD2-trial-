<script setup>
/**
 * The fill-in-the-blank deck, one card at a time.
 *
 * WHY A DECK AND NOT A FORM
 * -------------------------
 * The same seven questions as a page of radio groups is a page people close.
 * One sentence at a time, each finished by tapping a phrase, is read rather
 * than filled in — and because every card is a single tap, the whole deck is
 * seven taps rather than seven decisions about how to answer.
 *
 * Answering advances automatically, which is what makes it feel like a deck
 * instead of a form. The last card does not advance anywhere, so it keeps its
 * answer visible and leaves the saving to the page around it.
 *
 * Skipping is first-class: the dimensions are scored only where both people
 * answered, so a partial deck costs its owner nothing except precision, and
 * forcing an answer would buy a worse one.
 */
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import LoadingSpinner from './LoadingSpinner.vue';

const props = defineProps({
  /** Previously saved `[{ card, option }]`, so returning shows the answers. */
  initial: { type: Array, default: () => [] },
  busy: Boolean,
});
const emit = defineEmits(['change']);

const cards = ref([]);
const loading = ref(true);
const error = ref('');
const index = ref(0);
/** card id → option id. */
const picked = ref(Object.fromEntries(props.initial.map((a) => [a.card, a.option])));

const card = computed(() => cards.value[index.value] ?? null);
const answered = computed(() => cards.value.filter((c) => picked.value[c.id]).length);
const onLast = computed(() => index.value >= cards.value.length - 1);

/** Deck order, so what is saved matches what the server stores. */
function answers() {
  return cards.value
    .filter((c) => picked.value[c.id])
    .map((c) => ({ card: c.id, option: picked.value[c.id] }));
}

function choose(optionId) {
  if (props.busy || !card.value) return;
  picked.value = { ...picked.value, [card.value.id]: optionId };
  emit('change', answers());
  // A beat before advancing, so the choice is seen to register rather than
  // the card vanishing out from under the finger that tapped it.
  if (!onLast.value) setTimeout(() => { if (!onLast.value) index.value += 1; }, 220);
}

const back = () => { if (index.value > 0) index.value -= 1; };
const skip = () => { if (!onLast.value) index.value += 1; };

onMounted(async () => {
  try {
    cards.value = (await api.preferenceQuiz()).cards;
    // Open on the first unanswered card, so returning continues rather than
    // making someone tap past what they already did.
    const next = cards.value.findIndex((c) => !picked.value[c.id]);
    index.value = next === -1 ? cards.value.length - 1 : next;
  } catch {
    error.value = 'Could not load these questions. The rest of the page still works.';
  } finally {
    loading.value = false;
  }
});

defineExpose({ answers });
</script>

<template>
  <section class="quiz" aria-labelledby="quiz-heading">
    <header class="quiz__head">
      <div>
        <h3 id="quiz-heading">Finish the sentence</h3>
        <p class="quiz__sub">Seven of these. Tap whichever sounds most like you.</p>
      </div>
      <p class="quiz__count" aria-live="polite">{{ answered }} / {{ cards.length || 7 }}</p>
    </header>

    <p v-if="error" class="quiz__error" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading…</p>

    <template v-else-if="card">
      <ol class="quiz__pips" :aria-label="`Card ${index + 1} of ${cards.length}`">
        <li v-for="(c, i) in cards" :key="c.id"
          :class="['quiz__pip', { 'quiz__pip--done': picked[c.id], 'quiz__pip--here': i === index }]" />
      </ol>

      <!-- Keyed so each card is a fresh element and the transition runs. -->
      <Transition name="quiz-card" mode="out-in">
        <article :key="card.id" class="quiz__card">
          <p class="quiz__prompt">{{ card.prompt }}</p>
          <p v-if="card.hint" class="quiz__hint">{{ card.hint }}</p>
          <div class="quiz__options" role="group" :aria-label="card.prompt">
            <button v-for="option in card.options" :key="option.id" type="button"
              class="quiz__option" :aria-pressed="picked[card.id] === option.id"
              :disabled="busy" @click="choose(option.id)">
              {{ option.text }}
            </button>
          </div>
        </article>
      </Transition>

      <footer class="quiz__foot">
        <button type="button" class="btn btn--ghost" :disabled="busy || index === 0" @click="back">Back</button>
        <button v-if="!onLast" type="button" class="btn btn--ghost" :disabled="busy" @click="skip">
          {{ picked[card.id] ? 'Next' : 'Skip this one' }}
        </button>
        <p v-else class="quiz__done">That's the last one — save below.</p>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.quiz { display: grid; gap: var(--space-4); padding: var(--space-4); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-850); }
.quiz__head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); }
.quiz__head h3 { margin: 0; font-size: var(--step-1); }
.quiz__sub { margin: 4px 0 0; color: var(--text-300); font-size: var(--step--1); }
.quiz__count { margin: 0; flex: none; color: var(--text-300); font-size: var(--step--1); font-variant-numeric: tabular-nums; }
.quiz__error { color: var(--text-200); font-size: var(--step--1); }

/* Progress as pips rather than a bar: it shows which cards are answered, not
   only how far along the deck is, so skipped ones stay visible. */
.quiz__pips { display: flex; gap: 6px; list-style: none; margin: 0; padding: 0; }
/* --ink-600 rather than --ink-700: the unanswered track has to stay visible
   against the card it sits on, or the deck looks three cards long. */
.quiz__pip { width: 100%; height: 4px; border-radius: var(--radius-pill); background: var(--ink-600); transition: background-color var(--dur-fast); }
.quiz__pip--done { background: var(--mint-500); }
.quiz__pip--here { background: var(--accent-400); }

.quiz__card { display: grid; gap: var(--space-3); }
.quiz__prompt { margin: 0; font-size: var(--step-2); line-height: 1.35; font-weight: 600; color: var(--text-100); }
.quiz__hint { margin: 0; color: var(--text-300); font-size: var(--step--1); }
.quiz__options { display: grid; gap: var(--space-2); }
.quiz__option { text-align: left; min-height: 52px; padding: var(--space-3) var(--space-4); border: var(--border-soft); border-radius: var(--radius-sm); background: var(--ink-800); color: var(--text-200); font: inherit; cursor: pointer; transition: background-color var(--dur-fast), border-color var(--dur-fast), transform var(--dur-fast); }
.quiz__option:hover:not(:disabled) { border-color: var(--mint-400); transform: translateX(2px); }
.quiz__option[aria-pressed='true'] { border-color: var(--mint-500); background: var(--mint-500); color: #fff; font-weight: 600; }
:root[data-theme='dark'] .quiz__option[aria-pressed='true'] { color: #08070c; }
.quiz__option:disabled { cursor: not-allowed; opacity: .55; }

.quiz__foot { display: flex; align-items: center; gap: var(--space-2); border-top: var(--border-hairline); padding-top: var(--space-3); }
.quiz__foot .btn { flex: none; min-height: 44px; }
.quiz__done { margin: 0 0 0 auto; color: var(--text-300); font-size: var(--step--1); }

/* Cards slide in from the right and leave to the left, so the deck reads as a
   sequence going forward rather than as a panel being swapped. */
.quiz-card-enter-active, .quiz-card-leave-active { transition: opacity var(--dur-fast), transform var(--dur-fast); }
.quiz-card-enter-from { opacity: 0; transform: translateX(18px); }
.quiz-card-leave-to { opacity: 0; transform: translateX(-18px); }
@media (prefers-reduced-motion: reduce) {
  .quiz-card-enter-active, .quiz-card-leave-active { transition: none; }
  .quiz-card-enter-from, .quiz-card-leave-to { transform: none; }
  .quiz__option:hover:not(:disabled) { transform: none; }
}
@media (max-width: 600px) {
  .quiz__head { flex-direction: column; }
  .quiz__foot { flex-wrap: wrap; }
  .quiz__done { margin-left: 0; }
}
</style>
