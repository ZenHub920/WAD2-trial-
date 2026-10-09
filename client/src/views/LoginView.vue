<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';

const router = useRouter();
const mode = ref('login');
const email = ref('');
const password = ref('');
const displayName = ref('');
const loading = ref(false);
const error = ref('');
const success = ref('');

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
        password: password.value 
      })
      : await api.login({ 
        email: email.value, 
        password: password.value 
      });

    // Store the public user profile for the rest of the client session.
    localStorage.setItem('encore-user', JSON.stringify(response.user));
    success.value = isRegistering.value ? 'Your account is ready.' : `Welcome back, ${response.user.displayName}.`;
    setTimeout(() => router.push('/concerts'), 500);
  } catch (err) {
    error.value = messageFor(err.body?.error ?? err.message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth container">
    <div class="auth_intro">
      <h1>{{ isRegistering ? "Let's Get Started" : 'Welcome back.' }}</h1>
      <p class="lede">
        {{ isRegistering
          ? 'Save your concert preferences and find people who want to spend the night the same way.'
          : 'Sign in to see your groups, requests, and upcoming concert plans.' }}
      </p>
    </div>

    <section class="auth_card card" aria-labelledby="auth-title">
      <div class="auth_tabs" role="tablist" aria-label="Account access">
        <button :class="{ active: !isRegistering }" role="tab" :aria-selected="!isRegistering" @click="switchMode('login')">
          Sign in
        </button>
        <button :class="{ active: isRegistering }" role="tab" :aria-selected="isRegistering" @click="switchMode('register')">
          Register
        </button>
      </div>

      <h2 id="auth-title" class="sr-only">{{ isRegistering ? 'Register' : 'Sign in' }}</h2>
      <form class="auth_form" @submit.prevent="submit">
        <label v-if="isRegistering" for="display-name">
          Display name
          <input id="display-name" v-model="displayName" required autocomplete="name" placeholder="How people will know you" />
        </label>
        <label for="email">
          Email
          <input id="email" v-model="email" required type="email" autocomplete="email" placeholder="you@example.com" />
        </label>
        <label for="password">
          Password
          <input id="password" v-model="password" required type="password" :minlength="isRegistering ? 8 : 1" autocomplete="current-password" placeholder="At least 8 characters" />
        </label>

        <p v-if="error" class="form-message form-message--error" role="alert">{{ error }}</p>
        <p v-if="success" class="form-message form-message--success" role="status">{{ success }}</p>
        <button class="btn btn--primary auth_submit" :disabled="loading">
          {{ loading ? 'Working…' : isRegistering ? 'Create account' : 'Sign in' }}
        </button>
      </form>
      <p class="auth_note">Your account is stored securely with Encore’s existing database.</p>
    </section>
  </div>
</template>

<style scoped>
.auth {
  min-height: 68vh;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 460px);
  align-items: center;
  gap: var(--space-9);
  padding-block: var(--space-8);
}

.auth_intro h1 {
  margin-block: var(--space-3) var(--space-4);
  max-width: 10ch;
}

.auth_intro .lede {
  max-width: 42ch;
}

.auth_card {
  padding: var(--space-6);
  box-shadow: var(--shadow-lg);
}

.auth_tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-1);
  padding: var(--space-1);
  margin-bottom: var(--space-6);
  background: var(--ink-700);
  border-radius: var(--radius-pill);
}

.auth_tabs button {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-pill);
  color: var(--text-300);
  font-size: var(--step--1);
}

.auth_tabs button.active {
  background: var(--ink-800);
  color: var(--text-100);
  box-shadow: var(--shadow-sm);
}

.auth_form {
  display: grid;
  gap: var(--space-4);
}

.auth_form label {
  display: grid;
  gap: var(--space-2);
  color: var(--text-200);
  font-size: var(--step--1);
  font-weight: 600;
}

.auth_form input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--ink-700);
  color: var(--text-100);
}

.auth_form input::placeholder { color: var(--text-400); }
.auth_form input:focus { border-color: var(--accent-400); outline: none; }
.auth_submit { width: 100%; margin-top: var(--space-2); }
.auth_note { margin-top: var(--space-5); color: var(--text-400); font-size: var(--step--2); text-align: center; }
.form-message { font-size: var(--step--1); }
.form-message--error { color: var(--rose-400); }
.form-message--success { color: var(--mint-400); }

@media (max-width: 760px) {
  .auth { grid-template-columns: 1fr; gap: var(--space-6); padding-block: var(--space-7); }
  .auth_intro h1 { max-width: none; }
}
</style>