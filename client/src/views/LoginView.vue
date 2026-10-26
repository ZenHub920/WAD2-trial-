<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { setCurrentUser } from '../auth.js';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import crowd from '../assets/login-crowd.jpg';

const route = useRoute();
const router = useRouter();

// Only same-site paths, so a crafted link cannot bounce people off-site after sign-in.
const redirect = computed(() => {
  const target = route.query.redirect;
  return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')
    ? target
    : '/concerts';
});
const mode = ref('login');
const email = ref('');
const password = ref('');
const displayName = ref('');
const loading = ref(false);
const error = ref('');
const success = ref('');
const showPassword = ref(false);

// The same form supports both sign-in and account creation.
const isRegistering = computed(() => mode.value === 'register');

function switchMode(nextMode) {
  mode.value = nextMode;
  error.value = '';
  success.value = '';
}

// Display error for registering/login
function messageFor(code) {
  if (code === 'display_name_required') {
    return 'Enter a display name.';
  }
  if (code === 'invalid_credentials') {
    return 'That email and password do not match.';
  }
  if (code === 'email_required') {
    return 'Enter your email address.';
  }
  if (code === 'password_must_be_at_least_8_characters') {
    return 'Use at least 8 characters for your password.';
  }
  if (code === 'could_not_create_user') {
    return 'An account with that email may already exist.';
  }
  return 'Something went wrong. Please try again.';
}

// Submit data to backend
async function submit() {
  error.value = '';
  success.value = '';
  loading.value = true;
  try {
    // Registration persists the account; sign-in verifies the existing account.
    const response = isRegistering.value
      //If on register page, call the register function, else call the login function
      ? await api.register({
        display_name: displayName.value.trim(),
        email: email.value,
        password: password.value,
      })
      : await api.login({
        email: email.value,
        password: password.value
      });

    setCurrentUser(response.user);
    success.value = isRegistering.value ? 'Your account is ready.' : `Welcome back, ${response.user.displayName}.`;
    setTimeout(() => router.push(redirect.value), 500);
  } catch (err) {
    error.value = messageFor(err.body?.error ?? err.message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth" :style="{ '--crowd': `url(${crowd})` }">
    <div class="auth__photo" aria-hidden="true" />
    <div class="auth__tint" aria-hidden="true" />
    <span class="auth__beam auth__beam--one" aria-hidden="true" />
    <span class="auth__beam auth__beam--two" aria-hidden="true" />

    <div class="container auth__inner">
      <div class="auth__intro">
        <p class="auth__eyebrow">
          <span class="eq" aria-hidden="true"><i /><i /><i /><i /></span>
          Encore
        </p>
        <Transition name="swap" mode="out-in">
          <h1 :key="mode">
            <template v-if="isRegistering">Find your people <span>for every show.</span></template>
            <template v-else>Welcome back <span>to the crowd.</span></template>
          </h1>
        </Transition>
        <ul class="auth__perks">
          <li>Match with fans going to the same concert</li>
          <li>Join a group or start your own</li>
          <li>Plan where to meet before the show</li>
        </ul>
      </div>

      <section class="auth__card" aria-labelledby="auth-title">
        <div class="auth__tabs" :class="{ 'auth__tabs--right': isRegistering }" role="tablist" aria-label="Account access">
          <span class="auth__tab-pill" aria-hidden="true" />
          <button type="button" :class="{ active: !isRegistering }" role="tab" :aria-selected="!isRegistering" @click="switchMode('login')">
            Sign in
          </button>
          <button type="button" :class="{ active: isRegistering }" role="tab" :aria-selected="isRegistering" @click="switchMode('register')">
            Sign up
          </button>
        </div>

        <h2 id="auth-title" class="sr-only">{{ isRegistering ? 'Sign up' : 'Sign in' }}</h2>
        <form class="auth__form" @submit.prevent="submit">
          <Transition name="grow">
            <div v-if="isRegistering" class="grow">
              <label for="display-name" class="field">
                <span class="field__label">Display name</span>
                <span class="field__box">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
                  <input id="display-name" v-model="displayName" required autocomplete="name" placeholder="How people will know you" />
                </span>
              </label>
            </div>
          </Transition>
          <label for="email" class="field">
            <span class="field__label">Email</span>
            <span class="field__box">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 6h18v12H3zM3 7l9 6 9-6" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
              <input id="email" v-model="email" required type="email" autocomplete="email" placeholder="you@example.com" />
            </span>
          </label>
          <label for="password" class="field">
            <span class="field__label">Password</span>
            <span class="field__box">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
              <input id="password" v-model="password" required :type="showPassword ? 'text' : 'password'" maxlength="1024" :minlength="isRegistering ? 8 : 1" :autocomplete="isRegistering ? 'new-password' : 'current-password'" :placeholder="isRegistering ? 'At least 8 characters' : 'Your password'" />
              <button type="button" class="field__toggle" :aria-pressed="showPassword" @click="showPassword = !showPassword">
                {{ showPassword ? 'Hide' : 'Show' }}<span class="sr-only"> password</span>
              </button>
            </span>
          </label>

          <p v-if="error" class="form-message form-message--error" role="alert">{{ error }}</p>
          <p v-if="success" class="form-message form-message--success" role="status">{{ success }}</p>
          <button class="auth__submit" :disabled="loading">
            <LoadingSpinner v-if="loading" />
            {{ loading ? 'Working…' : isRegistering ? 'Create account' : 'Sign in' }}
            <svg v-if="!loading" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </form>
        <p class="auth__foot">
          <RouterLink v-if="!isRegistering" to="/account/security">Forgot your password?</RouterLink>
          <template v-else>Already have an account? <button type="button" @click="switchMode('login')">Sign in</button></template>
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* The photo and its colour wash are the same in light and dark mode, so the
   card's colours are set here directly rather than taken from the theme. */
.auth {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  min-height: calc(100dvh - var(--header-height));
  display: grid;
  align-items: center;
  color: #fff;
}

.auth__photo {
  position: absolute;
  inset: -4%;
  z-index: -3;
  background: var(--crowd) center / cover no-repeat;
  animation: drift-zoom 24s ease-in-out infinite alternate;
}

@keyframes drift-zoom {
  from { transform: scale(1); }
  to { transform: scale(1.1) translate(-1.5%, -1%); }
}

.auth__tint {
  position: absolute;
  inset: 0;
  z-index: -2;
  background:
    linear-gradient(100deg, rgba(22, 8, 48, 0.9) 0%, rgba(40, 14, 78, 0.62) 45%, rgba(30, 10, 60, 0.4) 100%),
    linear-gradient(to top, rgba(14, 6, 30, 0.8), transparent 50%);
}

/* Two slow stage lights sweeping over the crowd. */
.auth__beam {
  position: absolute;
  z-index: -1;
  top: -30%;
  width: 40vw;
  height: 160%;
  background: linear-gradient(to bottom, rgba(239, 195, 245, 0.28), transparent 70%);
  filter: blur(30px);
  transform-origin: top center;
  mix-blend-mode: screen;
  animation: sweep 9s ease-in-out infinite alternate;
}

.auth__beam--one { left: 10%; }

.auth__beam--two {
  right: 5%;
  background: linear-gradient(to bottom, rgba(166, 133, 232, 0.3), transparent 70%);
  animation-duration: 12s;
  animation-direction: alternate-reverse;
}

@keyframes sweep {
  from { transform: rotate(-18deg); }
  to { transform: rotate(18deg); }
}

.auth__inner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 440px);
  align-items: center;
  gap: var(--space-9);
  padding-block: var(--space-8);
}

/* ---------------------------------------------------------------- Intro ---- */

.auth__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  font-weight: 700;
  font-size: var(--step--1);
  animation: rise var(--dur-slower) var(--ease-settle) both;
}

