<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router';
import { api, LABELS } from '../api.js';
import { currentUser, sessionReady, setCurrentUser, signOut } from '../auth.js';
import AvatarPicker from '../components/AvatarPicker.vue';
import PreferenceEditor from '../components/PreferenceEditor.vue';
import { myPreferences, loadMyPreferences, saveMyPreferences } from '../groupPreferences.js';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import ProfileNotifications from '../components/ProfileNotifications.vue';
import VibeChart from '../components/VibeChart.vue';
import SaveBadge from '../components/SaveBadge.vue';

const avatarBusy = ref(false);
const avatarError = ref('');
let alive = true, accountVersion = 0;
const operationContext = () => ({ userId: currentUser.value?.id, version: accountVersion });
const isCurrent = ({ userId, version }) => alive && version === accountVersion && currentUser.value?.id === userId;

const router = useRouter();
const route = useRoute();
const settingUp = computed(() => route.query.setup === '1');
const setupNext = computed(() => {
  const target = route.query.next;
  return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')
    ? target : '/concerts';
});
const signingOut = ref(false);
const signOutError = ref('');

async function logOut() {
  signingOut.value = true;
  signOutError.value = '';
  try {
    await signOut();
    await router.push('/');
  } catch {
    signOutError.value = 'Could not log out. Please try again.';
  } finally {
    signingOut.value = false;
  }
}

/** Applies immediately; the header picture updates with it. */
async function applyAvatar(dataUrl) {
  if (avatarBusy.value) return;
  const context = operationContext();
  avatarBusy.value = true;
  avatarError.value = '';
  try {
    const { user } = await api.setAvatar(dataUrl);
    if (!isCurrent(context)) return;
    setCurrentUser({ ...currentUser.value, avatarUrl: user.avatarUrl });
  } catch (err) {
    if (!isCurrent(context)) return;
    avatarError.value = err.message === 'invalid_image'
      ? 'That file is not a readable image.'
      : 'Could not save the picture. Please try again.';
  } finally {
    if (isCurrent(context)) avatarBusy.value = false;
  }
}

async function removeAvatar() {
  if (avatarBusy.value) return;
  const context = operationContext();
  avatarBusy.value = true;
  avatarError.value = '';
  try {
    const { user } = await api.clearAvatar();
    if (!isCurrent(context)) return;
    setCurrentUser({ ...currentUser.value, avatarUrl: user.avatarUrl });
  } catch {
    if (!isCurrent(context)) return;
    avatarError.value = 'Could not remove the picture. Please try again.';
  } finally {
    if (isCurrent(context)) avatarBusy.value = false;
  }
}

/* ---- The questionnaire --------------------------------------------------
 * One set of answers for the whole site: group suggestions read them, and so
 * does companion ranking. It lives here because it belongs to the account
 * rather than to either feature, and because a page that asks for it twice
 * invites two different answers.
 */
const prefSaving = ref(false);
const prefLoading = ref(true);
const prefNotice = ref('');
const prefError = ref('');
const prefEditing = ref(false);
const setupContinueFailed = ref(false);
const showPreferenceEditor = computed(() => settingUp.value || !myPreferences.value || prefEditing.value);
async function continueAfterSetup() {
  const context = operationContext();
  try {
    const navigation = await router.replace(setupNext.value);
    if (isNavigationFailure(navigation, NavigationFailureType.aborted | NavigationFailureType.cancelled)) throw new Error('navigation_failed');
    if (isCurrent(context)) setupContinueFailed.value = false;
  } catch {
    if (!isCurrent(context)) return;
    setupContinueFailed.value = true;
    prefError.value = prefNotice.value ? 'Your answers are saved, but the next page could not open. Try continuing again.' : 'The next page could not open. Please try again.';
  }
}

// The server says which rule an answer broke; repeating that beats "try again",
// which cannot succeed until the answer changes.
const savePreferencesMessages = {
  choose_at_least_one_preference: 'Answer at least one sentence or choose one preference before saving.',
  invalid_preference_text: 'Each preference must be 1–100 characters. Shorten any long entries and save again.',
  invalid_preferences: 'Each section can hold at most 30 preferences. Remove a few and save again.',
  too_many_dealbreakers: 'You can mark at most 3 dealbreakers.',
  dealbreaker_not_in_avoid: 'A dealbreaker must also be listed under "What I prefer to avoid".',
  unknown_concept: 'One of your choices is no longer offered. Reload the page and pick again.',
  unknown_quiz_card: 'The sentences changed since this page loaded. Reload the page and answer again.',
  unknown_quiz_option: 'The sentences changed since this page loaded. Reload the page and answer again.',
};

