<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PreferenceEditor from '../components/PreferenceEditor.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import VibeChart from '../components/VibeChart.vue';
import { api, LABELS } from '../api.js';
import { currentUser, setCurrentUser } from '../auth.js';
import { myPreferences, loadMyPreferences, saveMyPreferences } from '../groupPreferences.js';
import { VIBE_AXES, vibeComplete } from '../vibe.js';

/**
 * First stop after creating an account: "About you" (age, area, gender,
 * languages), then matching preferences, then the six concert-vibe ratings.
 * All three are required before the rest of Encore opens (see routeGuards.js),
 * so there is no skip. The display name was already given at sign-up. Afterwards it reminds the new member
 * that Profile is where they can change them later.
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
// 'about' → About you; 'editing' → questionnaire; 'vibe' → concert vibe sliders; 'saved' → the closing note.
const step = ref('editing');
const needsAbout = () => currentUser.value?.aboutComplete === false;

const ageBands = ['18-20', '21-24', '25-29', '30-34', '35+'];
const regions = { north: 'North', north_east: 'North East', east: 'East', west: 'West', central: 'Central' };
const genders = { f: 'Female', m: 'Male', nb: 'Non-binary', unspecified: 'Prefer not to say' };
const companionPreferences = { any: 'Any gender', male: 'Male', female: 'Female' };
const languageNames = { en: 'English', zh: 'Chinese', ms: 'Malay', ta: 'Tamil' };
// Every field starts empty, so the answers are the member's own choices.
const about = reactive({ ageBand: '', homeRegion: '', gender: '', companionGenderPref: '', languages: [] });
const languagesError = ref('');
/** The first step this member has not finished yet. */
const nextStep = () => needsAbout() ? 'about' : !myPreferences.value ? 'editing' : needsVibe() ? 'vibe' : 'saved';
const needsVibe = () => !vibeComplete(currentUser.value?.vibe);
// Sliders start in the middle (or at any ratings already saved).
const vibe = reactive(Object.fromEntries(VIBE_AXES.map(axis => {
  const saved = currentUser.value?.vibe?.[axis];
  return [axis, Number.isInteger(saved) ? saved : 2];
})));

onMounted(async () => {
  try {
    await loadMyPreferences();
  } catch {
    // The editor still works with empty answers; saving reports its own errors.
    myPreferences.value = null;
  } finally {
    loading.value = false;
  }
  // Start at the first step this member has not done yet.
  step.value = nextStep();
});

// Preferences save as they change; Next on the last tab moves on once the
// latest save has landed.
const prefState = ref('');
let prefSave = Promise.resolve();
function autosavePreferences(answers) {
  prefState.value = 'saving';
  error.value = '';
  prefSave = saveMyPreferences(answers)
    .then(() => { prefState.value = 'saved'; })
    .catch(() => { prefState.value = 'error'; });
}
async function preferencesDone() {
  await prefSave;
  if (prefState.value === 'error') {
    error.value = 'Could not save your answers. Please try again.';
    return;
  }
  step.value = nextStep();
}

async function saveAbout() {
  languagesError.value = about.languages.length ? '' : 'Choose at least one language.';
  if (languagesError.value) return;
  saving.value = true;
  error.value = '';
  try {
    const details = { ...about, languages: [...about.languages] };
    await api.updateProfile(details);
    setCurrentUser({ ...currentUser.value, ...details, aboutComplete: true });
    step.value = nextStep();
  } catch {
    error.value = 'Could not save your details. Please try again.';
  } finally {
    saving.value = false;
  }
}

