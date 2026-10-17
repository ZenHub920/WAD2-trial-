<script setup>
import StabilityDemo from '../components/StabilityDemo.vue';
</script>

<template>
  <div class="container section method">
    <header>
      <h1>How it works</h1>
      <p class="lede">Choose your concert, find your people and make a plan.</p>
    </header>

    <section class="block">
      <h2>Find a Kaki</h2>
      <p>Join a concert and browse people with similar preferences. When you both like each other, you can chat and plan your meetup.</p>
      <RouterLink to="/kaki" class="btn btn--ghost">Find a Kaki</RouterLink>
    </section>

    <section class="block">
      <h2>Join a group</h2>
      <p>Compare groups at your concert and request a place. The host reviews your request and confirms your spot.</p>
      <RouterLink to="/groups" class="btn btn--ghost">Find a group</RouterLink>
    </section>

    <section class="block">
      <h2>Bring your friends</h2>
      <p>Create a group, invite your friends and add everyone's preferences. Open places to new people or connect with another group at the same show.</p>
      <RouterLink to="/groups/connect" class="btn btn--ghost">Connect groups</RouterLink>
    </section>

    <details id="gale-shapley" class="block">
      <summary>About automatic matching</summary>
      <p>Separate automatic matching rounds use Gale-Shapley to pair seekers with groups using ranked preferences and available places.</p>
      <div id="stability">
        <p>A stable assignment has no seeker and group who would both prefer each other to their current match. Try changing the pairings below.</p>
        <StabilityDemo />
      </div>
    </details>
  </div>
</template>

<style scoped>
.method {
  max-width: 900px;
}

header .lede {
  margin-top: var(--space-4);
}

.block {
  margin-top: var(--space-7);
  padding-top: var(--space-6);
  border-top: var(--border-hairline);
}

.block h2 {
  font-size: var(--step-2);
}

.block p {
  max-width: 65ch;
  margin-block: var(--space-3) var(--space-4);
  color: var(--text-300);
}

summary {
  cursor: pointer;
  font-weight: 600;
}
</style>
