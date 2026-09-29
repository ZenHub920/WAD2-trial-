<template>
  <footer class="footer">
    <div class="container container--wide footer__inner">
      <div class="footer__brand">
        <p class="footer__word">Encore</p>
        <p class="footer__tag">
          Stable matching for people who refuse to miss a show.
        </p>
      </div>

      <nav class="footer__links" aria-label="Footer">
        <div>
          <h5>Product</h5>
          <RouterLink to="/concerts">Browse concerts</RouterLink>
          <RouterLink to="/method">How matching works</RouterLink>
        </div>
        <div>
          <h5>The algorithm</h5>
          <RouterLink to="/method#gale-shapley">Gale-Shapley</RouterLink>
          <RouterLink to="/method#stability">Stability</RouterLink>
          <RouterLink to="/method#evaluation">Evaluation</RouterLink>
        </div>
      </nav>
    </div>

    <div class="container container--wide footer__base">
      <p>Built as a university project. All people and events shown are fictional.</p>
      <p class="mono">Hospital/Residents · deferred acceptance · O(E log q)</p>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  margin-top: var(--space-10);
  border-top: var(--border-hairline);
  background: var(--ink-850);
  padding-block: var(--space-7) var(--space-5);
}

.footer__inner {
  display: grid;
  gap: var(--space-6);
  grid-template-columns: 1fr;
}

@media (min-width: 760px) {
  .footer__inner {
    grid-template-columns: 1.3fr 1fr;
    align-items: start;
  }
}

.footer__word {
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--text-100);
}

.footer__tag {
  margin-top: var(--space-2);
  color: var(--text-400);
  font-size: var(--step--1);
  max-width: 34ch;
}

.footer__links {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-5);
}

.footer__links h5 {
  font-family: var(--font-mono);
  font-size: var(--step--2);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-400);
  margin-bottom: var(--space-3);
  font-weight: 500;
}

.footer__links a {
  display: block;
  color: var(--text-300);
  text-decoration: none;
  font-size: var(--step--1);
  padding-block: var(--space-1);
  transition: color var(--dur-fast) var(--ease-out);
}

.footer__links a:hover {
  color: var(--accent-400);
}

.footer__base {
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  border-top: var(--border-hairline);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: space-between;
  color: var(--text-400);
  font-size: var(--step--2);
}
</style>
