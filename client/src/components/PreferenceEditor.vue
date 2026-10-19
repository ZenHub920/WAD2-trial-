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
  <form class="group-panel" @submit.prevent="save">
    <h2>Your companion preferences</h2>
    <p v-if="error" role="alert" class="group-error">{{ error }}</p>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading preference choices…</p>
    <details
      v-for="(label, intent) in labels"
      :key="intent"
      :open="intent === 'about'"
    >
      <summary>{{ label }}</summary>
      <div class="group-controls">
        <label v-for="c in concepts" :key="c.id" class="group-check"
          ><input
            v-model="selected[intent]"
            type="checkbox"
            :value="c.id"
            :disabled="busy"
          />{{ c.label }}</label
        >
      </div>
      <label
        >Add a preference in your own words<input
          v-model="drafts[intent]"
          maxlength="100"
          :disabled="busy"
          placeholder="e.g. late-night makan"
          @input="suggest(intent)"
      /></label>
      <p v-if="suggestionsLoading[intent]" class="loading-state" role="status"><LoadingSpinner />Loading preference suggestions…</p>
      <div v-if="drafts[intent].trim()" class="group-panel" aria-live="polite">
        <p>Does one of these meanings fit?</p>
        <button
          v-for="meaning in matches[intent]"
          :key="meaning.id"
          type="button"
          class="btn btn--ghost"
          :disabled="busy"
          @click="confirmMeaning(intent, meaning)"
        >
          {{ meaning.label }}</button
        ><button
          type="button"
          class="btn btn--ghost"
          :disabled="busy"
          @click="keepCustom(intent)"
        >
          Keep my wording
        </button>
      </div>
      <label
        >Custom preferences (one per line)<textarea
          v-model="custom[intent]"
          maxlength="3000"
          rows="3"
          :disabled="busy"
        />
      </label>
    </details>
    <button class="btn btn--primary" :disabled="busy || !concepts.length">
      <LoadingSpinner v-if="saving" />
      {{ busy ? 'Saving…' : 'Save companion preferences' }}
    </button>
  </form>
</template>
