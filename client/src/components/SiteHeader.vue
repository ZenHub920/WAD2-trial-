<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
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
const mobileMenu = ref(false);
const headerRoot = ref(null);
const navigation = ref(null);
const notifications = ref(null);
const menuToggle = ref(null);
let menuQuery;
// Resolving the initial lazy route is not navigation away from the page.
watch(() => [route.fullPath, route.matched], (_, previous) => {
  if (previous[1].length) menuOpen.value = false;
});
function selectDestination(event) {
  if (event.target.closest('a[href]')) menuOpen.value = false;
}

async function toggleMenu() {
  const opening = !menuOpen.value;
  if (opening) notifications.value?.dismiss();
  menuOpen.value = opening;
  await nextTick();
  // The mobile disclosure follows the links in DOM order. Move into its first
  // link so keyboard users can read forwards through the newly opened menu.
  if (opening && menuOpen.value && mobileMenu.value) navigation.value?.querySelector('a')?.focus();
}
function onOutside(event) {
  if (mobileMenu.value && menuOpen.value && !headerRoot.value?.contains(event.target)) menuOpen.value = false;
}

function onScroll() {
  scrolled.value = window.scrollY > 12;
}
function onKeydown(event) {
  if (event.key === 'Escape' && menuOpen.value) {
    event.preventDefault();
    menuOpen.value = false;
    if (mobileMenu.value) menuToggle.value?.focus();
  }
}
function syncMenu(event) {
  mobileMenu.value = event.matches;
  if (!event.matches) menuOpen.value = false;
}
/**
 * The bar under the current page, as one element that moves.
 *
 * Measured rather than guessed: the links are text, so their widths depend on
 * the font, the language and the viewport, and nothing but the live box is
 * right. It is `null` until a measurement succeeds, which is what keeps the
 * bar from flashing at the far left on first paint, and on the stacked mobile
 * menu — where a horizontal bar would mean nothing — it stays hidden and the
 * active link falls back to its own underline.
 */
const primaryNav = ref(null);
const indicator = ref(null);

function measureIndicator() {
  const list = primaryNav.value;
  const active = list?.querySelector('a.router-link-active');
  if (!list || !active || mobileMenu.value) { indicator.value = null; return; }
  const from = list.getBoundingClientRect();
  const to = active.getBoundingClientRect();
  if (!to.width) { indicator.value = null; return; }
  // The underline this replaces was an inset shadow, so the link's own corner
  // radius clipped it and its ends curved inward. Insetting by that radius
  // reproduces the shape; reading it from the link keeps the two in step if
  // the radius token ever changes.
  const radius = Number.parseFloat(getComputedStyle(active).borderBottomLeftRadius) || 0;
  const inset = Math.min(radius, to.width / 4);
  indicator.value = { left: `${to.left - from.left + inset}px`, width: `${Math.max(0, to.width - inset * 2)}px` };
}

const remeasure = () => { void nextTick(measureIndicator); };
watch(() => route.fullPath, remeasure);
watch(mobileMenu, remeasure);
watch(currentUser, remeasure);
watch(unreadTotal, remeasure);

let navResize;
onMounted(() => {
  remeasure();
  // Fonts land after first paint and change every link's width with them.
  document.fonts?.ready?.then(remeasure).catch(() => {});
  if (typeof ResizeObserver === 'function') {
    navResize = new ResizeObserver(measureIndicator);
    if (primaryNav.value) navResize.observe(primaryNav.value);
  }
  menuQuery = window.matchMedia('(max-width: 1100px)');
  syncMenu(menuQuery);
  menuQuery.addEventListener('change', syncMenu);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', measureIndicator);
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('pointerdown', onOutside);
  onScroll();
});
onUnmounted(() => {
  navResize?.disconnect();
  menuQuery?.removeEventListener('change', syncMenu);
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', measureIndicator);
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('pointerdown', onOutside);
});
</script>

