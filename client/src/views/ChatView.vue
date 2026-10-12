<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import { formatMoney, formatRelative } from '../market.js';
import MarketNotice from '../components/market/MarketNotice.vue';
import UserAvatar from '../components/market/UserAvatar.vue';

/** Chat inbox: every conversation the signed-in user is in, as buyer or seller. */
const conversations = ref([]);
const loading = ref(true);
const error = ref(null);

onMounted(async () => {
  try {
    conversations.value = (await api.conversations()).conversations;
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="container inbox">
    <h1 class="inbox__title">Chat</h1>

    <div v-if="loading" class="skeleton" aria-busy="true" />

    <MarketNotice v-else-if="error?.status === 401" title="Sign in to see your messages">
      <RouterLink :to="{ name: 'login', query: { redirect: '/chat' } }">Sign in</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error" tone="error" title="Could not load your messages">
      <p class="mono">{{ error.message }}</p>
    </MarketNotice>

    <MarketNotice v-else-if="!conversations.length" title="No conversations yet">
      Tap <strong>Chat</strong> on a listing to message its seller.
      <RouterLink :to="{ name: 'marketplace' }">Browse tickets</RouterLink>
    </MarketNotice>

    <ul v-else class="inbox__list">
      <li v-for="c in conversations" :key="c.id">
        <RouterLink :to="{ name: 'chat-thread', params: { id: c.id } }" class="thread">
          <UserAvatar :user="c.other" :size="44" />
          <div class="thread__body">
            <div class="thread__top">
              <span class="thread__name">{{ c.other.displayName }}</span>
              <time v-if="c.lastMessage" class="thread__time" :datetime="c.lastMessage.createdAt">
                {{ formatRelative(c.lastMessage.createdAt) }}
              </time>
            </div>
            <p class="thread__listing">
              {{ c.role === 'buyer' ? 'Buying' : 'Selling' }} · {{ c.listing.title }}
              · {{ formatMoney(c.listing.priceCents) }}
            </p>
            <p class="thread__preview">{{ c.lastMessage?.body ?? 'No messages yet' }}</p>
          </div>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.inbox {
  max-width: 680px;
  padding-block: var(--space-6) var(--space-9);
}

.inbox__title {
  margin-bottom: var(--space-5);
  font-size: var(--step-4);
}

.inbox__list {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  list-style: none;
}

.thread {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-4);
  border: var(--border-hairline);
  border-radius: var(--radius-md);
  background: var(--ink-800);
  color: inherit;
  text-decoration: none;
  transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.thread:hover {
  border-color: var(--ink-500);
  background: var(--ink-750);
}

.thread__body {
  flex: 1;
  min-width: 0;
}

.thread__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.thread__name {
  color: var(--text-100);
  font-weight: 600;
}

.thread__time {
  flex: none;
  color: var(--text-400);
  font-size: var(--step--2);
}

.thread__listing,
.thread__preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--step--1);
}

.thread__listing {
  color: var(--accent-300);
}

.thread__preview {
  color: var(--text-300);
}

.skeleton {
  height: 240px;
}
</style>
