<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { api } from "../api.js";
import LoadingSpinner from "./LoadingSpinner.vue";
const props = defineProps({
  initial: { type: Object, default: () => ({}) },
  busy: Boolean,
  saving: Boolean,
});
const emit = defineEmits(["save"]);
const concepts = ref([]),
  error = ref("");
const loading = ref(true);
const suggestionsLoading = ref({ about: false, wants: false, avoid: false });
const drafts = ref({ about: "", wants: "", avoid: "" });
const matches = ref({ about: [], wants: [], avoid: [] });
const originalText = ref({}), selected = ref({}), custom = ref({});
const activeIntent = ref("about");
const choiceQuery = ref("");
const visibleConcepts = computed(() => concepts.value.filter(concept =>
  concept.label.toLowerCase().includes(choiceQuery.value.trim().toLowerCase()),
));
function toggleChoice(intent, id) {
  const index = selected.value[intent].indexOf(id);
  if (index === -1) selected.value[intent].push(id);
  else selected.value[intent].splice(index, 1);
}
function answerCount(intent) {
  return selected.value[intent].length + custom.value[intent].split("\n").filter(text => text.trim()).length;
}
for (const intent of ["about", "wants", "avoid"]) {
  const answers = props.initial[intent] ?? [];
  const recognized = answers.filter((answer) => answer.recognized !== false);
  originalText.value[intent] = Object.fromEntries(
    recognized.map((answer) => [answer.key ?? answer.conceptId, answer.text]),
  );
  selected.value[intent] = recognized
    .map((answer) => answer.key ?? answer.conceptId)
    .filter(Boolean);
  custom.value[intent] = answers
    .filter((answer) => answer.recognized === false || answer.key?.startsWith("custom:"))
    .map((answer) => answer.text)
    .join("\n");
}
const timers = {},
  generations = { about: 0, wants: 0, avoid: 0 };