<template>
  <header ref="headerRoot" class="header" :class="{ 'header--scrolled': scrolled }">
    <div class="header__inner container container--wide">
      <RouterLink to="/" class="brand" @click="menuOpen = false">
        <span class="brand__mark" aria-hidden="true"><span v-for="n in 4" :key="n" :style="{ height: `${6 + n * 3}px` }" :data-bar="n" /></span>
        <span>Encore</span>
      </RouterLink>
      <nav id="main-navigation" ref="navigation" class="nav" :class="{ 'nav--open': menuOpen }" :inert="mobileMenu && !menuOpen ? '' : undefined" aria-label="Main navigation" @click="selectDestination">
        <div class="nav__context"><strong>Explore Encore</strong><p>Concerts, companions and your plans</p></div>
        <div ref="primaryNav" class="nav__primary">
          <span v-if="indicator" class="nav__indicator" :style="indicator" aria-hidden="true" />
          <RouterLink to="/concerts">Concerts</RouterLink>
          <RouterLink to="/tickets">Tickets</RouterLink>
          <RouterLink to="/kaki">Find a companion</RouterLink>
          <RouterLink to="/groups">Groups</RouterLink>
          <RouterLink v-if="currentUser" to="/messages" class="nav__messages">
            Messages
            <span v-if="unreadTotal > 0" class="nav__badge" :aria-label="`${unreadTotal} unread ${unreadTotal === 1 ? 'chat' : 'chats'}`">{{ unreadTotal > 99 ? '99+' : unreadTotal }}</span>
          </RouterLink>
          <RouterLink v-if="currentUser?.isOperator" to="/admin/verifications">Admin</RouterLink>
        </div>
        <div class="nav__account">
          <template v-if="currentUser">
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
        <NotificationBell v-if="currentUser" ref="notifications" @open="menuOpen = false" />
        <button ref="menuToggle" class="header__toggle" type="button" aria-controls="main-navigation" :aria-expanded="menuOpen" :aria-label="menuOpen ? 'Close menu' : 'Menu'" @click="toggleMenu">
          <span class="header__menu-icon" aria-hidden="true"><span /><span /></span>
          <span>Menu</span>
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
  background: var(--glass-tint);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--panel-edge);
  transition: box-shadow var(--dur-base) var(--ease-settle);
}
.header--scrolled {
  box-shadow: inset 0 -1px 0 var(--panel-highlight), var(--shadow-md);
}
.header__inner {
  min-height: var(--header-height);
  display: flex;
  align-items: center;
  gap: var(--space-5);
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
.brand__mark {
  display: flex;
  align-items: flex-end;
  gap: 2px;
}
.brand__mark span {
  width: 3px;
  background: var(--accent-400);
  border-radius: 2px;
  /* Each bar scales about its own base, so they rise and fall from the floor
     rather than floating. Four durations with no common multiple worth
     waiting for, so the mark never visibly loops. */
  transform-origin: 50% 100%;
  animation: brand-pulse 1.1s var(--ease-settle, ease-in-out) infinite alternate;
}
.brand__mark span[data-bar='1'] { animation-duration: 1.3s; animation-delay: -0.9s; }
.brand__mark span[data-bar='2'] { animation-duration: 0.9s; animation-delay: -0.3s; }
.brand__mark span[data-bar='3'] { animation-duration: 1.5s; animation-delay: -1.1s; }
.brand__mark span[data-bar='4'] { animation-duration: 1.1s; animation-delay: -0.5s; }

/* Hovering the wordmark drives it harder, so the logo answers the pointer. */
.brand:hover .brand__mark span { animation-duration: 0.45s; }

@keyframes brand-pulse {
  from { transform: scaleY(0.45); }
  to { transform: scaleY(1.25); }
}

@media (prefers-reduced-motion: reduce) {
  .brand__mark span,
  .brand:hover .brand__mark span { animation: none; transform: none; }
}
.header__utilities {
  order: 2;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}
.nav, .nav__primary, .nav__account {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.nav {
  order: 1;
  flex: 1;
  min-width: 0;
  justify-content: space-between;
}
.nav__context { display: none; }
.nav a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding-inline: var(--space-2);
  border-radius: var(--radius-sm);
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-base) var(--ease-settle);
}
.nav a:hover, .nav a.router-link-active {
  color: var(--accent-400);
}
.nav__primary { position: relative; }
.nav__primary a.router-link-active {
  background: var(--ink-750);
  color: var(--text-100);
}

/* One bar for the whole nav, slid into place, so changing page reads as the
   marker travelling rather than blinking out and in somewhere else. */
