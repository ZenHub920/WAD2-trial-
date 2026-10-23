<script setup>
/**
 * Preferences are an invitation, not a toll gate.
 *
 * They are answered once on the account and copied into every group the user
 * creates or joins, and they are what automatic matching ranks on — so this
 * asks for them up front and explains what they buy. But browsing groups and
 * applying to one are judgements the user makes themselves, and those stay
 * open whether or not the questions are ever answered. Only automatic
 * matching refuses without them, and it refuses at the point of switching it
 * on, where the reason makes sense.
 *
 * With `summary`, people who have answered see a one-line reminder they can
 * expand to edit.
 */
import { onMounted, ref } from 'vue';
import { myPreferences, loadMyPreferences, saveMyPreferences } from '../groupPreferences.js';
import PreferenceEditor from './PreferenceEditor.vue';
import LoadingSpinner from './LoadingSpinner.vue';

defineProps({ summary: Boolean });
const emit = defineEmits(['saved']);

const saving = ref(false), editing = ref(false);
const error = ref(''), notice = ref('');

const count = () => ['about', 'wants', 'avoid'].reduce((n, k) => n + (myPreferences.value?.[k]?.length ?? 0), 0);
const preview = () => ['about', 'wants'].flatMap(k => myPreferences.value?.[k] ?? []).slice(0, 4).map(a => a.text);

onMounted(async () => {
  try { await loadMyPreferences(); }
  catch (e) { error.value = e.status === 401 ? 'Sign in to use groups.' : 'Could not load your preferences. Please reload the page.'; }
});

async function save(answers) {
  const unlocking = !myPreferences.value;
  saving.value = true; error.value = ''; notice.value = '';
  try {
    await saveMyPreferences(answers);
    editing.value = false;
    notice.value = unlocking ? 'Preferences saved. Automatic matching is available now.' : 'Preferences saved. Your groups now use them.';
    emit('saved', myPreferences.value);
  } catch {
    error.value = 'Could not save your preferences. Please try again.';
  } finally { saving.value = false; }
}
</script>

<template>
  <p v-if="error && !myPreferences" class="group-error" role="alert">{{ error }}</p>
  <p v-else-if="myPreferences === undefined" class="loading-state" role="status"><LoadingSpinner />Loading your preferences…</p>
  <template v-else-if="!myPreferences">
  <section class="card group-panel pref-gate" aria-labelledby="pref-gate-heading">
    <div class="pref-gate__intro">
      <span class="pref-gate__step">Optional</span>
      <h2 id="pref-gate-heading">Tell us what you enjoy</h2>
      <p class="group-muted">This takes a moment and only has to be done once. Your answers are shared with any group you create or join, and they are what automatic matching uses to rank groups for you. You can skip it and browse groups below — only automatic matching needs them.</p>
      <ol class="pref-gate__guide">
        <li><span>1</span><div><strong>Pick what you enjoy</strong><p>Tap any options below, or type your own. Use the three tabs for what you enjoy, what you look for in companions, and what you'd rather avoid.</p></div></li>
        <li><span>2</span><div><strong>Check your choices</strong><p>Everything you pick appears under "Preferences chosen". Tap × to remove one.</p></div></li>
        <li><span>3</span><div><strong>Save when you are ready</strong><p>Press "Save preferences" at the bottom. You can change them any time.</p></div></li>
      </ol>
      <ul class="pref-gate__locked" aria-label="What these are used for">
        <li v-for="item in ['Automatic matching', 'Group suggestions', 'What hosts see about you']" :key="item">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5 11-11" /></svg>{{ item }}
        </li>
      </ul>
    </div>
    <PreferenceEditor :busy="saving" :saving="saving" require-one submit-label="Save preferences" @save="save" />
  </section>
    <p v-if="error" class="group-error" role="alert">{{ error }}</p>
    <slot name="before" />
    <slot :preferences="null" />
  </template>
  <template v-else>
    <p v-if="notice && !summary" class="group-success" role="status">✓ {{ notice }}</p>
    <section v-if="summary" class="card group-panel pref-summary" aria-labelledby="pref-summary-heading">
      <div class="pref-summary__row">
        <div>
          <h2 id="pref-summary-heading">Your preferences <span class="group-muted">({{ count() }})</span></h2>
          <p class="group-muted">{{ preview().join(' · ') || 'Nothing chosen' }}{{ count() > preview().length ? ' …' : '' }}</p>
        </div>
        <button type="button" class="btn btn--ghost" :aria-expanded="editing" @click="editing = !editing">{{ editing ? 'Close' : 'Edit' }}</button>
      </div>
      <p v-if="notice" class="group-success" role="status">✓ {{ notice }}</p>
      <p v-if="error" class="group-error" role="alert">{{ error }}</p>
      <PreferenceEditor v-if="editing" :initial="myPreferences" :busy="saving" :saving="saving" require-one @save="save" />
    </section>
    <slot name="before" />
    <slot :preferences="myPreferences" />
  </template>
</template>

<style scoped>
.pref-gate { border: var(--border-soft); }
.pref-gate__intro { display: grid; gap: var(--space-2); }
.pref-gate__step { width: fit-content; padding: 2px var(--space-2); border-radius: var(--radius-pill); background: var(--mint-500); color: #fff; font-size: var(--step--2); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.pref-gate__intro h2 { font-size: var(--step-2); }
.pref-gate__guide { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: var(--space-3); margin: var(--space-3) 0 0; padding: 0; list-style: none; }
.pref-gate__guide li { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3); border-radius: var(--radius-md); background: var(--ink-850); border: var(--border-hairline); }
.pref-gate__guide li > span { display: grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--mint-500); color: #fff; font-weight: 700; font-size: var(--step--1); }
.pref-gate__guide li > div { display: grid; gap: var(--space-1); min-width: 0; }
.pref-gate__guide p { color: var(--text-300); font-size: var(--step--1); line-height: 1.5; }
.pref-gate__locked { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-2) 0 0; padding: 0; list-style: none; }
.pref-gate__locked li { display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); border: 1px dashed var(--ink-500); border-radius: var(--radius-pill); color: var(--text-400); font-size: var(--step--1); }
.pref-gate__locked svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; }
.pref-summary__row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); }
.pref-summary__row > div { display: grid; gap: var(--space-1); min-width: 0; flex: 1 1 18rem; }
.pref-summary__row p { font-size: var(--step--1); }
</style>