async function savePreferences(answers) {
  if (prefSaving.value) return;
  const context = operationContext();
  prefSaving.value = true;
  prefError.value = '';
  prefNotice.value = '';
  try {
    await saveMyPreferences(answers);
    if (!isCurrent(context)) return;
    prefNotice.value = 'Saved. Groups and companion matching now use these.';
    prefEditing.value = false;
    if (settingUp.value) await continueAfterSetup();
  } catch (e) {
    if (!isCurrent(context)) return;
    prefError.value = savePreferencesMessages[e?.message] ?? 'Could not save your answers. Please try again.';
  } finally {
    if (isCurrent(context)) prefSaving.value = false;
  }
}

const ageBands = ['18-20', '21-24', '25-29', '30-34', '35+'];
const regions = { north: 'North', north_east: 'North East', east: 'East', west: 'West', central: 'Central' };
const genders = { f: 'Female', m: 'Male', nb: 'Non-binary', unspecified: 'Prefer not to say' };
const companionPreferences = { any: 'Any gender', male: 'Male', female: 'Female' };
const languages = { en: 'English', zh: 'Chinese', ms: 'Malay', ta: 'Tamil' };

const profile = ref(null);
const form = ref(null);
const loading = ref(true);
const saving = ref(false);
const loadError = ref(null);
const saveError = ref('');
const sessionExpired = ref(false);
let profileRequest = 0;

function fillForm(value) {
  form.value = {
    displayName: value.displayName,
    ageBand: value.ageBand,
    homeRegion: value.homeRegion,
    gender: value.gender,
    companionGenderPref: value.companionGenderPref,
    languages: [...value.languages],
    vibe: Object.fromEntries(Object.keys(LABELS.vibe).map((axis) => [axis, value.vibe?.[axis] ?? 0])),
  };
}

async function loadProfile() {
  const requestId = ++profileRequest;
  const context = operationContext();
  loading.value = true;
  loadError.value = null;
  try {
    const response = await api.profile();
    if (requestId !== profileRequest || !isCurrent(context)) return;
    profile.value = response.profile;
    fillForm(response.profile);
  } catch (error) {
    if (requestId === profileRequest && isCurrent(context)) loadError.value = error;
  } finally {
    if (requestId === profileRequest && isCurrent(context)) loading.value = false;
  }
}

/* ---- Autosave -------------------------------------------------------------
 * Details and vibe sliders save on their own a moment after the last change,
 * so a slider drag or a burst of typing becomes one request. Edits made while
 * a save is in flight are kept and sent right after it.
 */
const AUTOSAVE_DELAY_MS = 700;
const snapshot = (value) => JSON.stringify({ ...value, displayName: value.displayName.trim() });
let lastSaved = '';
let autosaveTimer = null;
const SAVED_VISIBLE_MS = 2000;

// Each autosaving card shows its own badge: '' (hidden), 'saving' or 'saved'.
// Only the cards whose fields changed light up; errors show in one card.
const cardStatus = reactive({ about: '', vibe: '' });
const errorCard = ref('');
const fades = {};
const cardsOf = (saved) => { const { vibe, ...about } = JSON.parse(saved); return { about: JSON.stringify(about), vibe: JSON.stringify(vibe) }; };
const changedCards = (from, to) => { const a = cardsOf(from), b = cardsOf(to); return Object.keys(a).filter((card) => a[card] !== b[card]); };
function markCards(cards, state) {
  for (const card of cards) {
    clearTimeout(fades[card]);
    cardStatus[card] = state;
    if (state === 'saved') fades[card] = setTimeout(() => { cardStatus[card] = ''; }, SAVED_VISIBLE_MS);
  }
}

watch([() => currentUser.value?.id, sessionReady], ([userId, ready], _previous, onCleanup) => {
  let stale = false;
  onCleanup(() => { stale = true; profileRequest++; accountVersion++; });
  clearTimeout(autosaveTimer); autosaveTimer = null;
  Object.values(fades).forEach(clearTimeout);
  lastSaved = ''; cardStatus.about = ''; cardStatus.vibe = '';
  saving.value = false; avatarBusy.value = false; avatarError.value = '';
  saveError.value = ''; sessionExpired.value = false;
  prefSaving.value = false; prefNotice.value = ''; prefError.value = ''; prefEditing.value = false; setupContinueFailed.value = false;
  profile.value = null; form.value = null;
  if (!ready) return;
  prefLoading.value = true;
  loadProfile();
  if (!userId) { prefLoading.value = false; return; }
  loadMyPreferences()
    .catch(() => { if (!stale) prefError.value = 'Could not load your answers.'; })
    .finally(() => { if (!stale) prefLoading.value = false; });
}, { immediate: true });

