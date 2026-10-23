<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { currentUser, setCurrentUser } from '../auth.js';

const route = useRoute();
const router = useRouter();
const mode = ref(route.query.mode === 'verify' ? 'verify' : 'reset');
// Keep single-use secrets in memory and immediately remove them from the address bar.
const token = ref(new URLSearchParams(route.hash.slice(1)).get('token') ?? '');
if (route.hash) router.replace({ path: route.path, query: route.query, hash: '' });
const email = ref('');
const password = ref('');
const repeatPassword = ref('');
const currentPassword = ref('');
const status = ref(null);
const busy = ref(false);
const message = ref('');
const error = ref('');
const hasLink = computed(() => Boolean(token.value));

async function request(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'request_failed');
  return data;
}
function describe(code) {
  return ({
    invalid_or_expired_token: 'This link has expired or has already been used. Request a new email.',
    invalid_credentials: 'Your current password did not match.',
    authentication_required: 'Sign in again to manage your account.',
    password_must_be_8_to_1024_characters: 'Choose a password between 8 and 1,024 characters.',
    rate_limit_exceeded: 'Too many attempts. Please wait before trying again.',
  })[code] ?? 'We could not complete that request. Please try again.';
}
async function run(action) {
  if (busy.value) return;
  busy.value = true;
  message.value = '';
  error.value = '';
  try { await action(); } catch (err) { error.value = describe(err.message); }
  finally { busy.value = false; }
}
async function loadStatus() {
  if (!currentUser.value) { status.value = null; return; }
  try { status.value = await request('/auth/security'); }
  catch { status.value = null; }
}
watch(currentUser, loadStatus, { immediate: true });

function requestReset() {
  run(async () => {
    await request('/auth/password-reset/request', 'POST', { email: email.value });
    message.value = 'If this email belongs to an account, a reset link will arrive shortly. Check your spam folder too.';
  });
}
function resetPassword() {
  if (password.value !== repeatPassword.value) { error.value = 'Your new passwords must match.'; return; }
  run(async () => {
    await request('/auth/password-reset/confirm', 'POST', { token: token.value, password: password.value });
    token.value = '';
    password.value = '';
    repeatPassword.value = '';
    setCurrentUser(null);
    message.value = 'Your password is updated. Sign in with your new password.';
  });
}
function verifyEmail() {
  run(async () => {
    await request('/auth/email-verification/confirm', 'POST', { token: token.value });
    token.value = '';
    message.value = 'Your email address is verified.';
    await loadStatus();
  });
}
function requestVerification() {
  run(async () => {
    await request('/auth/email-verification/request', 'POST', {});
    message.value = 'Check your inbox for a verification link. You can continue using Encore while you wait.';
  });
}
function changePassword() {
  if (password.value !== repeatPassword.value) { error.value = 'Your new passwords must match.'; return; }
  run(async () => {
    await request('/auth/password/change', 'POST', { currentPassword: currentPassword.value, password: password.value });
    currentPassword.value = password.value = repeatPassword.value = '';
    setCurrentUser(null);
    message.value = 'Password updated and all devices signed out. Sign in again to continue.';
  });
}
function revokeSessions() {
  run(async () => {
    await request('/auth/sessions', 'DELETE');
    setCurrentUser(null);
    message.value = 'All devices are signed out, including this one.';
  });
}
</script>

<template>
  <main class="account-security container">
    <RouterLink class="back-link" :to="currentUser ? '/profile' : '/login'">&larr; {{ currentUser ? 'Your profile' : 'Sign in' }}</RouterLink>
    <h1>{{ hasLink && mode === 'verify' ? 'Verify your email' : hasLink ? 'Choose a new password' : 'Account security' }}</h1>
    <p v-if="message" class="form-message form-message--success" role="status">{{ message }}</p>
    <p v-if="error" class="form-message form-message--error" role="alert">{{ error }}</p>

    <section v-if="hasLink && mode === 'verify'" class="card security-card">
      <p>Confirm that this email belongs to you. This is separate from ticket verification.</p>
      <button class="btn btn--primary" :disabled="busy" @click="verifyEmail">{{ busy ? 'Verifying…' : 'Verify email address' }}</button>
    </section>
    <form v-else-if="hasLink" class="card security-card" @submit.prevent="resetPassword">
      <label>New password<input v-model="password" type="password" minlength="8" maxlength="1024" autocomplete="new-password" required /></label>
      <label>Repeat new password<input v-model="repeatPassword" type="password" minlength="8" maxlength="1024" autocomplete="new-password" required /></label>
      <p class="muted">This link is valid for 30 minutes. Updating your password signs out every device.</p>
      <button class="btn btn--primary" :disabled="busy">{{ busy ? 'Updating…' : 'Update password' }}</button>
    </form>
    <template v-else-if="currentUser && status">
      <section class="card security-card">
        <h2>Email address</h2>
        <p>{{ status.email }} · {{ status.emailVerified ? 'Verified' : 'Not yet verified' }}</p>
        <p v-if="!status.emailConfigured" class="muted">Email delivery is awaiting server configuration. Existing sign-in continues to work.</p>
        <button v-if="!status.emailVerified" class="btn btn--secondary" :disabled="busy || !status.emailConfigured" @click="requestVerification">Send verification email</button>
      </section>
      <form class="card security-card" @submit.prevent="changePassword">
        <h2>Change password</h2>
        <label>Current password<input v-model="currentPassword" type="password" maxlength="1024" autocomplete="current-password" required /></label>
        <label>New password<input v-model="password" type="password" minlength="8" maxlength="1024" autocomplete="new-password" required /></label>
        <label>Repeat new password<input v-model="repeatPassword" type="password" minlength="8" maxlength="1024" autocomplete="new-password" required /></label>
        <button class="btn btn--primary" :disabled="busy">Update password and sign out</button>
      </form>
      <section class="card security-card">
        <h2>Signed-in devices</h2>
        <p>{{ status.sessionCount }} active {{ status.sessionCount === 1 ? 'session' : 'sessions' }}. Sign out everywhere if a device is lost or shared.</p>
        <button class="btn btn--secondary" :disabled="busy" @click="revokeSessions">Sign out every device</button>
      </section>
      <section v-if="status.warnings.length" class="card security-card">
        <h2>Account notices</h2>
        <p v-for="notice in status.warnings" :key="notice.id">{{ notice.note }}</p>
      </section>
    </template>
    <form v-else class="card security-card" @submit.prevent="requestReset">
      <h2>Reset your password</h2>
      <p>Enter the email you use for Encore. We will send a single-use reset link.</p>
      <label>Email address<input v-model="email" type="email" maxlength="254" autocomplete="email" required /></label>
      <button class="btn btn--primary" :disabled="busy">{{ busy ? 'Requesting…' : 'Send reset link' }}</button>
    </form>
  </main>
</template>

<style scoped>
.account-security { max-width: 740px; padding-block: var(--space-7); }
.account-security h1 { margin-block: var(--space-4) var(--space-6); }
.security-card { display: grid; gap: var(--space-4); padding: var(--space-5); margin-bottom: var(--space-5); }
.security-card h2 { font-size: var(--step-1); }
.security-card label { display: grid; gap: var(--space-2); }
.security-card input { width: 100%; padding: var(--space-3); background: var(--ink-800); color: var(--text-100); border: 1px solid var(--ink-600); border-radius: var(--radius-md); }
.security-card .btn { justify-self: start; }
.muted, .back-link { color: var(--text-300); }
</style>
