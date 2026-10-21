<script setup>
import { onMounted, onUnmounted, ref } from "vue";
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
function toggleChoice(intent, id) {
  const index = selected.value[intent].indexOf(id);
  if (index === -1) selected.value[intent].push(id);
  else selected.value[intent].splice(index, 1);
}
function customList(intent) {
  return custom.value[intent].split("\n").map(text => text.trim()).filter(Boolean);
}
function removeCustom(intent, index) {
  const list = customList(intent);
  list.splice(index, 1);
  custom.value[intent] = list.join("\n");
}
function conceptLabel(intent, id) {
  return concepts.value.find(c => c.id === id)?.label ?? originalText.value[intent][id] ?? id;
}
function answerCount(intent) {
  return selected.value[intent].length + customList(intent).length;
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
      "You typed a preference but didn't add it. Press Add, or clear the box, before saving.";
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
        @click="activeIntent = intent">
        {{ label }}<span class="preference-editor__count">{{ answerCount(intent) }}</span>
      </button>
    </div>
    <section v-for="(label, intent) in labels" v-show="activeIntent === intent" :key="intent"
      class="preference-editor__content" :aria-label="label">
      <div class="preference-editor__choice-head">
        <h3>{{ label }}</h3>
        <span class="group-muted">Choose any that apply</span>
      </div>
      <div class="preference-editor__choices" role="group" :aria-label="label">
        <button v-for="concept in concepts" :key="concept.id" type="button"
          class="preference-editor__choice" :aria-pressed="selected[intent].includes(concept.id)"
          :disabled="busy" @click="toggleChoice(intent, concept.id)">
          <span aria-hidden="true">{{ selected[intent].includes(concept.id) ? '✓' : '+' }}</span>{{ concept.label }}
        </button>
      </div>

      <div class="preference-editor__chosen" aria-live="polite">
        <h4>Preferences chosen <span class="group-muted">({{ answerCount(intent) }})</span></h4>
        <ul v-if="answerCount(intent)" class="preference-editor__chips">
          <li v-for="id in selected[intent]" :key="id">
            <span>{{ conceptLabel(intent, id) }}</span>
            <button type="button" :disabled="busy" :aria-label="`Remove ${conceptLabel(intent, id)}`" @click="toggleChoice(intent, id)">×</button>
          </li>
          <li v-for="(text, index) in customList(intent)" :key="`custom-${index}-${text}`" class="preference-editor__chip--custom">
            <span>{{ text }}</span>
            <button type="button" :disabled="busy" :aria-label="`Remove ${text}`" @click="removeCustom(intent, index)">×</button>
          </li>
        </ul>
        <p v-else class="group-muted">Nothing chosen yet. Tap an option above, or add your own below.</p>

        <div class="preference-editor__add">
          <label :for="`custom-${intent}`">Add your own preference</label>
          <div class="preference-editor__add-row">
            <input :id="`custom-${intent}`" v-model="drafts[intent]" maxlength="100" :disabled="busy"
              placeholder="e.g. Happy to share a taxi home" @input="suggest(intent)" @keydown.enter.prevent="keepCustom(intent)">
            <button type="button" class="btn btn--ghost" :disabled="busy || !drafts[intent].trim()" @click="keepCustom(intent)">Add</button>
          </div>
          <p v-if="suggestionsLoading[intent]" class="loading-state" role="status"><LoadingSpinner />Looking for similar options…</p>
          <div v-if="drafts[intent].trim() && matches[intent].length" class="preference-editor__suggestions">
            <p class="group-muted">Did you mean one of these?</p>
            <div class="preference-editor__suggestion-actions">
              <button v-for="meaning in matches[intent]" :key="meaning.id" type="button"
                class="btn btn--ghost" :disabled="busy" @click="confirmMeaning(intent, meaning)">{{ meaning.label }}</button>
            </div>
          </div>
        </div>
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
.preference-editor__choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: var(--space-2); align-content: start; }
.preference-editor__choice { display: flex; gap: var(--space-2); align-items: center; text-align: left; min-height: 44px; padding: var(--space-2) var(--space-3); border: var(--border-soft); border-radius: var(--radius-sm); background: var(--ink-800); color: var(--text-200); cursor: pointer; font: inherit; font-size: var(--step--1); }
.preference-editor__choice[aria-pressed='true'] { border-color: var(--accent-400); color: var(--accent-400); background: var(--ink-700); }
.preference-editor__choice > span { width: 16px; flex: none; }
.preference-editor__choice:disabled { cursor: not-allowed; opacity: .55; }
.preference-editor__chosen { display: grid; gap: var(--space-3); padding: var(--space-4); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-850); }
.preference-editor__chosen h4 { margin: 0; font-size: var(--step-0); color: var(--text-100); }
.preference-editor__chosen > p { font-size: var(--step--1); }
.preference-editor__chips { display: flex; flex-wrap: wrap; gap: var(--space-2); list-style: none; padding: 0; margin: 0; }
.preference-editor__chips li { display: inline-flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3); border-radius: var(--radius-pill); background: var(--accent-500); color: #fff; font-size: var(--step--1); }
.preference-editor__chips li.preference-editor__chip--custom { background: var(--ink-800); color: var(--accent-400); border: 1px solid var(--accent-400); }
.preference-editor__chips button { display: inline-grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 1.1em; line-height: 1; cursor: pointer; }
.preference-editor__chips button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.2); }
.preference-editor__add { display: grid; gap: var(--space-2); padding-top: var(--space-3); border-top: var(--border-hairline); font-size: var(--step--1); }
.preference-editor__add-row { display: flex; gap: var(--space-2); max-width: 560px; }
.preference-editor__add-row input { flex: 1; min-width: 0; }
.preference-editor__add-row .btn { flex: none; }
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
