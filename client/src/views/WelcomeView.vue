<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PreferenceEditor from '../components/PreferenceEditor.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import { myPreferences, loadMyPreferences, saveMyPreferences } from '../groupPreferences.js';

/**
 * First stop after creating an account. Saving preferences is required before
 * the rest of Encore opens (see routeGuards.js), so there is no skip. Afterwards
 * it reminds the new member that Profile is where they can change them later.
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
// 'editing' → questionnaire; 'saved' → the closing note.
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
</script>

<template>
  <div class="welcome container container--wide">
    <section v-if="step === 'editing'" class="welcome__panel welcome__form" aria-labelledby="welcome-form">
      <p class="welcome__private">Private · Only you can see your answers</p>
      <h1 id="welcome-form">Your matching preferences</h1>
      <p class="welcome__required">Save your preferences to start using Encore. Pick at least one thing; you can change them anytime.</p>
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
    </section>

    <section v-else class="welcome__panel welcome__done" role="status" aria-labelledby="welcome-done">
      <h1 id="welcome-done">Your preferences are saved</h1>
      <p>Companion suggestions and group recommendations will now use your answers.</p>
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

.welcome__panel {
  min-width: 0;
  padding: var(--space-5);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-lg);
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
}

/* One centred card at a comfortable reading width. */
.welcome__form {
  max-width: 760px;
  margin-inline: auto;
}

.welcome__panel h1 {
  font-size: var(--step-2);
}

.welcome__required {
  color: var(--text-300);
  font-size: var(--step--1);
}

.welcome__private {
  margin-bottom: var(--space-1);
  color: var(--accent-400);
  font-size: var(--step--2);
  font-weight: 650;
}

.welcome__panel > h1 + * {
  margin-top: var(--space-2);
}

.welcome__required + * {
  margin-top: var(--space-4);
}

.welcome__error {
  color: var(--rose-400);
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
