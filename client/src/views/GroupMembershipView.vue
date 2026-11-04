<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api.js";
import { useMeetupSummaries } from '../composables/useMeetupSummaries.js';
import { meetupDestination, meetupActionForScope, meetupsForScope } from '../utils/meetupSummaries.js';
import { useConcertEligibility } from '../composables/useConcertEligibility.js';
import { currentUser } from "../auth.js";
import LoadingSpinner from "../components/LoadingSpinner.vue";
import GroupNavigation from "../components/GroupNavigation.vue";
import GroupAvatar from "../components/GroupAvatar.vue";
import AvatarPicker from "../components/AvatarPicker.vue";
import GroupPreferencesGate from "../components/GroupPreferencesGate.vue";
import GroupPrioritiesSummary from "../components/GroupPrioritiesSummary.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import "../assets/groups.css";

const props = defineProps({ id: String, token: String });
const router = useRouter();
const { plans: meetupPlans } = useMeetupSummaries();
const meetupLink = scope => meetupDestination(meetupPlans.value, scope, { from: 'manage-group' });
const meetupLabel = scope => meetupActionForScope(meetupPlans.value, scope);
const settingsPanel = ref(null);
const cancelPrompt = ref(false), leavePrompt = ref(false);
const group = ref(null),
  error = ref(""),
  notice = ref(""),
  refreshWarning = ref(""),
  busy = ref(false),
  saving = ref(false),
  loading = ref(false),
  link = ref(""),
  friends = ref(0),
  strangerPlaces = ref(0),
  connect = ref(false),
  groupNameDraft = ref(""),
  // undefined: unchanged; a data URL: new picture; null: remove the picture.
  pendingImage = ref(undefined),
  // Highlight missing fields only after the first save attempt.
  attempted = ref(false);
const isHost = computed(() => group.value?.hostId === currentUser.value?.id);
const { canCoordinate, isFinished, canPlanMeetup } = useConcertEligibility(() => group.value);
const canStartCoordination = computed(() => canCoordinate.value && group.value?.status !== 'cancelled');
const canOpenMeetup = computed(() => meetupsForScope(meetupPlans.value, { partyId: props.id }).length > 0 || canPlanMeetup.value && group.value?.status !== 'cancelled');
const savedFriends = computed(() => group.value?.settings?.expected_friends ?? 0);
const savedPlaces = computed(() => group.value?.settings?.stranger_slots ?? group.value?.strangerPlaces);
const validCount = (value) => Number.isInteger(value) && value >= 0;
const nameMissing = computed(() => !groupNameDraft.value.trim());
const nameChanged = computed(() => Boolean(group.value) && groupNameDraft.value.trim() !== (group.value.name ?? ""));
const sizeChanged = computed(() => Boolean(group.value) && (!group.value.settings || friends.value !== savedFriends.value || strangerPlaces.value !== savedPlaces.value));
const detailsDirty = computed(() => nameChanged.value || pendingImage.value !== undefined || sizeChanged.value);
const publicationDirty = computed(() => Boolean(group.value) && connect.value !== Boolean(group.value.settings?.connect_open));
const dirty = computed(() => detailsDirty.value || publicationDirty.value);
const publicationLabel = computed(() => group.value?.settings?.published ? 'Save publication settings' : 'Publish group');
const invalid = computed(() => nameMissing.value || !validCount(friends.value) || !validCount(strangerPlaces.value));
watch(invalid, (value) => {
  if (!value && error.value === "Fill in the highlighted fields before saving.") error.value = "";
});
const previewImage = computed(() => pendingImage.value === undefined ? group.value?.imageUrl ?? null : pendingImage.value);
const fieldState = (filled) => ({ "field-ok": filled, "field-error": attempted.value && !filled });
const memberSource = { host: 'Host', friend: 'Friend invitation', join: 'Approved application', proposal: 'Confirmed automatic match' };
let loadVersion = 0, alive = true;
let resolveLeave, leaveDecision;
const stopNavigationGuard = router.beforeEach((to, from) => {
  if (!isHost.value || !dirty.value || to.fullPath === from.fullPath) return true;
  if (!resolveLeave) {
    leavePrompt.value = true;
    leaveDecision = new Promise(resolve => { resolveLeave = resolve; });
  }
  return leaveDecision;
});
function settleLeave(discard) {
  resolveLeave?.(discard);
  resolveLeave = null; leaveDecision = undefined; leavePrompt.value = false;
}
function beforeUnload(event) {
  if (!isHost.value || !dirty.value) return;
  event.preventDefault(); event.returnValue = '';
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload));