.eq {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
}

.eq i {
  width: 3px;
  height: 100%;
  border-radius: 2px;
  background: #efc3f5;
  transform-origin: bottom;
  animation: eq 0.9s ease-in-out infinite alternate;
}

.eq i:nth-child(2) { animation-delay: -0.3s; background: #a685e8; }
.eq i:nth-child(3) { animation-delay: -0.6s; }
.eq i:nth-child(4) { animation-delay: -0.15s; background: #a685e8; }

@keyframes eq {
  from { transform: scaleY(0.25); }
  to { transform: scaleY(1); }
}

.auth__intro h1 {
  margin-top: var(--space-5);
  font-size: var(--step-6);
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: #fff;
  max-width: 13ch;
  text-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
}

.auth__intro h1 span {
  display: block;
  background: linear-gradient(100deg, #efc3f5, #e69ddb 45%, #a685e8);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.auth__perks {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-6);
  padding: 0;
  list-style: none;
  color: rgba(255, 255, 255, 0.85);
}

.auth__perks li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  animation: rise var(--dur-slower) var(--ease-settle) both;
}

.auth__perks li:nth-child(1) { animation-delay: 300ms; }
.auth__perks li:nth-child(2) { animation-delay: 400ms; }
.auth__perks li:nth-child(3) { animation-delay: 500ms; }

.auth__perks li::before {
  content: '✦';
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(239, 195, 245, 0.18);
  color: #efc3f5;
  font-size: 0.75rem;
}

/* ----------------------------------------------------------------- Card ---- */

.auth__card {
  padding: var(--space-6);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--radius-xl);
  background: rgba(24, 12, 46, 0.55);
  backdrop-filter: blur(22px) saturate(160%);
  box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  animation: card-in var(--dur-slower) var(--ease-settle) 150ms both;
}

@keyframes card-in {
  from { opacity: 0; transform: translateY(30px) scale(0.97); }
  to { opacity: 1; transform: none; }
}

@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: none; }
}

/* The highlight slides between the two tabs instead of jumping. */
.auth__tabs {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 4px;
  margin-bottom: var(--space-6);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.08);
}