let alive = true;
function suggest(intent) {
  clearTimeout(timers[intent]);
  const current = ++generations[intent];
  matches.value[intent] = [];
  suggestionsLoading.value[intent] = false;
  const text = drafts.value[intent].trim();
  if (!text) return;
  timers[intent] = setTimeout(async () => {
    suggestionsLoading.value[intent] = true;
    try {
      const result = await api.preferenceConcepts(text);
      if (alive && current === generations[intent])
        matches.value[intent] = result.concepts;
    } catch (e) {
      if (alive && current === generations[intent]) error.value = "Could not load preference suggestions. You can keep your own wording.";
    } finally {
      if (alive && current === generations[intent]) suggestionsLoading.value[intent] = false;
    }
  }, 250);
}
function confirmMeaning(intent, concept) {
  if (!selected.value[intent].includes(concept.id))
    selected.value[intent].push(concept.id);
  originalText.value[intent][concept.id] = drafts.value[intent].trim();
  drafts.value[intent] = "";
  suggest(intent);
}
function keepCustom(intent) {
  const text = drafts.value[intent].trim();
  if (!text) return;
  custom.value[intent] = [custom.value[intent], text]
    .filter(Boolean)
    .join("\n");
  drafts.value[intent] = "";
  suggest(intent);
}
onUnmounted(() => {
  alive = false;
  for (const timer of Object.values(timers)) clearTimeout(timer);
});
const labels = {
  about: "What I enjoy",
  wants: "What I enjoy in companions",
  avoid: "What I prefer to avoid",
};
onMounted(async () => {
  try {
    concepts.value = (await api.preferenceConcepts()).concepts;
  } catch (e) {
    error.value = "Could not load the preference choices. Please reopen this page to try again.";
  } finally {
    loading.value = false;
  }
});
function save() {
  if (Object.values(drafts.value).some((text) => text.trim())) {
    error.value =
      "Choose a suggestion or keep your wording before saving.";
    return;
  }
  const answers = {};
  for (const k of ["about", "wants", "avoid"])
    answers[k] = [
      ...selected.value[k].map((id) => ({
        text:
          originalText.value[k][id] ??
          concepts.value.find((c) => c.id === id).label,
        conceptId: id,
      })),
      ...custom.value[k]
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ text, custom: true })),
    ];
  emit("save", answers);
}
</script>
<template>
  <form class="preference-editor" @submit.prevent="save">
    <p class="preference-editor__intro">Choose what matters to you. These preferences help compare you with groups and companions.</p>
    <p v-if="error" role="alert" class="group-error">{{ error }}</p>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading preference choices…</p>
    <div class="preference-editor__sections" role="group" aria-label="Preference sections">
      <button v-for="(label, intent) in labels" :key="intent" type="button"
        :aria-pressed="activeIntent === intent" class="preference-editor__section"
        @click="activeIntent = intent; choiceQuery = ''">
        {{ label }}<span class="preference-editor__count">{{ answerCount(intent) }}</span>
      </button>
    </div>
    <section v-for="(label, intent) in labels" v-show="activeIntent === intent" :key="intent"
      class="preference-editor__content" :aria-label="label">
      <div class="preference-editor__choice-head">
        <h3>{{ label }}</h3>
        <span class="group-muted">Choose any that apply</span>
      </div>
      <label class="preference-editor__search">Find a preference
        <input v-model="choiceQuery" type="search" placeholder="Search preference choices" :disabled="loading || busy">
      </label>
      <div class="preference-editor__choices" role="group" :aria-label="label">
        <button v-for="concept in visibleConcepts" :key="concept.id" type="button"
          class="preference-editor__choice" :aria-pressed="selected[intent].includes(concept.id)"
          :disabled="busy" @click="toggleChoice(intent, concept.id)">
          <span aria-hidden="true">{{ selected[intent].includes(concept.id) ? '✓' : '+' }}</span>{{ concept.label }}
        </button>
      </div>
      <p v-if="!loading && !visibleConcepts.length" class="group-muted">No matching choices. Add your own below.</p>
      <div class="preference-editor__custom">
        <label>Add your own preference
          <input v-model="drafts[intent]" maxlength="100" :disabled="busy"
            placeholder="Describe a preference" @input="suggest(intent)">
        </label>
        <p v-if="suggestionsLoading[intent]" class="loading-state" role="status"><LoadingSpinner />Loading preference suggestions…</p>
        <div v-if="drafts[intent].trim()" class="preference-editor__suggestions" aria-live="polite">
          <p v-if="matches[intent].length">Choose a matching meaning, or keep your wording.</p>
          <div class="preference-editor__suggestion-actions">
            <button v-for="meaning in matches[intent]" :key="meaning.id" type="button"
              class="btn btn--ghost" :disabled="busy" @click="confirmMeaning(intent, meaning)">{{ meaning.label }}</button>
            <button type="button" class="btn btn--ghost" :disabled="busy" @click="keepCustom(intent)">Keep my wording</button>
          </div>
        </div>
        <details :open="Boolean(custom[intent].trim())" class="preference-editor__custom-list">
          <summary>Your custom preferences</summary>
          <label>One preference per line
            <textarea v-model="custom[intent]" maxlength="3000" rows="3" :disabled="busy" />
          </label>
        </details>
      </div>
    </section>
    <footer class="preference-editor__footer">
      <p class="group-muted">Save to apply changes from all three sections.</p>
      <button class="btn btn--primary" :disabled="busy || !concepts.length">
        <LoadingSpinner v-if="saving" />{{ saving ? 'Saving…' : 'Save preferences' }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.preference-editor { display: grid; gap: var(--space-5); min-width: 0; }
.preference-editor__intro { color: var(--text-300); max-width: 65ch; line-height: 1.6; }
.preference-editor__sections { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 4px; gap: 4px; background: var(--ink-700); border-radius: var(--radius-sm); }
.preference-editor__section { display: flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: 48px; padding: var(--space-2) var(--space-3); border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-300); cursor: pointer; font: inherit; font-size: var(--step--1); }
.preference-editor__section[aria-pressed='true'] { background: var(--ink-800); color: var(--accent-400); border-color: var(--accent-400); }
.preference-editor__count { display: inline-grid; place-items: center; flex: none; min-width: 22px; height: 22px; border-radius: 50%; background: var(--ink-700); font-size: 12px; }
.preference-editor__content { display: grid; gap: var(--space-4); min-width: 0; }
.preference-editor__choice-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: var(--space-2); }
.preference-editor__choice-head h3 { margin: 0; font-size: var(--step-1); }
.preference-editor__choice-head span { font-size: var(--step--1); }
.preference-editor__search { max-width: 420px; }
.preference-editor__choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: var(--space-2); max-height: 250px; overflow-y: auto; padding: 3px; margin: -3px; align-content: start; }
.preference-editor__choice { display: flex; gap: var(--space-2); align-items: center; text-align: left; min-height: 44px; padding: var(--space-2) var(--space-3); border: var(--border-soft); border-radius: var(--radius-sm); background: var(--ink-800); color: var(--text-200); cursor: pointer; font: inherit; font-size: var(--step--1); }
.preference-editor__choice[aria-pressed='true'] { border-color: var(--accent-400); color: var(--accent-400); background: var(--ink-700); }
.preference-editor__choice > span { width: 16px; flex: none; }
.preference-editor__choice:disabled { cursor: not-allowed; opacity: .55; }
.preference-editor__custom { display: grid; gap: var(--space-3); padding-top: var(--space-4); border-top: var(--border-hairline); }
.preference-editor__custom > label { max-width: 560px; }
.preference-editor__custom-list { max-width: 680px; }
.preference-editor__custom-list summary { color: var(--text-300); font-size: var(--step--1); cursor: pointer; padding-block: var(--space-2); }
.preference-editor__suggestions { display: grid; gap: var(--space-2); font-size: var(--step--1); }
.preference-editor__suggestion-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.preference-editor__footer { display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); border-top: var(--border-hairline); padding-top: var(--space-4); }
.preference-editor__footer p { font-size: var(--step--1); }
.preference-editor__footer .btn { flex: none; min-height: 44px; }
@media (max-width: 600px) {
  .preference-editor__sections { grid-template-columns: 1fr; }
  .preference-editor__section { justify-content: space-between; }
  .preference-editor__footer { align-items: stretch; flex-direction: column; }
}
</style>
