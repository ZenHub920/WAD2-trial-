<script setup>
import { formatMeetupDateTime, utcDiscussionTimestamp } from '../utils/meetupTime.js';

const props = defineProps({
  comments: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  canDiscuss: { type: Boolean, default: false },
  modelValue: { type: String, default: '' },
  notice: { type: String, default: '' },
  error: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue', 'submit']);
function submit() {
  if (!props.busy && props.canDiscuss && props.modelValue.trim()) emit('submit');
}
</script>

<template>
  <section class="card group-panel meetup-discussion">
    <h2>Discussion</h2>
    <p class="group-muted">Ask questions or suggest changes.</p>
    <p v-if="!comments.length">No messages yet.</p>
    <article v-for="entry in comments" :key="entry.id" class="meetup-comment">
      <div>
        <strong>{{ entry.name }}</strong>
        <time v-if="entry.createdAt" :datetime="utcDiscussionTimestamp(entry.createdAt)">{{ formatMeetupDateTime(Date.parse(utcDiscussionTimestamp(entry.createdAt))) }}</time>
      </div>
      <p>{{ entry.body }}</p>
    </article>
    <form class="group-panel" @submit.prevent="submit">
      <label>Message<textarea
        :value="modelValue" :disabled="busy || !canDiscuss" maxlength="2000" required
        @input="emit('update:modelValue', $event.target.value)" /></label>
      <button class="btn btn--primary" :disabled="busy || !canDiscuss || !modelValue.trim()">Post</button>
    </form>
    <p v-if="notice" class="group-success" role="status">{{ notice }}</p>
    <p v-if="error" class="group-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.meetup-comment { display: grid; gap: .5rem; }
.meetup-comment > div { display: flex; flex-wrap: wrap; gap: .6rem; align-items: baseline; }
.meetup-comment time { color: var(--text-300); font-size: .85rem; }
.meetup-comment p { white-space: pre-wrap; }
</style>
