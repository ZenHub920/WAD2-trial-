<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { currentUser } from '../auth.js';
import PreferenceEditor from '../components/PreferenceEditor.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import { myPreferences, loadMyPreferences, saveMyPreferences } from '../groupPreferences.js';

/**
 * First stop after creating an account. Explains what the matching preferences
 * are for, shows the questionnaire straight away, then reminds the new member
 * that Profile is where they can change it later.
 */
const route = useRoute();
const router = useRouter();

// Only same-site paths, so ?next= cannot send someone to another website.
const next = computed(() => {
  const target = route.query.next;
  return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')
    ? target : '/concerts';
});

const loading = ref(true);
const saving = ref(false);
const error = ref('');
// 'editing' → questionnaire; 'saved' or 'skipped' → the closing note.
const step = ref('editing');

onMounted(async () => {
  try {
    await loadMyPreferences();
  } catch {
    // The editor still works with empty answers; saving reports its own errors.
    myPreferences.value = null;
  } finally {
    loading.value = false;
  }
});

async function save(answers) {
  saving.value = true;
  error.value = '';
  try {
    await saveMyPreferences(answers);
    step.value = 'saved';
  } catch {
    error.value = 'Could not save your answers. Please try again.';
  } finally {
    saving.value = false;
  }
}

const uses = [
  { title: 'Find a companion', text: 'We suggest fans going to the same concert whose style fits yours, so you never have to go alone.' },
  { title: 'Group recommendations', text: 'Groups are ranked by how well your answers fit with everyone already in them.' },
  { title: 'Private by default', text: 'Nobody sees your individual answers. Others only see how well you match.' },
];
const sections = [
  ['Finish the sentence', 'Quick picks about how you like to spend a concert.'],
  ['What I enjoy', 'Things you like doing, such as singing along or queueing early.'],
  ['What I enjoy in companions', 'What makes someone great to go with.'],
  ['What I prefer to avoid', 'Things that put you off. Mark up to three as dealbreakers.'],
];
</script>

<template>
  <div class="welcome container container--wide">
    <header class="welcome__head page-banner">
      <p class="welcome__eyebrow">Step 2 of 2 · Your preferences</p>
      <h1>Welcome to Encore{{ currentUser?.displayName ? `, ${currentUser.displayName}` : '' }}</h1>
      <p>Tell us what you enjoy at concerts so we can match you with the right people. It takes about two minutes.</p>
    </header>

    <div v-if="step === 'editing'" class="row g-4">
      <aside class="col-12 col-lg-4" aria-labelledby="welcome-why">
        <div class="welcome__panel welcome__why">
          <h2 id="welcome-why">What are preferences for?</h2>
          <ul class="welcome__uses">
            <li v-for="use in uses" :key="use.title">
              <strong>{{ use.title }}</strong>
              <span>{{ use.text }}</span>
            </li>
          </ul>
          <h3>What you'll answer</h3>
          <ol class="welcome__sections">
            <li v-for="[name, text] in sections" :key="name"><strong>{{ name }}</strong> {{ text }}</li>
          </ol>
          <p class="welcome__hint">Answer as much or as little as you like. Pick at least one thing to save.</p>
        </div>
      </aside>

      <section class="col-12 col-lg-8" aria-labelledby="welcome-form">
        <div class="welcome__panel">
          <p class="welcome__private">Private · Only you can see your answers</p>
          <h2 id="welcome-form">Your matching preferences</h2>
          <p v-if="error" class="welcome__error" role="alert">{{ error }}</p>
          <p v-if="loading" class="loading-state" role="status"><LoadingSpinner /> Loading the questionnaire…</p>
          <PreferenceEditor
            v-else
            :initial="myPreferences ?? undefined"
            :busy="saving"
            :saving="saving"
            require-one
            submit-label="Save preferences"
            @save="save"
          />
          <div class="welcome__skip d-flex flex-wrap align-items-center justify-content-between gap-3">
            <p>Not sure yet? You can browse concerts and join groups without answering.</p>
            <button type="button" class="btn btn--ghost" :disabled="saving" @click="step = 'skipped'">Skip for now</button>
          </div>
        </div>
      </section>
    </div>

    <section v-else class="welcome__panel welcome__done" role="status" aria-labelledby="welcome-done">
      <h2 id="welcome-done">{{ step === 'saved' ? 'Your preferences are saved' : 'No problem, you can do this later' }}</h2>
      <p v-if="step === 'saved'">Companion suggestions and group recommendations will now use your answers.</p>
      <p v-else>Companion matching works best once you've added a few preferences.</p>
      <p class="welcome__reminder">
        You can change your preferences anytime on your
        <RouterLink :to="{ path: '/profile', hash: '#preferences' }">Profile page</RouterLink>.
      </p>
      <div class="d-flex flex-wrap justify-content-center gap-3">
        <RouterLink :to="next" class="btn btn--primary">Continue</RouterLink>
        <RouterLink :to="{ path: '/profile', hash: '#preferences' }" class="btn btn--ghost">Go to Profile</RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.welcome {
  padding-block: var(--space-6) var(--space-9);
}

.welcome__head {
  margin-bottom: var(--space-6);
}

.welcome__eyebrow {
  margin-bottom: var(--space-1);
  font-size: var(--step--2);
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.8;
}

.welcome__panel {
  min-width: 0;
  padding: var(--space-5);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-lg);
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
}

.welcome__why {
  display: grid;
  gap: var(--space-4);
}

@media (min-width: 992px) {
  .welcome__why {
    position: sticky;
    top: calc(var(--header-height) + var(--space-4));
  }
}

.welcome__panel h2 {
  font-size: var(--step-1);
}

.welcome__panel h3 {
  color: var(--text-100);
  font-size: var(--step-0);
}

.welcome__uses,
.welcome__sections {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  color: var(--text-300);
  font-size: var(--step--1);
}

.welcome__uses {
  padding: 0;
  list-style: none;
}

.welcome__uses li {
  display: grid;
  gap: var(--space-1);
  padding-left: var(--space-3);
  border-left: 3px solid var(--accent-400);
}

.welcome__sections {
  padding-left: 1.2em;
}

.welcome__uses strong,
.welcome__sections strong {
  color: var(--text-100);
}

.welcome__sections strong {
  display: block;
}

.welcome__hint,
.welcome__skip p {
  color: var(--text-400);
  font-size: var(--step--1);
}

.welcome__private {
  margin-bottom: var(--space-1);
  color: var(--accent-400);
  font-size: var(--step--2);
  font-weight: 650;
}

.welcome__panel > h2 + * {
  margin-top: var(--space-4);
}

.welcome__error {
  color: var(--rose-400);
}

.welcome__skip {
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: var(--border-soft);
}

.welcome__skip p {
  max-width: 48ch;
}

.welcome__done {
  max-width: 640px;
  margin-inline: auto;
  display: grid;
  gap: var(--space-3);
  text-align: center;
}

.welcome__done p {
  color: var(--text-300);
}

.welcome__reminder {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--ink-750);
  color: var(--text-100) !important;
}
</style>