.nav__indicator {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  /* Fully rounded at this height, so both ends read as caps rather than cuts. */
  border-radius: var(--radius-pill, 999px);
  background: var(--accent-400);
  transition: left var(--dur-base) var(--ease-settle, ease-out), width var(--dur-base) var(--ease-settle, ease-out);
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .nav__indicator { transition: none; }
}

/* The links stack here, so a single horizontal bar has nothing to point at.
   The travelling indicator stands down and each link marks itself again. */
@media (max-width: 1100px) {
  .nav__indicator { display: none; }
  .nav__primary a.router-link-active { box-shadow: inset 2px 0 var(--accent-400); }
}
.nav__badge {
  padding: 0.1em 0.45em;
  border-radius: var(--radius-pill);
  background: var(--action-start);
  color: var(--on-action);
  font-size: var(--step--2);
}
.theme-btn, .header__toggle {
  min-width: 44px;
  min-height: 44px;
  border: var(--control-border);
  border-radius: var(--radius-sm);
  color: var(--text-200);
  background: color-mix(in srgb, var(--ink-800) 65%, transparent);
  box-shadow: inset 0 1px 0 var(--panel-highlight);
  transition: background-color var(--dur-fast), border-color var(--dur-fast), transform var(--dur-fast) var(--ease-settle);
}
.theme-btn:hover, .header__toggle:hover, .header__toggle[aria-expanded='true'] {
  border-color: var(--accent-400);
  background: var(--ink-800);
}
.theme-btn:active, .header__toggle:active {
  transform: translateY(1px) scale(0.97);
}
.theme-btn {
  display: grid;
  place-items: center;
}
.header__toggle {
  display: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-inline: var(--space-3);
  margin-left: auto;
}
.header__menu-icon { display: grid; gap: 4px; width: 14px; }
.header__menu-icon span { width: 14px; height: 1.5px; background: currentColor; border-radius: 2px; transition: transform var(--dur-fast) var(--ease-settle); }
.header__toggle[aria-expanded='true'] .header__menu-icon span:first-child { transform: translateY(2.75px) rotate(45deg); }
.header__toggle[aria-expanded='true'] .header__menu-icon span:last-child { transform: translateY(-2.75px) rotate(-45deg); }
@media (max-width: 1100px) {
  .header__inner { gap: var(--space-3); }
  .header__toggle {
    display: inline-flex;
  }
  .nav {
    position: absolute;
    inset: 100% 0 auto;
    max-height: calc(100dvh - var(--header-height));
    overflow-y: auto;
    overscroll-behavior: contain;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
    padding: var(--space-4) var(--gutter);
    background: var(--surface-floating);
    border-bottom: 1px solid var(--floating-edge);
    box-shadow: var(--floating-shadow);
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-8px);
    transition: opacity 180ms var(--ease-settle), transform var(--dur-panel) var(--ease-settle), visibility 0s 180ms;
  }
  .nav--open {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
    transition: opacity 180ms var(--ease-settle), transform var(--dur-panel) var(--ease-settle);
  }
  .nav__primary, .nav__account {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
  }
  .nav__context { display: block; padding: var(--space-2) var(--space-3) var(--space-3); border-bottom: 1px solid var(--panel-edge); }
  .nav__context strong { color: var(--text-100); font-size: var(--step--1); font-weight: 650; }
  .nav__context p { margin-top: var(--space-1); color: var(--text-300); font-size: var(--step--2); }
  .nav__account {
    border-top: var(--border-hairline);
    padding-top: var(--space-3);
  }
  .nav a {
    padding-inline: var(--space-3);
    white-space: normal;
  }
  .nav__primary a.router-link-active {
    box-shadow: inset 3px 0 var(--accent-400);
    background: var(--ink-750);
  }
}

@media (max-width: 480px) {
  .header__inner { gap: var(--space-2); flex-wrap: wrap; }
  .brand { font-size: 1.1rem; }
  .header__utilities { gap: var(--space-1); }
  .header__toggle { padding-inline: var(--space-2); font-size: .875rem; }
}

@media (prefers-reduced-motion: reduce) {
  /* Stop inherited visibility transitions on wrappers as well as the panel.
     Global tiny durations would otherwise leave a child hidden during focus. */
  .nav, .nav * { transition: none !important; }
  .nav { transform: none; }
  .header__menu-icon span { transition: none; }
  .theme-btn:active, .header__toggle:active { transform: none; }
}
</style>