watch(form, (value, previous) => {
  if (!value) return;
  // A fresh load (or a new account) is the saved state, not an edit.
  if (!previous || previous !== value) { lastSaved = snapshot(value); return; }
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(save, AUTOSAVE_DELAY_MS);
}, { deep: true });

function flushAutosave() {
  if (!autosaveTimer) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  void save();
}
onBeforeUnmount(() => { Object.values(fades).forEach(clearTimeout); flushAutosave(); alive = false; accountVersion++; profileRequest++; });

async function save() {
  autosaveTimer = null;
  if (saving.value || !form.value) return;
  const context = operationContext();
  sessionExpired.value = false;
  if (!form.value.displayName.trim()) {
    errorCard.value = 'about';
    saveError.value = 'Enter a display name. Your last saved name is kept.';
    return;
  }
  if (!form.value.languages.length) {
    errorCard.value = 'about';
    saveError.value = 'Choose at least one language. Your last saved languages are kept.';
    return;
  }
  const sending = snapshot(form.value);
  if (sending === lastSaved) { saveError.value = ''; return; }
  const cards = changedCards(lastSaved, sending);
  saveError.value = '';
  saving.value = true;
  markCards(cards, 'saving');
  try {
    const { profile: updated } = await api.updateProfile(JSON.parse(sending));
    if (!isCurrent(context)) return;
    profile.value = updated;
    lastSaved = sending;
    // Update the header name in place. Re-checking the whole session here
    // briefly un-readies it, which reloads this page and jumps to the top.
    if (currentUser.value) setCurrentUser({ ...currentUser.value, displayName: updated.displayName });
    markCards(cards, 'saved');
  } catch (error) {
    if (!isCurrent(context)) return;
    markCards(cards, '');
    errorCard.value = cards[0] ?? 'about';
    sessionExpired.value = error.status === 401;
    saveError.value = sessionExpired.value
      ? 'Your session has expired. Sign in again to edit your profile.'
      : 'Could not save your changes. They will be retried with your next edit.';
  } finally {
    if (!isCurrent(context)) return;
    saving.value = false;
    // Anything changed during the request goes out now.
    if (form.value && !sessionExpired.value && snapshot(form.value) !== lastSaved && !saveError.value) void save();
  }
}
</script>

