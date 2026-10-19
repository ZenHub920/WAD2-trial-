<template>
  <span class="loading-spinner" role="status">
    <span class="sr-only">Loading…</span>
  </span>
</template>

<style scoped>
.loading-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  vertical-align: middle;
  flex-shrink: 0;
  border: 2px solid var(--ink-500);
  border-top-color: var(--accent-400);
  border-radius: 50%;
  animation: loading-spin 750ms linear infinite;
}
@keyframes loading-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .loading-spinner { animation: none; }
}
</style>
