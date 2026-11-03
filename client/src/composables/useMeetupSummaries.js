import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { api } from '../api.js';
import { currentUser } from '../auth.js';
import { onChatEvent } from '../chatLive.js';
import { normalizeMeetupScope } from '../utils/meetupNavigation.js';
import { meetupsForScope, preferredMeetup } from '../utils/meetupSummaries.js';

// One authenticated list per tab, shared by all dashboard rows and chat cards.
// This contains public planning summaries, never participants' starting places.
const plans = shallowRef([]), loading = ref(false), error = ref(''), revision = ref(0);
let owner = '', loaded = false, pending = null, request = 0, invalidation = 0;
let consumers = 0, stopEvents;
const contexts = new Map();

function session() {
  const id = currentUser.value?.id ?? '';
  if (id !== owner) {
    owner = id; loaded = false; pending = null; request++; invalidation++; plans.value = [];
    error.value = ''; loading.value = false; contexts.clear();
  }
  return id;
}

export function invalidateMeetupSummaries() {
  loaded = false; invalidation++; contexts.clear();
}

export async function refreshMeetupSummaries({ force = false } = {}) {
  const user = session();
  if (!user) return [];
  if (pending) return pending;
  if (loaded && !force) return plans.value;
  const token = ++request, snapshot = invalidation;
  loading.value = true; error.value = '';
  pending = (async () => {
    let superseded = false;
    try {
      const data = await Promise.resolve().then(() => api.meetups());
      if (session() === user && token === request) {
        superseded = snapshot !== invalidation;
        if (!superseded) { plans.value = data.meetups; loaded = true; revision.value++; }
      }
    } catch {
      if (owner === user && token === request) {
        superseded = snapshot !== invalidation;
        if (!superseded) { plans.value = []; error.value = 'Could not load meetup status. Try again.'; }
      }
    } finally {
      if (owner === user && token === request) { pending = null; loading.value = false; }
    }
    // An update that arrives during a read must not be lost to its old snapshot.
    // All consumers await the same follow-up read rather than starting duplicates.
    if (superseded && owner === user && token === request) return refreshMeetupSummaries({ force: true });
    return owner === user ? plans.value : [];
  })();
  return pending;
}

async function scopedContext(scope) {
  const user = session(), key = `${user}:${JSON.stringify(scope)}`;
  if (!contexts.has(key)) {
    const promise = api.meetupContext(scope).then(data => data.context);
    contexts.set(key, promise);
    promise.catch(() => { if (contexts.get(key) === promise) contexts.delete(key); });
  }
  return contexts.get(key);
}

function refresh() {
  if (document.visibilityState !== 'visible') return;
  invalidateMeetupSummaries();
  void refreshMeetupSummaries({ force: true });
}

export function useMeetupSummaries() {
  watch(() => currentUser.value?.id, () => { session(); void refreshMeetupSummaries(); }, { immediate: true });
  onMounted(() => {
    if (consumers++ === 0) {
      stopEvents = onChatEvent(type => {
        if (['ready', 'meetup-updated', 'group-members', 'connection-members'].includes(type)) refresh();
      });
      window.addEventListener('focus', refresh);
    }
  });
  onUnmounted(() => {
    if (--consumers === 0) { stopEvents?.(); stopEvents = null; window.removeEventListener('focus', refresh); }
  });
  return { plans, loading, error, revision, refresh };
}

export function useScopedMeetupSummary(scopeSource) {
  const shared = useMeetupSummaries();
  const context = shallowRef(null), contextLoading = ref(false), contextError = ref('');
  const scope = computed(() => normalizeMeetupScope(scopeSource()));
  const scopedPlans = computed(() => {
    if (shared.error.value) return [];
    const matching = meetupsForScope(shared.plans.value, scope.value);
    return matching.length ? matching : context.value?.meetups ?? [];
  });
  const plan = computed(() => preferredMeetup(scopedPlans.value));
  let active = true, sequence = 0;
  watch([() => JSON.stringify(scope.value), () => currentUser.value?.id, shared.revision], async () => {
    const token = ++sequence, user = currentUser.value?.id, selectedScope = scope.value;
    context.value = null; contextError.value = ''; contextLoading.value = false;
    if (!user || !Object.keys(selectedScope).length) return;
    await refreshMeetupSummaries();
    if (!active || sequence !== token || currentUser.value?.id !== user || plan.value || shared.error.value) return;
    contextLoading.value = true;
    try {
      const data = await scopedContext(selectedScope);
      if (active && token === sequence && currentUser.value?.id === user) context.value = data;
    } catch {
      if (active && token === sequence) contextError.value = 'Planning is unavailable, or your membership has changed.';
    } finally { if (active && token === sequence) contextLoading.value = false; }
  }, { immediate: true });
  onUnmounted(() => { active = false; sequence++; });
  return { ...shared, context, plan, scopedPlans,
    statusLoading: computed(() => shared.loading.value || contextLoading.value),
    statusError: computed(() => shared.error.value || contextError.value), scope };
}