<template>
  <div class="profile container section">
    <header class="profile__head page-banner">
      <h1>{{ settingUp ? 'Make it feel like you' : 'Profile' }}</h1>
      <p>{{ settingUp ? 'Your account is ready. Add a few private matching preferences, or explore first.' : 'Manage your profile, concert preferences and notifications.' }}</p>
    </header>

    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading your profile…</p>
    <div v-else-if="loadError" class="profile__notice" role="alert">
      <p>{{ loadError.status === 401 ? 'Sign in to see your profile.' : 'Could not load your profile. Please try again.' }}</p>
      <RouterLink v-if="loadError.status === 401" to="/login" class="btn btn--primary">Sign in</RouterLink>
      <button v-else class="btn btn--ghost" type="button" @click="loadProfile">Retry</button>
    </div>
    <div v-else-if="form" class="profile__form">
      <template v-if="!settingUp">
      <!-- Outside the save flow on purpose: a picture applies the moment it is
           chosen, so nobody picks one, forgets to press Save, and loses it. -->
      <section class="profile__card" aria-labelledby="profile-picture">
        <h2 id="profile-picture">Profile picture</h2>
        <AvatarPicker
          :src="currentUser?.avatarUrl"
          :name="currentUser?.displayName"
          :busy="avatarBusy"
          @select="applyAvatar"
          @remove="removeAvatar"
        />
        <p v-if="avatarError" class="profile__error" role="alert">{{ avatarError }}</p>
      </section>

      <section class="profile__card" aria-labelledby="profile-about">
        <div class="profile__card-head"><h2 id="profile-about">About you</h2><SaveBadge :state="cardStatus.about" /></div>
        <p v-if="saveError && errorCard === 'about'" class="profile__error" role="alert">{{ saveError }} <RouterLink v-if="sessionExpired" to="/login">Sign in</RouterLink></p>
        <div class="profile__fields">
          <label class="profile__field">
            Display name
            <input v-model="form.displayName" type="text" autocomplete="nickname" required />
          </label>
          <label class="profile__field">
            <span>Email <span class="profile__hint">Only visible to you.</span></span>
            <input :value="profile.email" type="email" readonly />
          </label>
          <label class="profile__field">
            Age range
            <select v-model="form.ageBand" required>
              <option v-for="band in ageBands" :key="band" :value="band">{{ band }}</option>
            </select>
          </label>
          <label class="profile__field">
            Home region
            <select v-model="form.homeRegion" required>
              <option v-for="(label, value) in regions" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label class="profile__field">
            Gender
            <select v-model="form.gender" required>
              <option v-for="(label, value) in genders" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label class="profile__field">
            Companion preference
            <select v-model="form.companionGenderPref" required>
              <option v-for="(label, value) in companionPreferences" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
        </div>
        <fieldset class="profile__choices">
          <legend>Languages you speak</legend>
          <label v-for="(label, value) in languages" :key="value">
            <input v-model="form.languages" type="checkbox" :value="value" /> {{ label }}
          </label>
        </fieldset>
      </section>
      <p class="profile__hint">
        Reliability {{ Math.round(profile.reliability * 100) }}%
      </p>
      </template>

      <!-- The site's one questionnaire. Groups and companion ranking both
           read these answers, which is why it is here and not in either. -->
      <section id="preferences" class="profile__card profile__card--private" :class="{ 'next-step': !settingUp && myPreferences === null }" aria-labelledby="profile-preferences">
        <div class="profile__preference-heading">
          <div><p class="profile__private-label">Private · Only you can see your answers</p><h2 id="profile-preferences">{{ settingUp ? 'A few answers. A better fit.' : 'Your matching preferences' }}</h2></div>
          <button v-if="!settingUp && myPreferences" type="button" class="btn btn--ghost" :aria-expanded="prefEditing" @click="prefEditing = !prefEditing">{{ prefEditing ? 'Close editor' : 'Edit private preferences' }}</button>
        </div>
        <ul class="profile__points">
          <li><strong>Used for</strong> companion suggestions and group recommendations.</li>
          <li><strong>Private:</strong> others only see how well you match, never your answers.</li>
        </ul>
        <p v-if="prefNotice" class="profile__success" role="status">{{ prefNotice }}</p>
        <p v-if="prefError" class="profile__error" role="alert">{{ prefError }}</p>
        <!-- Mounted only once the saved answers are in hand. The editor reads
             `initial` when it is created, so rendering it while they are still
             loading showed an empty questionnaire to someone who had already
             answered — and saving from there would have replaced their answers
             with nothing. -->
        <p v-if="prefLoading" class="loading-state" role="status"><LoadingSpinner />Loading your answers…</p>
        <PreferenceEditor
          v-if="!prefLoading && myPreferences !== undefined && showPreferenceEditor"
          :initial="myPreferences ?? undefined"
          :busy="prefSaving"
          :saving="prefSaving"
          require-one
          :submit-label="settingUp ? 'Save and continue' : 'Save answers'"
          @save="savePreferences"
        />
        <div v-if="settingUp" class="profile__setup-footer">
          <p class="profile__hint">Automatic matching needs saved preferences. You can return here before switching it on.</p>
          <button type="button" class="btn btn--ghost" :disabled="prefSaving" @click="continueAfterSetup">Skip for now</button>
          <button v-if="setupContinueFailed && prefNotice" type="button" class="btn btn--primary" :disabled="prefSaving" @click="continueAfterSetup">Continue with saved answers</button>
        </div>
      </section>

      <template v-if="!settingUp">
      <section id="your-vibe" class="profile__card profile__card--public" aria-labelledby="profile-vibe">
        <p class="profile__public-label">Public · Visible to other members</p>
        <div class="profile__card-head"><h2 id="profile-vibe">Your concert vibe</h2><SaveBadge :state="cardStatus.vibe" /></div>
        <p v-if="saveError && errorCard === 'vibe'" class="profile__error" role="alert">{{ saveError }} <RouterLink v-if="sessionExpired" to="/login">Sign in</RouterLink></p>
        <p class="profile__hint">These six interests appear on your public concert profile. Your matching questionnaire stays private.</p>
        <div class="profile__vibe-layout">
          <div class="profile__vibe-preview">
            <VibeChart :vibe="form.vibe" :size="220" />
            <RouterLink :to="`/people/${encodeURIComponent(profile.id)}`">View your public profile</RouterLink>
          </div>
          <div class="profile__vibes">
            <p class="profile__hint">0 = not for me · 4 = love it</p>
            <label v-for="(label, axis) in LABELS.vibe" :key="axis" class="profile__vibe">
              <span>{{ label }}</span>
              <input v-model.number="form.vibe[axis]" :style="{ '--vibe-fill': `${form.vibe[axis] / 4 * 100}%` }" type="range" min="0" max="4" step="1" :aria-valuetext="`${form.vibe[axis]} out of 4`" />
              <output>{{ form.vibe[axis] }}</output>
            </label>
          </div>
        </div>
      </section>

      <ProfileNotifications v-if="currentUser" class="profile__card" />
      </template>
    </div>

    <section v-if="currentUser && !settingUp" class="profile__card profile__logout" aria-labelledby="profile-logout">
      <div>
        <h2 id="profile-logout">Log out</h2>
        <p class="profile__hint">Signed in as {{ currentUser.email ?? currentUser.displayName }}.</p>
      </div>
      <button type="button" class="btn btn--danger-ghost" :disabled="signingOut" @click="logOut">
        <LoadingSpinner v-if="signingOut" />
        {{ signingOut ? 'Logging out…' : 'Log out' }}
      </button>
      <p v-if="signOutError" class="profile__error" role="alert">{{ signOutError }}</p>
    </section>
  </div>
