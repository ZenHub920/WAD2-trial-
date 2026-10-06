<template>
  <div class="container section nf">
    <p class="eyebrow">404</p>
    <h1>No match for that one.</h1>
    <p class="lede">
      The page you were after is not on the list. Which, given what this site is about,
      feels like an unstable outcome.
    </p>
    <div class="nf__actions">
      <RouterLink to="/" class="btn btn--primary">Back to the start</RouterLink>
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
