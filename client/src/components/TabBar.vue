<script setup>
/**
 * Bottom tab bar — the Concert Kaki app shell.
 *
 * Five destinations, fixed to the bottom of the viewport, matching the hi-fi
 * prototype. This is the product's primary navigation; SiteHeader remains for
 * the secondary links (method, theme, sign out) that the prototype's phone
 * frame has no room for.
 *
 * Chat and Profile have no section yet. Rather than hide them — which would
 * make the shell look wrong and invite someone to rebuild it — they route to
 * a placeholder naming what each is waiting on. A tab that explains itself is
 * better than a tab that silently does nothing.
 */
import { RouterLink } from 'vue-router';

const tabs = [
  { to: '/', label: 'Home', icon: 'home', exact: true },
  { to: '/kaki', label: 'Kaki Finder', icon: 'kaki' },
  { to: '/marketplace', label: 'Ticket Market', icon: 'ticket' },
  { to: '/chat', label: 'Chat', icon: 'chat' },
  { to: '/profile', label: 'Profile', icon: 'profile' },
];
</script>

<template>
  <nav class="tabbar" aria-label="Primary">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="tabbar__item"
      :class="{ 'tabbar__item--exact': tab.exact }"
    >
      <span class="tabbar__icon" aria-hidden="true">
        <!-- Home -->
        <svg v-if="tab.icon === 'home'" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
          />
        </svg>

        <!-- Kaki Finder: two people and a note -->
        <svg v-else-if="tab.icon === 'kaki'" viewBox="0 0 24 24" fill="none">
          <circle cx="7" cy="7.5" r="2.8" stroke="currentColor" stroke-width="1.8" />
          <path
            d="M2 19c0-2.8 2.2-4.8 5-4.8s5 2 5 4.8"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <circle cx="17.5" cy="9" r="2.3" stroke="currentColor" stroke-width="1.8" />
          <path
            d="M13.6 19c0-2.4 1.8-4 3.9-4s3.9 1.6 3.9 4"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <circle cx="19.6" cy="4.4" r="1.2" fill="currentColor" />
          <path d="M20.8 4.4V1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>

        <!-- Ticket -->
        <svg v-else-if="tab.icon === 'ticket'" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 7.5h16v3a1.8 1.8 0 0 0 0 3.5v3H4v-3a1.8 1.8 0 0 0 0-3.5z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
          />
          <path
            d="M9.5 8.2v7.6"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-dasharray="1.6 2.2"
          />
        </svg>

        <!-- Chat -->
        <svg v-else-if="tab.icon === 'chat'" viewBox="0 0 24 24" fill="none">
          <path
            d="M3.5 11c0-3.3 3.1-6 7-6s7 2.7 7 6-3.1 6-7 6a8.5 8.5 0 0 1-2.2-.3L4.5 18.5l1-3A5.7 5.7 0 0 1 3.5 11z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
          />
        </svg>

        <!-- Profile -->
        <svg v-else viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8" r="3.4" stroke="currentColor" stroke-width="1.8" />
          <path
            d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      </span>
      <span class="tabbar__label">{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 60;

  display: grid;
  grid-template-columns: repeat(5, 1fr);

  /* The bar is the full width of the phone frame on a large screen, so the
     shell reads as one device rather than a strip across the monitor. */
  max-width: var(--app-width);
  margin: 0 auto;

  background: var(--ink-800);
  border-top: var(--border-hairline);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow: var(--shadow-lg);

  /* Clear of the iOS home indicator without eating space on other devices. */
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.tabbar__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;

  padding: var(--space-2) var(--space-1) var(--space-3);
  min-height: var(--tabbar-height);

  color: var(--text-300);
  text-decoration: none;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;

  transition: color var(--dur-fast) var(--ease-out);
}

.tabbar__icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
}

.tabbar__icon svg {
  width: 24px;
  height: 24px;
}

/* vue-router adds `router-link-active` to any ancestor route, so /concerts/:id
   keeps Ticket Market lit. Home would match everything, hence the exact flag. */
.tabbar__item.router-link-active:not(.tabbar__item--exact),
.tabbar__item--exact.router-link-exact-active {
  color: var(--accent-600);
}

.tabbar__item.router-link-active:not(.tabbar__item--exact) .tabbar__icon,
.tabbar__item--exact.router-link-exact-active .tabbar__icon {
  background: var(--accent-300);
  border-radius: var(--radius-pill);
}

.tabbar__item:hover {
  color: var(--accent-500);
}

.tabbar__item:focus-visible {
  outline: 2px solid var(--accent-500);
  outline-offset: -3px;
  border-radius: var(--radius-sm);
}

@media (prefers-reduced-motion: reduce) {
  .tabbar__item {
    transition: none;
  }
}
</style>