</template>

<style scoped>
.profile {
  max-width: 860px;
  padding-bottom: var(--space-9);
}
.profile__head {
  margin-bottom: var(--space-6);
}
.profile__head h1 {
  margin-block: var(--space-2);
}
.profile__hint {
  color: var(--text-400);
  font-size: var(--step--1);
}
.profile__preference-heading { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:var(--space-3); }
.profile__private-label { margin:0 0 var(--space-2); color:var(--accent-400); font:600 0.68rem var(--font-mono); text-transform:uppercase; letter-spacing:.08em; }
.profile__points { display:grid; gap:var(--space-1); margin:var(--space-2) 0 var(--space-3); padding-left:1.2em; color:var(--text-300); font-size:var(--step--1); }
.profile__setup-footer { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:var(--space-3); padding-top:var(--space-4); margin-top:var(--space-4); border-top:var(--border-soft); }
.profile__setup-footer p { max-width:54ch; }
.profile__form {
  display: grid;
  gap: var(--space-5);
}
.profile__card {
  padding: var(--space-5);
  border: var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
  scroll-margin-top: calc(var(--header-height) + var(--space-4));
}
.profile__card--private { border-left:3px solid var(--ink-500); }
.profile__card--private:has(.preference-editor) { border-left-color:var(--accent-400); }
.profile__card--public { border-color:color-mix(in oklab, var(--accent-400) 34%, var(--panel-edge)); background:linear-gradient(125deg, color-mix(in oklab, var(--accent-500) 4%, var(--panel-bg)), var(--panel-bg)); }
.profile__public-label { margin:0 0 var(--space-2); font:600 0.68rem var(--font-mono); letter-spacing:.08em; text-transform:uppercase; color:var(--accent-400); }
.profile__card--private :deep(.preference-editor) { margin-top:var(--space-5); padding-top:var(--space-4); border-top:var(--border-hairline); }
.profile__card h2 {
  margin-bottom: var(--space-4);
  font-size: var(--step-1);
}
.profile__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}
.profile__field {
  display: grid;
  min-width: 0;
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
}
.profile__field input {
  width: 100%;
  min-width: 0;
  padding: var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--field-bg);
  color: var(--text-100);
}
.profile__field input[readonly] {
  opacity: .7;
}
.profile__choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-5);
  margin-top: var(--space-5);
  padding: 0;
  border: 0;
}
.profile__choices legend {
  margin-bottom: var(--space-3);
  color: var(--text-300);
  font-size: var(--step--1);
}
.profile__choices label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.profile__vibes {
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-5);
}
.profile__vibe-layout { display:grid; grid-template-columns:minmax(200px, 280px) minmax(0, 1fr); gap:var(--space-6); align-items:center; }
.profile__vibe-preview { display:grid; justify-items:center; gap:var(--space-3); text-align:center; padding:var(--space-5) var(--space-3); border:var(--border-hairline); border-radius:var(--radius-lg); background:radial-gradient(ellipse at 50% 25%, color-mix(in oklab, var(--accent-400) 7%, transparent), transparent 72%), var(--ink-900); box-shadow:inset 0 2px 8px color-mix(in oklab, var(--accent-600) 5%, transparent); }
.profile__vibe-preview > .profile__hint { max-width:28ch; font-size:var(--step--2); }
@media (max-width:800px) { .profile__vibe-layout { grid-template-columns:1fr; } }
.profile__vibe {
  display: grid;
  grid-template-columns: minmax(6rem, 1fr) minmax(7rem, 1.8fr) 2.25rem;
  align-items: center;
  gap: var(--space-3);
}
.profile__vibe input {
  width: 100%;
  min-width: 0;
  height: 36px;
  margin: 0;
  padding: 0;
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: var(--radius-pill);
  cursor: grab;
  accent-color: var(--accent-500);
}
.profile__vibe input:active { cursor:grabbing; }
.profile__vibe input:focus-visible { outline:2px solid var(--accent-400); outline-offset:4px; }
.profile__vibe input::-webkit-slider-runnable-track { height:6px; border-radius:var(--radius-pill); background:linear-gradient(to right,var(--accent-400) var(--vibe-fill),var(--ink-600) var(--vibe-fill)); box-shadow:inset 0 1px 2px color-mix(in oklab,var(--accent-600) 14%,transparent); }
.profile__vibe input::-moz-range-track { height:6px; border-radius:var(--radius-pill); background:var(--ink-600); box-shadow:inset 0 1px 2px color-mix(in oklab,var(--accent-600) 14%,transparent); }
.profile__vibe input::-moz-range-progress { height:6px; border-radius:var(--radius-pill); background:var(--accent-400); }
.profile__vibe input::-webkit-slider-thumb { appearance:none; width:22px; height:22px; margin-top:-8px; border:3px solid var(--panel-bg); border-radius:50%; background:var(--accent-400); box-shadow:0 0 0 1px var(--accent-400),0 2px 5px color-mix(in oklab,var(--accent-600) 22%,transparent); transition:transform var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast); }
.profile__vibe input::-moz-range-thumb { width:16px; height:16px; border:3px solid var(--panel-bg); border-radius:50%; background:var(--accent-400); box-shadow:0 0 0 1px var(--accent-400),0 2px 5px color-mix(in oklab,var(--accent-600) 22%,transparent); transition:transform var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast); }
.profile__vibe input:active::-webkit-slider-thumb { transform:scale(1.13); box-shadow:0 0 0 6px var(--focus-halo); }
.profile__vibe input:active::-moz-range-thumb { transform:scale(1.13); box-shadow:0 0 0 6px var(--focus-halo); }
.profile__vibe:focus-within > span { color:var(--accent-400); }
.profile__vibe output {
  font-variant-numeric: tabular-nums;
  display:grid;
  place-items:center;
  min-height:30px;
  border:var(--border-hairline);
  border-radius:var(--radius-sm);
  background:var(--ink-900);
  color:var(--accent-400);
  font-family:var(--font-mono);
  font-size:var(--step--1);
}
.profile__error {
  color: var(--rose-400);
}
.profile__success {
  color: var(--mint-400);
}
.profile__notice {
  display: grid;
  justify-items: start;
  gap: var(--space-3);
}
/* Card title with its autosave badge on the right. */
.profile__card-head {
  position: relative;
  padding-right: 6.5rem;
  margin-bottom: var(--space-4);
}
.profile__card-head h2 {
  margin: 0;
}
.profile__logout {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3) var(--space-5);
  margin-top: var(--space-6);
}
.profile__logout h2 {
  margin-bottom: var(--space-1);
}
.profile__logout .profile__error {
  flex-basis: 100%;
}
@media (max-width: 600px) {
  .profile__fields {
    grid-template-columns: 1fr;
  }
  .profile__card {
    padding: var(--space-4);
  }
  .profile__vibe {
    grid-template-columns: minmax(0, 1fr) 2.25rem;
  }
  .profile__vibe input {
    grid-row: 2;
    grid-column: 1 / -1;
  }
  .profile__vibe output {
    grid-column: 2;
    grid-row: 1;
  }
}
@media (prefers-reduced-motion:reduce) {
  .profile__vibe input::-webkit-slider-thumb { transition:none; }
  .profile__vibe input::-moz-range-thumb { transition:none; }
  .profile__vibe input:active::-webkit-slider-thumb { transform:none; }
  .profile__vibe input:active::-moz-range-thumb { transform:none; }
}
</style>
