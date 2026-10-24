<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { currentUser } from '../auth.js';
import { unreadTotal } from '../chatLive.js';
import UserAvatar from './UserAvatar.vue';
import NotificationBell from './NotificationBell.vue';

defineProps({ theme: { type: String, default: 'light' } });
defineEmits(['toggle-theme']);

const route = useRoute();
const scrolled = ref(false);
const menuOpen = ref(false);
watch(() => route.fullPath, () => { menuOpen.value = false; });

function onScroll() {
  scrolled.value = window.scrollY > 12;
}
function onKeydown(event) {
  if (event.key === 'Escape') menuOpen.value = false;
}
onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('keydown', onKeydown);
  onScroll();
});
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <header class="header" :class="{ 'header--scrolled': scrolled }">
    <div class="header__inner container container--wide">
      <RouterLink to="/" class="brand" @click="menuOpen = false">
        <span class="brand__mark" aria-hidden="true"><span v-for="n in 4" :key="n" :style="{ height: `${6 + n * 3}px` }" /></span>
        <span>Encore</span>
      </RouterLink>
      <nav id="main-navigation" class="nav" :class="{ 'nav--open': menuOpen }" aria-label="Main navigation">
        <div class="nav__primary">
          <RouterLink to="/concerts">Concerts</RouterLink>
          <RouterLink to="/kaki">Find a companion</RouterLink>
          <RouterLink to="/groups">Groups</RouterLink>
          <RouterLink v-if="currentUser" to="/messages" class="nav__messages">
            Messages
            <span v-if="unreadTotal > 0" class="nav__badge" :aria-label="`${unreadTotal} unread ${unreadTotal === 1 ? 'chat' : 'chats'}`">{{ unreadTotal > 99 ? '99+' : unreadTotal }}</span>
          </RouterLink>
        </div>
        <div class="nav__account">
          <template v-if="currentUser">
            <RouterLink v-if="currentUser.isOperator" to="/operator/verifications">Ticket review</RouterLink>
            <RouterLink to="/profile" class="nav__profile">
              <UserAvatar :src="currentUser.avatarUrl" :name="currentUser.displayName" :size="30" />
              <span>Profile</span>
            </RouterLink>
          </template>
          <template v-else>
            <RouterLink to="/method">How it works</RouterLink>
            <RouterLink to="/login">Sign in</RouterLink>
          </template>
        </div>
      </nav>
      <div class="header__utilities">
        <button class="theme-btn" type="button" @click="$emit('toggle-theme')">
          <span aria-hidden="true">{{ theme === 'dark' ? '☾' : '☀' }}</span>
          <span class="sr-only">Switch to {{ theme === 'dark' ? 'light' : 'dark' }} theme</span>
        </button>
        <NotificationBell v-if="currentUser" @open="menuOpen = false" />
      <button class="header__toggle" type="button" aria-controls="main-navigation" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
        {{ menuOpen ? 'Close menu' : 'Menu' }}
      </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  min-height: var(--header-height);
  background: var(--ink-900);
  border-bottom: var(--border-hairline);
}
.header--scrolled { box-shadow: var(--shadow-sm); }
.header__inner {
  min-height: var(--header-height);
  display: flex;
  align-items: center;
  gap: var(--space-6);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-100);
  font-family: var(--font-display);
  font-size: var(--step-1);
  font-weight: 700;
  text-decoration: none;
  flex-shrink: 0;
}
.brand__mark { display: flex; align-items: flex-end; gap: 2px; }
.brand__mark span { width: 3px; background: var(--accent-400); border-radius: 2px; }
.header__utilities { order: 2; display: flex; align-items: center; gap: var(--space-2); margin-left: auto; }
.nav, .nav__primary, .nav__account { display: flex; align-items: center; gap: var(--space-4); }
.nav { order: 1; flex: 1; min-width: 0; justify-content: space-between; }
.nav a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}
.nav a:hover, .nav a.router-link-active { color: var(--accent-400); }
.nav__primary a.router-link-active { box-shadow: inset 0 -2px var(--accent-400); }
.nav__badge { padding: 0.1em 0.45em; border-radius: var(--radius-pill); background: var(--accent-500); color: #fff; font-size: var(--step--2); }
.theme-btn, .header__toggle { min-width: 44px; min-height: 44px; border: var(--border-hairline); border-radius: var(--radius-sm); color: var(--text-200); }
.theme-btn { display: grid; place-items: center; }
.header__toggle { display: none; padding-inline: var(--space-3); margin-left: auto; }
@media (max-width: 1100px) {
  .header__toggle { display: block; }
  .nav {
    position: absolute;
    inset: 100% 0 auto;
    max-height: calc(100dvh - var(--header-height));
    overflow-y: auto;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
    padding: var(--space-4) var(--gutter);
    background: var(--ink-900);
    border-bottom: var(--border-hairline);
    box-shadow: var(--shadow-md);
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }
  .nav--open { visibility: visible; opacity: 1; pointer-events: auto; }
  .nav__primary, .nav__account { flex-direction: column; align-items: stretch; gap: var(--space-1); }
  .nav__account { border-top: var(--border-hairline); padding-top: var(--space-3); }
  .nav a { padding-inline: var(--space-3); white-space: normal; }
  .nav__primary a.router-link-active { box-shadow: inset 3px 0 var(--accent-400); background: var(--ink-800); }
}
</style>