async function saveVibe() {
  saving.value = true;
  error.value = '';
  try {
    const ratings = { ...vibe };
    await api.updateProfile({ vibe: ratings });
    setCurrentUser({ ...currentUser.value, vibe: ratings });
    step.value = 'saved';
  } catch {
    error.value = 'Could not save your concert vibe. Please try again.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="welcome container container--wide">
    <section v-if="loading" class="welcome__panel welcome__form"><p class="loading-state" role="status"><LoadingSpinner /> Loading…</p></section>

    <section v-else-if="step === 'about'" class="welcome__panel welcome__form" aria-labelledby="welcome-about">
      <p class="welcome__private">Step 1 of 3</p>
      <h1 id="welcome-about">About you</h1>
      <p class="welcome__required">A few details so we can suggest the right companions and groups. You can change them anytime in Profile.</p>
      <p v-if="error" class="welcome__error" role="alert">{{ error }}</p>
      <form class="welcome__about" @submit.prevent="saveAbout">
        <label class="welcome__field">Age range
          <select v-model="about.ageBand" required :disabled="saving"><option value="" disabled>Choose…</option><option v-for="band in ageBands" :key="band" :value="band">{{ band }}</option></select>
        </label>
        <label class="welcome__field">Home region
          <select v-model="about.homeRegion" required :disabled="saving"><option value="" disabled>Choose…</option><option v-for="(label, value) in regions" :key="value" :value="value">{{ label }}</option></select>
        </label>
        <label class="welcome__field">Gender
          <select v-model="about.gender" required :disabled="saving"><option value="" disabled>Choose…</option><option v-for="(label, value) in genders" :key="value" :value="value">{{ label }}</option></select>
        </label>
        <label class="welcome__field">Companion preference
          <select v-model="about.companionGenderPref" required :disabled="saving"><option value="" disabled>Choose…</option><option v-for="(label, value) in companionPreferences" :key="value" :value="value">{{ label }}</option></select>
        </label>
        <fieldset class="welcome__languages">
          <legend>Languages you speak</legend>
          <label v-for="(label, value) in languageNames" :key="value"><input v-model="about.languages" type="checkbox" :value="value" :disabled="saving" @change="languagesError = ''" /> {{ label }}</label>
          <p v-if="languagesError" class="field-error" role="alert">{{ languagesError }}</p>
        </fieldset>
        <button class="btn btn--primary welcome__about-save" :disabled="saving"><LoadingSpinner v-if="saving" />{{ saving ? 'Saving…' : 'Continue' }}</button>
      </form>
    </section>

    <section v-else-if="step === 'editing'" class="welcome__panel welcome__form" aria-labelledby="welcome-form">
      <p class="welcome__private">Private · Only you can see your answers</p>
      <h1 id="welcome-form">Your matching preferences</h1>
      <p class="welcome__required">Pick at least one thing to start using Encore. Your answers save as you go, and you can change them anytime.</p>
      <p v-if="error" class="welcome__error" role="alert">{{ error }}</p>
      <PreferenceEditor
        :initial="myPreferences ?? undefined"
        autosave
        :save-state="prefState"
        require-one
        done-label="Next: your concert vibe"
        @save="autosavePreferences"
        @done="preferencesDone"
      />
    </section>

    <section v-else-if="step === 'vibe'" class="welcome__panel welcome__form" aria-labelledby="welcome-vibe">
      <p class="welcome__private">Public · Shown on your profile and companion card</p>
      <h1 id="welcome-vibe">Your concert vibe</h1>
      <p class="welcome__required">One last step: how do you like to enjoy a concert? Rate each from 0 to 4. You can change these anytime.</p>
      <p v-if="error" class="welcome__error" role="alert">{{ error }}</p>
      <form class="welcome__vibe" @submit.prevent="saveVibe">
        <div class="welcome__vibe-chart"><VibeChart :vibe="vibe" :size="200" /></div>
        <div class="welcome__vibe-sliders">
          <label v-for="axis in VIBE_AXES" :key="axis" class="welcome__slider">
            <span>{{ LABELS.vibe[axis] }}</span>
            <input v-model.number="vibe[axis]" type="range" min="0" max="4" step="1" :disabled="saving"
              :style="{ '--vibe-fill': `${vibe[axis] / 4 * 100}%` }" :aria-valuetext="`${vibe[axis]} out of 4`" />
            <output>{{ vibe[axis] }}</output>
          </label>
          <button class="btn btn--primary welcome__vibe-save" :disabled="saving">
            <LoadingSpinner v-if="saving" />{{ saving ? 'Saving…' : 'Save my vibe' }}
          </button>
        </div>
      </form>
    </section>

    <section v-else class="welcome__panel welcome__done" role="status" aria-labelledby="welcome-done">
      <h1 id="welcome-done">You're all set</h1>
      <p>Companion suggestions and group recommendations will now use your preferences and concert vibe.</p>
      <p class="welcome__reminder">
        You can change your preferences and vibe anytime on your
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


/* About you step: four choices in a two-column grid, then languages. */
.welcome__about { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:var(--space-4); }
.welcome__field { display:grid; gap:var(--space-2); color:var(--text-200); font-size:var(--step--1); font-weight:600; }
.welcome__field select { width:100%; min-height:44px; padding:var(--space-2) var(--space-3); border:var(--border-soft); border-radius:var(--radius-md); background:var(--field-bg); color:var(--text-100); font:inherit; font-weight:400; }
.welcome__languages { grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:var(--space-2) var(--space-5); margin:0; padding:0; border:0; }
.welcome__languages legend { margin-bottom:var(--space-2); color:var(--text-200); font-size:var(--step--1); font-weight:600; }
.welcome__languages label { display:inline-flex; align-items:center; gap:var(--space-2); color:var(--text-200); font-size:var(--step--1); cursor:pointer; }
.welcome__languages input { width:18px; height:18px; margin:0; accent-color:var(--accent-400); }
.welcome__languages .field-error { flex-basis:100%; }
.welcome__about-save { grid-column:1 / -1; justify-self:start; }
@media (max-width: 640px) { .welcome__about { grid-template-columns:1fr; } }

/* Concert vibe step: the chart beside six 0–4 sliders. */
.welcome__vibe { display:grid; grid-template-columns:minmax(180px, 240px) minmax(0, 1fr); gap:var(--space-6); align-items:center; }
.welcome__vibe-chart { display:grid; place-items:center; }
.welcome__vibe-sliders { display:grid; gap:var(--space-4); }
.welcome__slider { display:grid; grid-template-columns:minmax(8rem, 10rem) minmax(0, 1fr) 1.5rem; align-items:center; gap:var(--space-3); color:var(--text-200); font-size:var(--step--1); }
.welcome__slider output { color:var(--text-100); font-weight:650; text-align:right; }
.welcome__slider input { width:100%; accent-color:var(--accent-400); cursor:pointer; }
.welcome__vibe-save { justify-self:start; margin-top:var(--space-2); }
@media (max-width: 640px) {
  .welcome__vibe { grid-template-columns:1fr; }
  .welcome__slider { grid-template-columns:1fr auto; }
  .welcome__slider input { grid-column:1 / -1; grid-row:2; }
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
