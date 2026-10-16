<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { api } from "../api.js";
const props = defineProps({
  initial: { type: Object, default: () => ({}) },
  busy: Boolean,
});
const emit = defineEmits(["save"]);
const concepts = ref([]),
  error = ref("");
const drafts = ref({ about: "", wants: "", avoid: "" });
const matches = ref({ about: [], wants: [], avoid: [] });
const originalText = ref(
  Object.fromEntries(
    ["about", "wants", "avoid"].map((k) => [
      k,
      Object.fromEntries(
        (props.initial[k] ?? [])
          .filter((x) => x.recognized !== false)
          .map((x) => [x.key ?? x.conceptId, x.text]),
      ),
    ]),
  ),
);
const timers = {},
  generations = { about: 0, wants: 0, avoid: 0 };
let alive = true;
function suggest(intent) {
  clearTimeout(timers[intent]);
  const current = ++generations[intent];
  matches.value[intent] = [];
  const text = drafts.value[intent].trim();
  if (!text) return;
  timers[intent] = setTimeout(async () => {
    try {
      const result = await api.preferenceConcepts(text);
      if (alive && current === generations[intent])
        matches.value[intent] = result.concepts;
    } catch (e) {
      if (alive && current === generations[intent]) error.value = e.message;
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
const selected = ref(
  Object.fromEntries(
    ["about", "wants", "avoid"].map((k) => [
      k,
      (props.initial[k] ?? [])
        .filter((x) => x.recognized !== false)
        .map((x) => x.key ?? x.conceptId)
        .filter(Boolean),
    ]),
  ),
);
const custom = ref(
  Object.fromEntries(
    ["about", "wants", "avoid"].map((k) => [
      k,
      (props.initial[k] ?? [])
        .filter((x) => x.recognized === false || x.key?.startsWith("custom:"))
        .map((x) => x.text)
        .join("\n"),
    ]),
  ),
);
const labels = {
  about: "What I enjoy",
  wants: "What I enjoy in companions",
  avoid: "What I prefer to avoid (soft preferences)",
};
onMounted(async () => {
  try {
    concepts.value = (await api.preferenceConcepts()).concepts;
  } catch (e) {
    error.value = e.message;
  }
});
function save() {
  if (Object.values(drafts.value).some((text) => text.trim())) {
    error.value =
      "Choose a suggested meaning or keep each draft as custom before saving.";
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
    <p>
      Everyone answers individually. Your group's summary reflects each member
      equally. Custom wording stays visible; recognized concepts improve
      recommendations.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
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
          Use meaning: {{ meaning.label }}</button
        ><button
          type="button"
          class="btn btn--ghost"
          :disabled="busy"
          @click="keepCustom(intent)"
        >
          Keep my wording as an unmapped custom preference
        </button>
      </div>
      <label
        >Custom preferences — one per line<textarea
          v-model="custom[intent]"
          maxlength="3000"
          rows="3"
          :disabled="busy"
        />
      </label>
    </details>
    <button class="btn btn--primary" :disabled="busy || !concepts.length">
      Save preferences
    </button>
  </form>
</template>
