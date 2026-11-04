<script setup>
/**
 * A dropdown you can type into: the list narrows to the closest matches and the
 * best one is highlighted, so Enter picks it. The value must be one of the
 * options (it holds the option's `value`, e.g. a concert id);
 * leaving without picking puts the chosen option's label back.
 */
import { computed, nextTick, ref, watch } from 'vue';
import '../assets/suggest.css';

defineOptions({ inheritAttrs: false });
const props = defineProps({
  modelValue: { type: String, default: '' },
  // [{ value, label }]
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  required: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  emptyText: { type: String, default: 'No matches. Try another word.' },
});
const emit = defineEmits(['update:modelValue']);

const input = ref(null);
const open = ref(false);
const active = ref(-1);
const query = ref('');
const typing = ref(false);
const listId = `select-${Math.random().toString(36).slice(2, 8)}`;

const selected = computed(() => props.options.find((option) => option.value === props.modelValue) ?? null);
// Show the chosen option's label whenever the person is not typing.
watch(selected, (option) => { if (!typing.value) query.value = option?.label ?? ''; }, { immediate: true });

/**
 * Closest matches first. Every typed word must appear somewhere; a label that
 * starts with the text scores highest, then words that start with a typed word.
 * Ties keep the original order (soonest concert first).
 */
const shown = computed(() => {
  const text = typing.value ? query.value.trim().toLowerCase() : '';
  if (!text) return props.options;
  const words = text.split(/\s+/);
  return props.options
    .map((option, index) => {
      const label = option.label.toLowerCase();
      if (!words.every((word) => label.includes(word))) return null;
      const starts = label.split(/[\s,·]+/);
      const score = (label.startsWith(text) ? 100 : 0)
        + words.filter((word) => starts.some((part) => part.startsWith(word))).length * 10;
      return { option, index, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.option);
});

// The browser's required check can't see a typed-but-unpicked value, so say it here.
watch([() => props.modelValue, () => props.required, input], () => {
  input.value?.setCustomValidity(props.required && !props.modelValue ? 'Choose an option from the list.' : '');
}, { immediate: true });

function show() {
  if (props.disabled) return;
  open.value = true;
  active.value = typing.value && shown.value.length ? 0 : shown.value.findIndex((option) => option.value === props.modelValue);
}
function close() {
  open.value = false;
  active.value = -1;
  typing.value = false;
  query.value = selected.value?.label ?? '';
}
function pick(option) {
  emit('update:modelValue', option.value);
  typing.value = false;
  query.value = option.label;
  open.value = false;
  active.value = -1;
  // A pick is not typing, so announce it: inline form errors (formErrors.js) clear on change.
  nextTick(() => input.value?.dispatchEvent(new Event('change', { bubbles: true })));
}
function onFocus(event) {
  // Select the current label so typing replaces it straight away. The list waits
  // for a click, typing or the arrow keys, so focus alone (e.g. jumping to a field
  // with an error) does not cover the form.
  event.target.select();
}
function onInput(event) {
  query.value = event.target.value;
  typing.value = true;
  open.value = true;
  active.value = shown.value.length ? 0 : -1;
}
function onKeydown(event) {
  const count = shown.value.length;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!open.value) { show(); return; }
    if (!count) return;
    active.value = event.key === 'ArrowDown' ? (active.value + 1) % count : (active.value - 1 + count) % count;
  } else if (event.key === 'Enter' && open.value) {
    // Pick the highlighted match instead of submitting the form.
    event.preventDefault();
    if (active.value >= 0 && shown.value[active.value]) pick(shown.value[active.value]);
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    close();
  }
}
</script>

<template>
  <span class="suggest suggest--select">
    <input
      ref="input"
      v-bind="$attrs"
      :value="query"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="required"
      :style="{ paddingRight: '2.6rem' }"
      role="combobox"
      autocomplete="off"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="active >= 0 ? `${listId}-${active}` : undefined"
      @input="onInput"
      @focus="onFocus"
      @click="show"
      @blur="close"
      @keydown="onKeydown"
    />
    <svg class="suggest__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
    <ul v-show="open" :id="listId" class="suggest__list" role="listbox">
      <!-- mousedown, not click: picking must happen before the input's blur closes the list. -->
      <li
        v-for="(option, index) in shown"
        :id="`${listId}-${index}`"
        :key="option.value"
        role="option"
        class="suggest__option"
        :class="{ 'suggest__option--active': index === active, 'suggest__option--chosen': option.value === modelValue }"
        :aria-selected="option.value === modelValue"
        @mousedown.prevent="pick(option)"
        @mousemove="active = index"
      >{{ option.label }}</li>
      <li v-if="!shown.length" class="suggest__empty" role="presentation">{{ emptyText }}</li>
    </ul>
  </span>
</template>

<style scoped>
.suggest__chevron {
  position: absolute;
  top: 50%;
  right: var(--space-3);
  width: 18px;
  height: 18px;
  transform: translateY(-50%);
  fill: none;
  stroke: var(--text-300);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}
</style>