async function load() {
  const id = props.id, userId = currentUser.value?.id, version = ++loadVersion;
  if (!id || !userId) return;
  const result = await api.groupMembership(id);
  if (alive && version === loadVersion && props.id === id && currentUser.value?.id === userId) group.value = result.group;
}
/** Resets the editable fields to what is saved. */
function fillDrafts() {
  if (!group.value) return;
  friends.value = savedFriends.value;
  strangerPlaces.value = savedPlaces.value;
  connect.value = Boolean(group.value.settings?.connect_open);
  groupNameDraft.value = group.value.name ?? "";
  pendingImage.value = undefined;
  attempted.value = false;
}
watch(
  [() => props.id, () => currentUser.value?.id],
  async (_values, _previous, onCleanup) => {
    let stale = false;
    onCleanup(() => { stale = true; });
    group.value = null;
    busy.value = false; saving.value = false; cancelPrompt.value = false; settleLeave(false);
    error.value = "";
    notice.value = ""; refreshWarning.value = "";
    loading.value = Boolean(props.id);
    try {
      await load();
      if (!stale) fillDrafts();
    } catch (e) {
      if (!stale) error.value = e.status === 403 ? "Only members can view this group. Use your invitation link to join." : "Could not load this group. It may no longer be available.";
    } finally {
      if (!stale) loading.value = false;
    }
  },
  { immediate: true },
);
onUnmounted(() => { alive = false; loadVersion++; stopNavigationGuard(); settleLeave(false); window.removeEventListener('beforeunload', beforeUnload); });
function actionError(e) {
  return ({
    members_or_preferences_incomplete: "Every expected friend must join, and every member, including the host, must save their preferences in Profile before publishing.",
    expected_friends_below_current_members: "The number of friends can't be lower than the friends already in your group.",
    configure_group_first: "Save your group before creating an invitation.",
    invitation_unavailable: "This invitation has expired or is no longer available. Ask the host for a new link.",
    invitation_used: "This single-use invitation has already been accepted. Ask the host for a new link.",
    already_in_concert_group: "You already belong to or host a group for this concert.",
    active_matching_proposal_exists: "Review your active matching proposal before joining another group.",
    save_group_preferences_first: "Save your private preferences in Profile before joining.",
    invalid_group_name: "Group names can be up to 60 characters.",
    invalid_image: "That file is not a readable image.",
    places_below_active_reservations: "Keep enough spots for current members and held requests. Resolve those reservations before reducing the group size.",
    concert_finished: "This concert day has ended. Existing group information, conversations and meetup history remain available; new publishing and connections are closed.",
    concert_date_unavailable: "A valid concert date is needed before publishing or starting new connections. Your existing group is still available.",
  })[e.message] ?? (e.status === 401 ? "Sign in to manage your group." : "Could not save this change. Review your group and try again.");
}
async function act(fn, done = "Saved.") {
  if (busy.value) return false;
  const id = props.id, userId = currentUser.value?.id;
  const current = () => alive && props.id === id && currentUser.value?.id === userId;
  busy.value = true;
  error.value = "";
  notice.value = ""; refreshWarning.value = "";
  try {
    await fn();
    if (!current()) return false;
    notice.value = done;
    try { await load(); }
    catch { if (current()) refreshWarning.value = "The change was saved, but the latest group details could not be loaded. Retry the refresh before making another change."; }
    return true;
  } catch (e) {
    if (!current()) return false;
    error.value = actionError(e);
    return false;
  } finally {
    if (current()) busy.value = false;
  }
}
const draftSnapshot = () => JSON.stringify([friends.value, strangerPlaces.value, groupNameDraft.value, pendingImage.value, connect.value]);
watch(draftSnapshot, () => { notice.value = ''; }, { flush: 'sync' });
async function retryRefresh() {
  if (busy.value) return;
  const snapshot = draftSnapshot(), id = props.id, userId = currentUser.value?.id;
  const pendingPublication = publicationDirty.value, connectDraft = connect.value;
  busy.value = true;
  try {
    await load();
    if (!alive || props.id !== id || currentUser.value?.id !== userId) return;
    refreshWarning.value = "";
    if (draftSnapshot() === snapshot) { fillDrafts(); if (pendingPublication) connect.value = connectDraft; }
  } catch { /* Keep the saved outcome and the contextual refresh warning. */ }
  finally { if (alive && props.id === id && currentUser.value?.id === userId) busy.value = false; }
}
async function saveAll() {
  if (busy.value || !detailsDirty.value) return;
  attempted.value = true;
  if (invalid.value) {
    if (settingsPanel.value) settingsPanel.value.open = true;
    error.value = "Fill in the highlighted fields before saving.";
    notice.value = "";
    return;
  }
  const id = props.id, userId = currentUser.value?.id;
  const current = () => alive && props.id === id && currentUser.value?.id === userId;
  const saved = [];
  saving.value = true; busy.value = true; error.value = ''; notice.value = ''; refreshWarning.value = '';
  try {
    if (nameChanged.value) {
      const name = groupNameDraft.value.trim();
      await api.renameGroup(id, name); if (!current()) return;
      group.value = { ...group.value, name }; saved.push('name');
    }
    if (pendingImage.value !== undefined) {
      const image = pendingImage.value;
      if (image) await api.setGroupImage(id, image); else await api.clearGroupImage(id);
      if (!current()) return;
      group.value = { ...group.value, imageUrl: image }; pendingImage.value = undefined; saved.push('picture');
    }
    if (sizeChanged.value) {
      const expectedFriends = friends.value, places = strangerPlaces.value;
      await api.configureGroup(id, { expectedFriends, strangerPlaces: places }); if (!current()) return;
      group.value = { ...group.value, settings: { ...group.value.settings, expected_friends: expectedFriends, stranger_slots: places, published: false } };
      saved.push('size');
    }
    notice.value = publicationDirty.value ? 'Group details saved. Your publication setting is still unsaved; use the publication button above.' : 'All changes saved.';
    try { await load(); }
    catch { if (current()) refreshWarning.value = 'The change was saved, but the latest group details could not be loaded. Retry the refresh before making another change.'; }
  } catch (e) {
    if (!current()) return;
    if (saved.length) notice.value = `Saved ${saved.join(' and ')}. Other changes are still unsaved.`;
    error.value = `${saved.length ? 'Remaining changes were not saved. ' : ''}${actionError(e)}`;
  } finally {
    if (current()) { saving.value = false; busy.value = false; }
  }
}
async function publish() {
  if (busy.value || detailsDirty.value) return;
  const connectOpen = connect.value, id = props.id, userId = currentUser.value?.id;
  await act(async () => {
    await api.publishGroup(id, { connectOpen });
    if (!alive || props.id !== id || currentUser.value?.id !== userId) return;
    group.value = { ...group.value, settings: { ...group.value.settings, published: true, connect_open: connectOpen } };
  }, group.value.settings?.published ? 'Publication settings saved.' : 'Group published.');
}
async function cancelGroup() {
  const id = props.id, userId = currentUser.value?.id;
  const ok = await act(async () => {
    await api.cancelGroup(id);
    if (!alive || props.id !== id || currentUser.value?.id !== userId) return;
    group.value = { ...group.value, status: 'cancelled' };
  }, 'Group cancelled.');
  if (ok) { cancelPrompt.value = false; fillDrafts(); notice.value = 'Group cancelled.'; }
}
async function accept() {
  await act(async () => {
    const r = await api.acceptFriendInvite(props.token);
    await router.push(`/groups/${encodeURIComponent(r.membership.partyId)}/members`);
  });
}
async function invite() {
  await act(async () => {
    const r = await api.friendInvite(props.id);
    link.value = new URL(r.invitation.path, window.location.origin).href;
  }, "Invitation link created.");
}
async function leave() {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = ''; refreshWarning.value = '';
  try {
    const concertId = group.value.concertId;
    await api.leaveGroup(props.id);
    await router.push({ path: '/groups', query: { concertId } });
  } catch (err) { error.value = err.status === 401 ? 'Sign in to manage your membership.' : 'Could not leave this group. Refresh and try again.'; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="container groups-page">
    <GroupNavigation class="groups-page__nav" />
    <header class="group-management-heading">
      <div v-if="group" class="group-identity">
        <GroupAvatar :src="previewImage" :name="groupNameDraft || group.name || group.artist || ''" :size="64" />
        <div>
          <h1>{{ group.name || group.artist || "Manage group" }}</h1>
          <p class="group-muted">{{ group.name && group.artist ? `${group.artist} · ` : "" }}{{ isHost ? "Manage your group's details, members and invitations." : "Your group's members." }}</p>
        </div>
      </div>
      <template v-else>
        <h1>{{ token ? "Join a friend's group" : "Manage group" }}</h1>
        <p v-if="!token" class="group-muted">Manage your group's details, members and invitations.</p>
      </template>
    </header>
    <GroupPreferencesGate @saved="load">
      <section v-if="group" class="member-workspace" aria-label="Selected group links">
        <div class="member-workspace__context"><p class="member-eyebrow">Your group workspace · <RouterLink class="member-workspace__concert" :to="`/concerts/${encodeURIComponent(group.concertId)}`">View concert</RouterLink></p><strong>{{ canStartCoordination ? 'From meeting the group to making a plan.' : 'Your group, conversations and previous plans.' }}</strong><p>{{ canStartCoordination ? 'Compare availability, choose a meeting point and coordinate your concert day.' : 'Return to your group conversation or review an existing meetup. Your saved group information remains available.' }}</p></div>
        <div class="member-workspace__primary">
          <button v-if="canOpenMeetup" type="button" class="btn btn--primary" @click="router.push(meetupLink({ partyId: id }))">{{ canPlanMeetup ? meetupLabel({ partyId: id }) : 'View meetup history' }}</button>
          <RouterLink class="btn btn--ghost" :to="`/groups/${encodeURIComponent(id)}/channel`">Messages</RouterLink>
        </div>
        <nav v-if="isHost" class="member-workspace__links" aria-label="Host tools">
          <span class="member-workspace__links-label">Host tools</span>
          <RouterLink v-if="isHost && canStartCoordination" :to="{path:'/groups/connect',query:{view:'connections',groupId:id,concertId:group.concertId}}">Connect with other groups</RouterLink>
          <RouterLink v-if="isHost" :to="{path:'/groups/connect',query:{concertId:group.concertId},hash:'#join-requests'}">Review join applications</RouterLink>
        </nav>
      </section>
      <p v-if="group && isHost && !group.settings" class="group-muted" role="status">Your draft group exists. Save its settings below to finish setup before inviting friends or publishing.</p>
      <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading your group…</p>
      <section v-if="token && !group" class="card group-panel">
        <p>Join your friend's group using this invitation. Your saved profile preferences contribute to the group's shared preferences; your individual answers stay private.</p>
        <p v-if="error" role="alert" class="group-error">{{ error }}</p>
        <button class="btn btn--success" :disabled="busy" @click="accept">Accept invitation</button>
      </section>
      <p v-else-if="error && !isHost" role="alert" class="group-error">{{ error }}</p>
      <template v-if="group">
        <section class="card group-panel member-roster">
          <div class="section-row">
            <h2>Members ({{ group.members.length }})</h2>
            <span class="group-state" :class="{ 'group-state--published': group.settings?.published && canStartCoordination }">{{ group.status === 'cancelled' ? 'Cancelled' : isFinished ? 'Past concert' : group.settings?.published ? "Published" : "Draft" }}</span>
          </div>
          <p v-if="group.status === 'cancelled'" class="group-muted" role="status">This group was cancelled. Available group history remains here; new publishing, connections and planning are closed.</p>
          <p v-else-if="isFinished" class="group-muted" role="status">This concert day has ended. Your group information, conversations and previous meetup plans remain available. New publishing and group connections are closed.</p>
          <p v-else-if="!canCoordinate" class="group-muted" role="status">A valid concert date is needed before publishing or starting new connections. Existing group information remains available.</p>
          <p v-else class="group-muted">{{ group.settings?.published ? "Your group is visible to people looking for a group." : "Only members can see this group until it's published." }}</p>
          <p v-if="group.remainingCapacity != null && canStartCoordination" class="group-muted">{{ group.remainingCapacity }} companion spots remaining</p>
          <ul class="member-roster__list">
            <li v-for="m in group.members" :key="m.id"><div><RouterLink :to="`/people/${encodeURIComponent(m.id)}`">{{ m.name }}</RouterLink><span class="group-muted">{{ memberSource[m.source] ?? 'Member' }}</span></div><span class="member-roster__readiness" :class="{'member-roster__readiness--missing':!m.answered}">{{ m.answered ? 'Preferences saved' : 'Preferences missing' }}</span></li>
          </ul>
        </section>

        <section class="card group-panel" aria-labelledby="group-priorities-heading">
          <h2 id="group-priorities-heading">What represents your group?</h2>
          <p class="group-muted">The group's shared preferences come from members' saved profiles, rather than the host's choices alone.</p>
          <GroupPrioritiesSummary :profile="group.profile" />
          <RouterLink to="/profile#preferences">Update your private preferences <span aria-hidden="true">→</span></RouterLink>
        </section>

        <template v-if="isHost">
          <details ref="settingsPanel" class="member-settings" :open="!group.settings?.published">
            <summary><div><p class="member-eyebrow">Host controls</p><strong>Group settings</strong><span>Name, picture and spots for friends or new companions</span></div><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg></summary>
            <div class="member-settings__content">
          <section class="card group-panel" aria-labelledby="group-identity-heading">
            <h2 id="group-identity-heading">Group name &amp; picture</h2>
            <label><span id="group-name-label">Group name</span>
              <input v-model="groupNameDraft" aria-labelledby="group-name-label" :aria-describedby="attempted && nameMissing ? 'group-name-error' : undefined" maxlength="60" placeholder="e.g. Front Row Crew" :disabled="busy" :class="fieldState(!nameMissing)" :aria-invalid="attempted && nameMissing" />
              <span v-if="attempted && nameMissing" id="group-name-error" class="field-message">Enter a name for your group.</span>
            </label>
            <AvatarPicker :src="previewImage" :name="groupNameDraft" :busy="busy" :size="72"
              @select="(image) => (pendingImage = image)" @remove="pendingImage = null">
              <template #preview><GroupAvatar :src="previewImage" :name="groupNameDraft || group.artist || ''" :size="72" /></template>
            </AvatarPicker>
          </section>

          <section class="card group-panel" aria-labelledby="group-size-heading">
            <h2 id="group-size-heading">Group size</h2>
            <div class="size-row">
              <div>
                <strong id="friends-label">Friends you'll invite</strong>
                <p class="group-muted">People you already know. You'll get a link to send them below.</p>
                <span v-if="attempted && !validCount(friends)" class="field-message">Enter a number, 0 or more.</span>
              </div>
              <div class="stepper" role="group" aria-labelledby="friends-label">
                <button type="button" class="stepper__btn" :disabled="busy || !(friends > 0)" aria-label="One fewer friend" @click="friends--">−</button>
                <input v-model.number="friends" type="number" min="0" max="100" aria-labelledby="friends-label" :disabled="busy" :class="fieldState(validCount(friends))" />
                <button type="button" class="stepper__btn" :disabled="busy || friends >= 100" aria-label="One more friend" @click="friends = (validCount(friends) ? friends : 0) + 1">+</button>
              </div>
            </div>
            <div class="size-row">
              <div>
                <strong id="strangers-label">Spots for new people</strong>
                <p class="group-muted">Open spots that other concert-goers can join. Set to 0 to keep it friends only.</p>
                <span v-if="attempted && !validCount(strangerPlaces)" class="field-message">Enter a number, 0 or more.</span>
              </div>
              <div class="stepper" role="group" aria-labelledby="strangers-label">
                <button type="button" class="stepper__btn" :disabled="busy || !(strangerPlaces > 0)" aria-label="One fewer spot" @click="strangerPlaces--">−</button>
                <input v-model.number="strangerPlaces" type="number" min="0" max="1000" aria-labelledby="strangers-label" :disabled="busy" :class="fieldState(validCount(strangerPlaces))" />
                <button type="button" class="stepper__btn" :disabled="busy || strangerPlaces >= 1000" aria-label="One more spot" @click="strangerPlaces = (validCount(strangerPlaces) ? strangerPlaces : 0) + 1">+</button>
              </div>
            </div>
            <p v-if="group.settings?.published && sizeChanged && canStartCoordination" class="size-warning" role="note">
              Your group is published. Saving a new size hides it until you publish again.
            </p>
          </section>
            </div>
          </details>

          <section class="card group-panel member-publish">
            <h2>{{ canStartCoordination ? 'Invite friends & publish' : 'Friend invitations & group management' }}</h2>
            <details class="member-invite-tools">
              <summary>Create a friend invitation <span>Single-use link</span></summary>
              <div class="member-invite-tools__content">
            <button class="btn btn--ghost" :disabled="busy || !group.settings || detailsDirty || group.status === 'cancelled'" @click="invite">Create single-use friend link</button>
            <p v-if="!group.settings || detailsDirty" class="group-muted">Save your group details before creating an invitation link.</p>
            <label v-if="link">Copy and share privately<input :value="link" readonly @focus="$event.target.select()" /></label>
              </div>
            </details>
            <label v-if="canStartCoordination" class="group-check"><input v-model="connect" type="checkbox" :disabled="busy" />Open to meeting other groups</label>
            <p v-if="canStartCoordination" class="group-muted">{{ publicationDirty ? `Publication setting not saved. Use ${publicationLabel.toLowerCase()} to apply it.` : group.settings?.published ? 'Publication settings are saved.' : 'Publish when every expected friend has joined and every member has saved preferences.' }} Group details are saved separately below.</p>
            <p v-if="detailsDirty" class="group-muted">Save your group details below before publishing or updating publication settings.</p>
            <div class="group-actions">
              <button v-if="canStartCoordination" class="btn btn--primary" :disabled="busy || !group.settings || detailsDirty || (group.settings.published && !publicationDirty)" @click="publish">{{ publicationLabel }}</button>
              <button v-if="group.status !== 'cancelled'" class="btn btn--danger" :disabled="busy" @click="cancelPrompt = true">Cancel group</button>
            </div>
          </section>

          <!-- Group details and publication have separately labelled save actions. -->
          <div class="save-bar" :class="{ 'save-bar--dirty': dirty }">
            <p v-if="error" class="group-error" role="alert">{{ error }}</p>
            <p v-if="notice" class="group-success" role="status">{{ notice }}</p>
            <template v-if="!error && !notice"><p v-if="detailsDirty" class="group-muted">You have unsaved group details.</p>
            <p v-else-if="publicationDirty" class="group-muted">Publication setting not saved. Use {{ publicationLabel.toLowerCase() }} above.</p>
            <p v-else class="group-muted">No unsaved changes.</p></template>
            <button v-if="dirty" type="button" class="btn btn--ghost" :disabled="busy" @click="fillDrafts">Discard</button>
            <button type="button" class="btn btn--primary save-bar__save" :disabled="busy || !detailsDirty" @click="saveAll">
              <LoadingSpinner v-if="saving" />{{ saving ? "Saving…" : "Save changes" }}
            </button>
          </div>
          <p v-if="refreshWarning" class="group-muted" role="status">{{ refreshWarning }} <button type="button" class="btn btn--ghost" :disabled="busy" @click="retryRefresh">Retry refresh</button></p>
        </template>
        <button v-else class="btn btn--danger-ghost" :disabled="busy" @click="leave">Leave group</button>
      </template>
    </GroupPreferencesGate>
    <ConfirmDialog :open="cancelPrompt" title="Cancel this group?" body="The group will stop accepting members and connections. Pending requests and automatic offers will be cancelled, friend invitation links will stop working, and members will leave the active group. Your group record stays in your history. This action cannot be undone." confirm-label="Cancel group" cancel-label="Keep group" initial-focus="cancel" danger :busy="busy" @cancel="cancelPrompt = false" @confirm="cancelGroup" />
    <ConfirmDialog :open="leavePrompt" title="Leave with unsaved group settings?" body="Your group details or publication setting have not been saved. Leaving discards these drafts. Any change already sent may still complete." confirm-label="Discard changes and leave" cancel-label="Keep editing" initial-focus="cancel" danger @cancel="settleLeave(false)" @confirm="settleLeave(true)" />
  </div>
</template>

<style scoped>
.member-eyebrow { margin:0 0 var(--space-1); font:600 .68rem var(--font-mono); letter-spacing:.08em; text-transform:uppercase; color:var(--accent-400); }
.member-workspace { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:var(--space-4); padding:var(--space-5); border:1px solid color-mix(in srgb,var(--accent-400) 36%,var(--panel-edge)); border-radius:var(--radius-lg); background:var(--panel-bg); box-shadow:var(--panel-shadow); }
.member-workspace__context > p:last-child { margin-top:var(--space-2); max-width:58ch; color:var(--text-300); font-size:var(--step--1); }
.member-workspace__context strong { color:var(--text-100); }
.member-workspace__primary { display:flex; flex-wrap:wrap; gap:var(--space-2); }
.member-workspace__links { grid-column:1/-1; display:flex; flex-wrap:wrap; gap:var(--space-2) var(--space-5); padding-top:var(--space-3); border-top:var(--border-hairline); font-size:var(--step--1); }
.member-workspace__links-label { color:var(--text-300); font-size:var(--step--2); text-transform:uppercase; letter-spacing:.08em; }
.member-workspace__concert { text-transform:none; letter-spacing:normal; font-weight:500; }
.member-workspace__links a { display:inline-flex; align-items:center; min-height:32px; text-underline-offset:.25em; }
.member-roster__list { display:grid; gap:var(--space-2); margin:0; padding:0; list-style:none; }
.member-roster__list li { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:var(--space-2) var(--space-4); padding:var(--space-3) var(--space-4); border:var(--border-hairline); border-radius:var(--radius-sm); background:var(--ink-900); }
.member-roster__list li > div { display:grid; gap:2px; min-width:0; }
.member-roster__list li a { font-weight:650; overflow-wrap:anywhere; }
.member-roster__list li .group-muted { font-size:var(--step--2); }
.member-roster__readiness { color:var(--mint-400); font-size:var(--step--2); }
.member-roster__readiness--missing { color:var(--amber-400); }
.member-settings { border:1px solid var(--panel-edge); border-radius:var(--radius-lg); background:var(--ink-850); }
.member-settings > summary { display:flex; align-items:center; justify-content:space-between; gap:var(--space-3); padding:var(--space-4) var(--space-5); list-style:none; cursor:pointer; }
.member-settings > summary::-webkit-details-marker { display:none; }
.member-settings summary strong { color:var(--text-100); }
.member-settings summary span { display:block; margin-top:var(--space-1); color:var(--text-300); font-size:var(--step--1); }
.member-settings summary svg { width:20px; height:20px; flex:none; stroke:var(--accent-400); stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; transition:transform var(--dur-base) var(--ease-settle); }
.member-settings[open] > summary svg { transform:rotate(180deg); }
.member-settings__content { display:grid; gap:var(--space-4); padding:0 var(--space-4) var(--space-4); }
.member-settings__content > .card { box-shadow:none; }
.member-publish { border-left:3px solid var(--accent-400); }
.member-invite-tools { padding:var(--space-3) var(--space-4); border:var(--border-hairline); border-radius:var(--radius-md); background:var(--ink-900); }
.member-invite-tools summary { cursor:pointer; color:var(--text-200); font-size:var(--step--1); }
.member-invite-tools summary span { margin-left:var(--space-2); color:var(--text-400); font-size:var(--step--2); }
.member-invite-tools__content { display:grid; gap:var(--space-3); justify-items:start; padding-top:var(--space-4); }
.member-invite-tools__content > label { width:100%; }
@media(max-width:680px) { .member-workspace { grid-template-columns:minmax(0,1fr); padding:var(--space-4); } .member-workspace__primary .btn { flex:1; } .member-settings > summary { padding:var(--space-4); } .member-settings__content { padding-inline:var(--space-3); } }
@media(prefers-reduced-motion:reduce) { .member-settings summary svg { transition:none; } }
</style>
