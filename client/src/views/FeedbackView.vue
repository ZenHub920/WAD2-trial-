<script setup>
import { onMounted, ref } from "vue";
import { api } from "../api.js";
import LoadingSpinner from "../components/LoadingSpinner.vue";
import "../assets/groups.css";
const opportunities = ref([]),
  history = ref([]),
  error = ref(""),
  busy = ref(false),
  loading = ref(true),
  notice = ref(""),
  forms = ref({});
async function load() {
  const [a, b] = await Promise.all([
    api.feedbackOpportunities(),
    api.myFeedback(),
  ]);
  opportunities.value = a.opportunities;
  history.value = b.feedback;
  for (const item of opportunities.value)
    forms.value[`${item.partyId}:${item.ratedUserId}`] ??= {
      showedUp: true,
      rating: 4,
      comment: "",
    };
}
onMounted(async () => {
  try {
    await load();
  } catch (e) {
    error.value = "Could not load your feedback opportunities. Please refresh this page to try again.";
  } finally {
    loading.value = false;
  }
});
async function submit(item) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await api.leaveFeedback({
      partyId: item.partyId,
      ratedUserId: item.ratedUserId,
      ...forms.value[`${item.partyId}:${item.ratedUserId}`],
    });
    await load();
    notice.value = "Your feedback has been recorded.";
  } catch (e) {
    error.value = e.status === 409 ? "Feedback has already been recorded or is not available for this concert yet." : "Could not submit your feedback. Please try again.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="container groups-page">
    <header class="page-banner">
      <h1>Post-concert feedback</h1>
      <p>Share feedback about your group after the concert.</p>
    </header>
    <p v-if="error" role="alert" class="group-error">{{ error }}</p>
    <p v-if="notice" role="status" class="group-success">{{ notice }}</p>
    <p v-if="busy" class="loading-state" role="status"><LoadingSpinner />Submitting feedback…</p>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading feedback opportunities…</p>
    <p v-else-if="!opportunities.length && !error">
      No feedback to give right now. Feedback becomes available for eligible group companions after the concert.
    </p>
    <form
      v-for="item in opportunities"
      :key="`${item.partyId}:${item.ratedUserId}`"
      class="card group-panel"
      @submit.prevent="submit(item)"
    >
      <h2>{{ item.name }}, {{ item.artist }}</h2>
      <label class="group-check"
        ><input
          v-model="forms[`${item.partyId}:${item.ratedUserId}`].showedUp"
          type="checkbox"
          :disabled="busy"
        />This companion attended</label
      ><label
        >Communication rating<select
          v-model.number="forms[`${item.partyId}:${item.ratedUserId}`].rating"
          :disabled="busy"
        >
          <option v-for="n in 5" :key="n" :value="n">{{ n }}</option>
        </select></label
      ><label
        >Comment<textarea
          v-model="forms[`${item.partyId}:${item.ratedUserId}`].comment"
          maxlength="500"
          :disabled="busy"
        /></label
      ><button class="btn btn--primary" :disabled="busy">
        Submit feedback
      </button>
    </form>
    <section class="card group-panel">
      <h2>Your feedback history</h2>
      <p v-if="!loading && !history.length">You have not submitted any feedback yet.</p>
      <article v-for="item in history" :key="item.id">
        <p>
          {{ item.rating }}/5,
          {{ item.showedUp ? "Attended" : "Did not attend" }},
          {{ new Date(item.createdAt.includes('T') ? item.createdAt : item.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString() }}
        </p>
        <p>{{ item.comment }}</p>
      </article>
    </section>
  </div>
</template>