.auth__tab-pill {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc(50% - 4px);
  border-radius: var(--radius-pill);
  background: linear-gradient(120deg, #8b63d6, #c45bb5);
  box-shadow: 0 6px 18px -6px rgba(196, 91, 181, 0.8);
  transition: transform var(--dur-slow) var(--ease-spring-soft);
}

.auth__tabs--right .auth__tab-pill {
  transform: translateX(100%);
}

.auth__tabs button {
  position: relative;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-pill);
  color: rgba(255, 255, 255, 0.7);
  font-size: var(--step--1);
  font-weight: 700;
  transition: color var(--dur-base) var(--ease-out);
}

.auth__tabs button.active {
  color: #fff;
}

.auth__form {
  display: grid;
  gap: var(--space-4);
}

.field {
  display: grid;
  gap: var(--space-2);
}

.field__label {
  font-size: var(--step--1);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.field__box {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding-inline: var(--space-4);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.07);
  transition:
    border-color var(--dur-base) var(--ease-out),
    background var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.field__box:focus-within {
  border-color: #e69ddb;
  background: rgba(255, 255, 255, 0.12);
  box-shadow: 0 0 0 4px rgba(230, 157, 219, 0.2);
}

.field__box svg {
  flex: none;
  width: 18px;
  height: 18px;
  color: rgba(255, 255, 255, 0.55);
  transition: color var(--dur-base) var(--ease-out);
}

.field__box:focus-within svg {
  color: #efc3f5;
}

.field__box input {
  flex: 1;
  min-width: 0;
  padding-block: var(--space-3);
  border: 0;
  background: transparent;
  color: #fff;
  outline: none;
}

/* Browsers paint autofilled fields pale blue with dark text, and that paint
   cannot be removed. Holding the background colour change for a very long
   time keeps the field see-through; the text is forced back to white. */
.field__box input:-webkit-autofill,
.field__box input:-webkit-autofill:hover,
.field__box input:-webkit-autofill:focus {
  -webkit-text-fill-color: #fff;
  caret-color: #fff;
  transition: background-color 600000s 0s, color 600000s 0s;
}

.field__box input:autofill {
  background: transparent;
}

.field__box input::placeholder {
  color: rgba(255, 255, 255, 0.45);
}

.field__toggle {
  flex: none;
  color: #efc3f5;
  font-size: var(--step--2);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* The display name field opens and closes rather than popping in. The wrapper
   animates its row from 0fr to 1fr, which needs no fixed height. */
.grow {
  display: grid;
  grid-template-rows: 1fr;
}

.grow > .field {
  min-height: 0;
  overflow: hidden;
}

.grow-enter-active,
.grow-leave-active {
  transition:
    grid-template-rows var(--dur-slow) var(--ease-settle),
    opacity var(--dur-base) var(--ease-out),
    margin-bottom var(--dur-slow) var(--ease-settle);
}

.grow-enter-from,
.grow-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
  margin-bottom: calc(var(--space-4) * -1);
}

.swap-enter-active,
.swap-leave-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}

.swap-enter-from { opacity: 0; transform: translateY(12px); }
.swap-leave-to { opacity: 0; transform: translateY(-12px); }

.auth__submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  width: 100%;
  margin-top: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-pill);
  background: linear-gradient(120deg, #8b63d6, #c45bb5 60%, #e69ddb);
  background-size: 160% 100%;
  color: #fff;
  font-weight: 800;
  box-shadow: 0 14px 30px -12px rgba(196, 91, 181, 0.9);
  transition:
    background-position var(--dur-slow) var(--ease-out),
    transform var(--dur-base) var(--ease-spring),
    box-shadow var(--dur-base) var(--ease-out);
}

.auth__submit svg {
  width: 1.1em;
  height: 1.1em;
  transition: transform var(--dur-base) var(--ease-spring);
}

.auth__submit:hover:not(:disabled) {
  background-position: 100% 0;
  transform: translateY(-2px);
  box-shadow: 0 18px 36px -12px rgba(196, 91, 181, 1);
}

.auth__submit:hover:not(:disabled) svg {
  transform: translateX(4px);
}

.auth__submit:disabled {
  opacity: 0.7;
  cursor: progress;
}

.auth__foot {
  margin-top: var(--space-5);
  text-align: center;
  font-size: var(--step--1);
  color: rgba(255, 255, 255, 0.7);
}

.auth__foot a,
.auth__foot button {
  color: #efc3f5;
  font-weight: 700;
}

.form-message { font-size: var(--step--1); overflow-wrap: anywhere; }
.form-message--error { color: #ff9aa9; }
.form-message--success { color: #efc3f5; }

@media (max-width: 860px) {
  .auth__inner { grid-template-columns: 1fr; gap: var(--space-6); padding-block: var(--space-7); }
  .auth__intro h1 { font-size: var(--step-5); max-width: none; }
  .auth__perks { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .auth__photo,
  .auth__beam { animation: none; }
}
</style>
