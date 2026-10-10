<script setup>
import { onMounted, ref } from 'vue';
import { api, LABELS } from '../api.js';
import { currentUser, refreshSession } from '../auth.js';

const ageBands = ['18-20', '21-24', '25-29', '30-34', '35+'];
const regions = { north: 'North', north_east: 'North East', east: 'East', west: 'West', central: 'Central' };
const genders = { f: 'Female', m: 'Male', nb: 'Non-binary', unspecified: 'Prefer not to say' };
const companionPreferences = { any: 'Any gender', same_only: 'Same gender only' };
const languages = { en: 'English', zh: 'Chinese', ms: 'Malay', ta: 'Tamil' };

const profile = ref(null);
const form = ref(null);
const loading = ref(true);
const saving = ref(false);
const loadError = ref(null);
const saveError = ref('');
const sessionExpired = ref(false);
const saved = ref(false);

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
  loading.value = true;
  loadError.value = null;
  try {
    const response = await api.profile();
    profile.value = response.profile;
    fillForm(response.profile);
  } catch (error) {
    loadError.value = error;
  } finally {
    loading.value = false;
  }
}

onMounted(loadProfile);

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
      : `Could not save your profile: ${error.message}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="profile container section">
    <header class="profile__head">
      <p class="eyebrow">Your account</p>
      <h1>Edit profile</h1>
      <p>Set the details and concert vibe people see in Kaki Finder.</p>
    </header>

    <p v-if="loading" role="status">Loading your profile…</p>
    <div v-else-if="loadError" class="profile__notice" role="alert">
      <p>{{ loadError.status === 401 ? 'Sign in to see your profile.' : `Could not load your profile: ${loadError.message}` }}</p>
      <RouterLink v-if="loadError.status === 401" to="/login" class="btn btn--primary">Sign in</RouterLink>
      <button v-else class="btn btn--ghost" type="button" @click="loadProfile">Retry</button>
    </div>
    <form v-else-if="form" class="profile__form" @submit.prevent="save">
      <section class="profile__card" aria-labelledby="profile-about">
        <h2 id="profile-about">About you</h2>
        <div class="profile__fields">
          <label class="profile__field">
            Display name
            <input v-model="form.displayName" type="text" autocomplete="nickname" required />
          </label>
          <label class="profile__field">
            Email <span class="profile__hint">Only visible to you; not editable here.</span>
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
        {{ profile.verified ? 'Verified account' : 'Not verified' }} · Reliability {{ Math.round(profile.reliability * 100) }}%
        (these account indicators cannot be edited here).
      </p>

      <section class="profile__card" aria-labelledby="profile-vibe">
        <h2 id="profile-vibe">Your concert vibe</h2>
        <p class="profile__hint">Rate each from 0 (not for me) to 4 (love it).</p>
        <div class="profile__vibes">
          <label v-for="(label, axis) in LABELS.vibe" :key="axis" class="profile__vibe">
            <span>{{ label }}</span>
            <input v-model.number="form.vibe[axis]" type="range" min="0" max="4" step="1" :aria-valuetext="`${form.vibe[axis]} out of 4`" />
            <output>{{ form.vibe[axis] }}</output>
          </label>
        </div>
      </section>

      <p v-if="saveError" class="profile__error" role="alert">{{ saveError }} <RouterLink v-if="sessionExpired" to="/login">Sign in</RouterLink></p>
      <p v-if="saved" class="profile__success" role="status">Profile saved.</p>
      <div class="profile__actions">
        <RouterLink to="/kaki" class="btn btn--ghost">Explore Kaki Finder</RouterLink>
        <button type="submit" class="btn btn--primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save profile' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.profile { max-width: 860px; padding-bottom: var(--space-9); }
.profile__head { margin-bottom: var(--space-6); }
.profile__head h1 { margin-block: var(--space-2); }
.profile__head p:last-child, .profile__hint { color: var(--text-400); font-size: var(--step--1); }
.profile__form { display: grid; gap: var(--space-5); }
.profile__card { padding: var(--space-5); border: var(--border-soft); border-radius: var(--radius-lg); background: var(--ink-850); }
.profile__card h2 { margin-bottom: var(--space-4); font-size: var(--step-1); }
.profile__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.profile__field { display: grid; gap: var(--space-2); color: var(--text-300); font-size: var(--step--1); }
.profile__field input, .profile__field select { width: 100%; min-width: 0; padding: var(--space-3); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-700); }
.profile__field input[readonly] { opacity: .7; }
.profile__choices { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-5); margin-top: var(--space-5); padding: 0; border: 0; }
.profile__choices legend { margin-bottom: var(--space-3); color: var(--text-300); font-size: var(--step--1); }
.profile__choices label { display: inline-flex; align-items: center; gap: var(--space-2); }
.profile__vibes { display: grid; gap: var(--space-4); margin-top: var(--space-5); }
.profile__vibe { display: grid; grid-template-columns: minmax(8rem, 1fr) minmax(6rem, 2fr) 2ch; align-items: center; gap: var(--space-3); }
.profile__vibe input { width: 100%; accent-color: var(--accent-500); }
.profile__vibe output { font-variant-numeric: tabular-nums; }
.profile__error { color: var(--rose-400); }
.profile__success { color: var(--mint-400); }
.profile__notice { display: grid; justify-items: start; gap: var(--space-3); }
.profile__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-3); }
@media (max-width: 600px) { .profile__fields { grid-template-columns: 1fr; } }
</style>
