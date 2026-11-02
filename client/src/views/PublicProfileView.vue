<script setup>
import { computed, ref, watch } from 'vue';
import { api, LABELS } from '../api.js';
import { currentUser } from '../auth.js';
import BackLink from '../components/BackLink.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import UserAvatar from '../components/UserAvatar.vue';
import VibeChart from '../components/VibeChart.vue';

const props = defineProps({ id: { type: String, required: true } });
const profile = ref(null);
const loading = ref(true);
const error = ref(null);
const languageLabels = { en: 'English', zh: 'Chinese', ms: 'Malay', ta: 'Tamil' };
let request = 0;
const hasVibe = computed(() => profile.value?.hasVibeRatings === true);
const highlights = computed(() => Object.entries(profile.value?.vibe ?? {})
  .filter(([, score]) => score >= 3)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 3).map(([axis]) => LABELS.vibe[axis]));

async function load() {
  const version = ++request;
  profile.value = null;
  loading.value = true;
  error.value = null;
  try {
    const result = await api.publicProfile(props.id);
    if (version === request) profile.value = result.profile;
  } catch (failure) {
    if (version === request) error.value = failure;
  } finally {
    if (version === request) loading.value = false;
  }
}
watch([() => props.id, () => currentUser.value?.id], (_value, _old, onCleanup) => {
  onCleanup(() => { request++; });
  load();
}, { immediate: true });
</script>

<template>
  <main class="public-profile container section">
    <BackLink fallback="/kaki" fallback-label="Back to companions" />
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading concert vibe…</p>
    <section v-else-if="error" class="public-profile__notice" role="alert">
      <h1>{{ error.status === 401 ? 'Sign in to view profiles' : 'This profile is unavailable' }}</h1>
      <p>{{ error.status === 401 ? 'Concert profiles are available to signed-in members.' : 'Return to your companions or group to continue.' }}</p>
      <RouterLink v-if="error.status === 401" to="/login" class="btn btn--primary">Sign in</RouterLink>
      <button v-else-if="error.status !== 404" type="button" class="btn btn--ghost" @click="load">Try again</button>
    </section>
    <template v-else-if="profile">
      <header class="public-profile__identity">
        <UserAvatar :src="profile.avatarUrl" :name="profile.displayName" :size="88" />
        <div>
          <p class="public-profile__eyebrow">Concert profile</p>
          <h1>{{ profile.displayName }}</h1>
          <p class="public-profile__meta">{{ profile.ageBand }} · {{ profile.languages.map(code => languageLabels[code] ?? code).join(', ') }}<span v-if="profile.verified"> · Profile verified</span></p>
        </div>
        <RouterLink v-if="currentUser?.id === profile.id" to="/profile#your-vibe" class="btn btn--ghost">Edit your vibe</RouterLink>
      </header>

      <section class="public-profile__vibe" aria-labelledby="vibe-heading">
        <div class="public-profile__intro">
          <p class="public-profile__eyebrow">At a glance</p>
          <h2 id="vibe-heading">Their concert vibe</h2>
          <p>A little of what {{ profile.displayName.split(' ')[0] }} enjoys when the lights go down.</p>
          <ul v-if="highlights.length" class="public-profile__highlights" aria-label="Concert highlights">
            <li v-for="highlight in highlights" :key="highlight">{{ highlight }}</li>
          </ul>
          <p v-else class="public-profile__meta">{{ hasVibe ? 'Their ratings are shown in the chart.' : 'They have not added a concert vibe yet.' }}</p>
          <p class="public-profile__privacy">Self-described concert interests. Private matching answers and dealbreakers are not shown.</p>
        </div>
        <div v-if="hasVibe" class="public-profile__chart"><VibeChart :vibe="profile.vibe" :size="250" /></div>
        <div v-else class="public-profile__empty" aria-hidden="true">Vibe<br /><span>Coming soon</span></div>
        <details v-if="hasVibe" class="public-profile__ratings">
          <summary>Explore their six ratings</summary>
          <dl><div v-for="(label, axis) in LABELS.vibe" :key="axis"><dt>{{ label }}</dt><dd>{{ profile.vibe[axis] }} / 4</dd></div></dl>
        </details>
      </section>
    </template>
  </main>
</template>

<style scoped>
.public-profile { max-width: 960px; }
.public-profile__identity { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-4); padding:var(--space-7) 0 var(--space-6); }
.public-profile__identity h1 { margin:0 0 var(--space-1); overflow-wrap:anywhere; }
.public-profile__identity > .btn { margin-left:auto; }
.public-profile__eyebrow { margin:0 0 var(--space-2); font:600 0.7rem var(--font-mono); letter-spacing:0.12em; text-transform:uppercase; color:var(--accent-400); }
.public-profile__meta { margin:0; color:var(--text-400); font-size:var(--step--1); }
.public-profile__vibe { display:grid; grid-template-columns:minmax(0, 1fr) minmax(220px, 300px); align-items:center; gap:var(--space-6); padding:var(--space-7); border:1px solid color-mix(in oklab, var(--accent-400) 30%, var(--ink-600)); border-radius:var(--radius-xl); background:linear-gradient(135deg, color-mix(in oklab, var(--accent-500) 7%, var(--ink-850)), var(--ink-900)); box-shadow:0 18px 48px #0003, inset 0 1px 0 #ffffff0a; }
.public-profile__intro h2 { margin:0 0 var(--space-3); }
.public-profile__intro > p { max-width:36ch; }
.public-profile__highlights { display:flex; flex-wrap:wrap; gap:var(--space-2); list-style:none; margin:var(--space-5) 0; padding:0; }
.public-profile__highlights li { padding:var(--space-2) var(--space-3); border:1px solid color-mix(in oklab, var(--accent-400) 40%, transparent); border-radius:var(--radius-pill); background:color-mix(in oklab, var(--accent-500) 8%, transparent); color:var(--text-200); font-size:var(--step--1); }
.public-profile__privacy { color:var(--text-400); font-size:var(--step--2); margin-top:var(--space-5); }
.public-profile__chart { display:grid; place-items:center; min-width:0; }
.public-profile__empty { aspect-ratio:1; display:grid; align-content:center; text-align:center; border:1px dashed var(--ink-600); border-radius:50%; color:var(--text-400); font-size:var(--step-2); }
.public-profile__empty span { font-size:var(--step--1); }
.public-profile__ratings { grid-column:1/-1; border-top:var(--border-soft); padding-top:var(--space-4); }
.public-profile__ratings summary { cursor:pointer; color:var(--text-200); }
.public-profile__ratings dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--space-3) var(--space-6); margin:var(--space-4) 0 0; }
.public-profile__ratings dl > div { display:flex; justify-content:space-between; gap:var(--space-3); color:var(--text-300); font-size:var(--step--1); }
.public-profile__ratings dd { margin:0; white-space:nowrap; font-variant-numeric:tabular-nums; color:var(--accent-400); }
.public-profile__notice { padding:var(--space-7) 0; }
@media (max-width:640px) { .public-profile__vibe { grid-template-columns:1fr; padding:var(--space-5); gap:var(--space-4); } .public-profile__chart { grid-row:2; } .public-profile__ratings dl { grid-template-columns:1fr; } .public-profile__empty { width:180px; justify-self:center; } .public-profile__identity > .btn { margin-left:0; } }
</style>
