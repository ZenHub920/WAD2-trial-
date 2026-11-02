<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS } from '../api.js';
import { currentUser, sessionReady, refreshSession, setCurrentUser, signOut } from '../auth.js';
import AvatarPicker from '../components/AvatarPicker.vue';
import PreferenceEditor from '../components/PreferenceEditor.vue';
import { myPreferences, loadMyPreferences, saveMyPreferences } from '../groupPreferences.js';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import ProfileNotifications from '../components/ProfileNotifications.vue';
import VibeChart from '../components/VibeChart.vue';

const avatarBusy = ref(false);
const avatarError = ref('');

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
  avatarBusy.value = true;
  avatarError.value = '';
  try {
    const { user } = await api.setAvatar(dataUrl);
    setCurrentUser({ ...currentUser.value, ...user });
  } catch (err) {
    avatarError.value = err.message === 'invalid_image'
      ? 'That file is not a readable image.'
      : 'Could not save the picture. Please try again.';
  } finally {
    avatarBusy.value = false;
  }
}

async function removeAvatar() {
  avatarBusy.value = true;
  avatarError.value = '';
  try {
    const { user } = await api.clearAvatar();
    setCurrentUser({ ...currentUser.value, ...user });
  } catch {
    avatarError.value = 'Could not remove the picture. Please try again.';
  } finally {
    avatarBusy.value = false;
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
const showPreferenceEditor = computed(() => settingUp.value || !myPreferences.value || prefEditing.value);
const continueAfterSetup = () => router.replace(setupNext.value);

async function savePreferences(answers) {
  prefSaving.value = true;
  prefError.value = '';
  prefNotice.value = '';
  try {
    await saveMyPreferences(answers);
    prefNotice.value = 'Saved. Groups and companion matching now use these.';
    prefEditing.value = false;
    if (settingUp.value) await continueAfterSetup();
  } catch {
    prefError.value = 'Could not save your answers. Please try again.';
  } finally {
    prefSaving.value = false;
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
const saved = ref(false);
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
  loading.value = true;
  loadError.value = null;
  try {
    const response = await api.profile();
    if (requestId !== profileRequest) return;
    profile.value = response.profile;
    fillForm(response.profile);
  } catch (error) {
    if (requestId === profileRequest) loadError.value = error;
  } finally {
    if (requestId === profileRequest) loading.value = false;
  }
}

watch([() => currentUser.value?.id, sessionReady], ([userId, ready], _previous, onCleanup) => {
  let stale = false;
  onCleanup(() => { stale = true; profileRequest++; });
  if (!ready) return;
  profile.value = null;
  form.value = null;
  prefLoading.value = true;
  prefError.value = '';
  loadProfile();
  if (!userId) { prefLoading.value = false; return; }
  loadMyPreferences()
    .catch(() => { if (!stale) prefError.value = 'Could not load your answers.'; })
    .finally(() => { if (!stale) prefLoading.value = false; });
}, { immediate: true });

async function save() {
  if (saving.value) return;
  saveError.value = '';
  sessionExpired.value = false;
  saved.value = false;
  if (!form.value.displayName.trim()) {
    saveError.value = 'Enter a display name.';
    return;
  }
  if (!form.value.languages.length) {
    saveError.value = 'Choose at least one language.';
    return;
  }
  saving.value = true;
  try {
    const { profile: updated } = await api.updateProfile({
      ...form.value,
      displayName: form.value.displayName.trim(),
    });
    profile.value = updated;
    fillForm(updated);
    await refreshSession();
    if (!currentUser.value) {
      sessionExpired.value = true;
      saveError.value = 'Your changes were saved, but your session expired. Sign in again.';
      return;
    }
    saved.value = true;
  } catch (error) {
    sessionExpired.value = error.status === 401;
    saveError.value = sessionExpired.value
      ? 'Your session has expired. Sign in again to edit your profile.'
      : 'Could not save your profile. Please try again.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="profile container section">
    <header class="profile__head page-banner">
      <h1>{{ settingUp ? 'Make it feel like you' : 'Profile' }}</h1>
      <p>{{ settingUp ? 'Your account is ready. Add a few private matching preferences, or explore first.' : 'Manage your profile, concert preferences and notifications.' }}</p>
      <RouterLink v-if="!settingUp" to="/account/security" class="btn btn--outline-light profile__security">Account security</RouterLink>
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
        <h2 id="profile-about">About you</h2>
        <div class="profile__fields">
          <label class="profile__field">
            Display name
            <input v-model="form.displayName" form="profile-form" type="text" autocomplete="nickname" required />
          </label>
          <label class="profile__field">
            <span>Email <span class="profile__hint">Only visible to you.</span></span>
            <input :value="profile.email" type="email" readonly />
          </label>
          <label class="profile__field">
            Age range
            <select v-model="form.ageBand" form="profile-form" required>
              <option v-for="band in ageBands" :key="band" :value="band">{{ band }}</option>
            </select>
          </label>
          <label class="profile__field">
            Home region
            <select v-model="form.homeRegion" form="profile-form" required>
              <option v-for="(label, value) in regions" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label class="profile__field">
            Gender
            <select v-model="form.gender" form="profile-form" required>
              <option v-for="(label, value) in genders" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label class="profile__field">
            Companion preference
            <select v-model="form.companionGenderPref" form="profile-form" required>
              <option v-for="(label, value) in companionPreferences" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
        </div>
        <fieldset class="profile__choices">
          <legend>Languages you speak</legend>
          <label v-for="(label, value) in languages" :key="value">
            <input v-model="form.languages" form="profile-form" type="checkbox" :value="value" /> {{ label }}
          </label>
        </fieldset>
      </section>
      <p class="profile__hint">
        {{ profile.verified ? 'Profile verified' : 'Profile not verified' }} · Reliability {{ Math.round(profile.reliability * 100) }}%
      </p>
      </template>

      <!-- The site's one questionnaire. Groups and companion ranking both
           read these answers, which is why it is here and not in either. -->
      <section id="preferences" class="profile__card" aria-labelledby="profile-preferences">
        <div class="profile__preference-heading">
          <div><p class="profile__private-label">Private · Only you can see your answers</p><h2 id="profile-preferences">{{ settingUp ? 'A few answers. A better fit.' : 'Your matching preferences' }}</h2></div>
          <button v-if="!settingUp && myPreferences" type="button" class="btn btn--ghost" :aria-expanded="prefEditing" @click="prefEditing = !prefEditing">{{ prefEditing ? 'Close editor' : 'Edit private preferences' }}</button>
        </div>
        <p class="profile__hint">
          Answer once for Kaki Finder and group recommendations. Your group combines every member's answers;
          nobody sees your individual checklist. You can edit these here anytime. Browsing and direct group requests work without completing this step.
        </p>
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
        </div>
      </section>

      <template v-if="!settingUp">
      <section id="your-vibe" class="profile__card" aria-labelledby="profile-vibe">
        <h2 id="profile-vibe">Your concert vibe</h2>
        <p class="profile__hint">These six interests appear on your public concert profile. Your matching questionnaire stays private.</p>
        <div class="profile__vibe-layout">
          <div class="profile__vibe-preview">
            <VibeChart :vibe="form.vibe" :size="220" />
            <RouterLink :to="`/people/${encodeURIComponent(profile.id)}`">View your public profile</RouterLink>
            <span class="profile__hint">Preview updates as you move the sliders. Save profile to share changes.</span>
          </div>
          <div class="profile__vibes">
            <p class="profile__hint">0 = not for me · 4 = love it</p>
            <label v-for="(label, axis) in LABELS.vibe" :key="axis" class="profile__vibe">
              <span>{{ label }}</span>
              <input v-model.number="form.vibe[axis]" form="profile-form" type="range" min="0" max="4" step="1" :aria-valuetext="`${form.vibe[axis]} out of 4`" />
              <output>{{ form.vibe[axis] }}</output>
            </label>
          </div>
        </div>
      </section>

      <!-- Sticks to the bottom of the screen while the form is in view, so Save
           is always one click away without scrolling back down. -->
      <form id="profile-form" class="profile__actions" @submit.prevent="save">
        <p v-if="saveError" class="profile__error" role="alert">{{ saveError }} <RouterLink v-if="sessionExpired" to="/login">Sign in</RouterLink></p>
        <p v-else-if="saved" class="profile__success" role="status">✓ Profile saved</p>
        <button type="submit" class="btn btn--primary profile__save" :disabled="saving">
          <LoadingSpinner v-if="saving" />
          {{ saving ? 'Saving…' : 'Save profile' }}
        </button>
      </form>
      </template>
    </div>
    <ProfileNotifications v-if="currentUser && !settingUp" />

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
.profile__security {
  margin-top: var(--space-5);
}
.profile__hint {
  color: var(--text-400);
  font-size: var(--step--1);
}
.profile__preference-heading { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:var(--space-3); }
.profile__private-label { margin:0 0 var(--space-2); color:var(--accent-400); font:600 0.68rem var(--font-mono); text-transform:uppercase; letter-spacing:.08em; }
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
  background: var(--ink-850);
}
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
.profile__vibe-preview { display:grid; justify-items:center; gap:var(--space-3); text-align:center; }
.profile__vibe-preview > .profile__hint { max-width:28ch; font-size:var(--step--2); }
@media (max-width:800px) { .profile__vibe-layout { grid-template-columns:1fr; } }
.profile__vibe {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) 2ch;
  align-items: center;
  gap: var(--space-3);
}
.profile__vibe input {
  width: 100%;
  min-width: 0;
  accent-color: var(--accent-500);
}
.profile__vibe output {
  font-variant-numeric: tabular-nums;
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
.profile__actions {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--ink-850);
  box-shadow: 0 -6px 18px rgba(0, 0, 0, 0.08);
}
.profile__actions p {
  margin: 0;
  font-size: var(--step--1);
}
.profile__save {
  margin-left: auto;
  min-width: 160px;
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
    grid-template-columns: minmax(0, 1fr) 2ch;
  }
  .profile__vibe input {
    grid-row: 2;
    grid-column: 1 / -1;
  }
  .profile__vibe output {
    grid-column: 2;
    grid-row: 1;
    text-align: right;
  }
  .profile__actions {
    padding: var(--space-3) var(--space-4);
  }
  .profile__save {
    min-width: 0;
    flex: 1;
  }
}
</style>
