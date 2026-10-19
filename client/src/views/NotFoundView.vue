<template>
  <div class="container section nf">
    <h1>Page not found</h1>
    <p class="lede">This page may have moved or been removed.</p>
    <div class="nf__actions">
      <RouterLink to="/" class="btn btn--primary">Home</RouterLink>
      <RouterLink to="/concerts" class="btn btn--ghost">Browse concerts</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.nf {
  min-height: 55vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-width: var(--measure);
}

.nf h1 {
  margin-block: var(--space-3) var(--space-4);
}

.nf__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
</style>
