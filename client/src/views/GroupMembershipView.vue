<script setup>
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api.js";
import { currentUser } from "../auth.js";
import PreferenceEditor from "../components/PreferenceEditor.vue";
import LoadingSpinner from "../components/LoadingSpinner.vue";
import GroupNavigation from "../components/GroupNavigation.vue";
import "../assets/groups.css";
const props = defineProps({ id: String, token: String });
const router = useRouter();
const group = ref(null),
  error = ref(""),
  notice = ref(""),
  busy = ref(false),
  savingPreferences = ref(false),
  loading = ref(false),
  link = ref(""),
  friends = ref(0),
  strangerPlaces = ref(0),
  connect = ref(false);
const isHost = computed(() => group.value?.hostId === currentUser.value?.id);
async function load() {
  if (props.id) {
    group.value = (await api.groupMembership(props.id)).group;
    friends.value = group.value.settings?.expected_friends ?? 0;
    strangerPlaces.value = group.value.settings?.stranger_slots ?? group.value.strangerPlaces;
    connect.value = Boolean(group.value.settings?.connect_open);
  }
}
watch(
  () => props.id,
  async () => {
    group.value = null;
    error.value = "";
    loading.value = Boolean(props.id);
    try {
      await load();
    } catch (e) {
      error.value = e.status === 403 ? "Only members can view this group. Use your invitation link to join." : "Could not load this group. It may no longer be available.";
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
async function act(fn, preferences = false) {
  if (busy.value) return;
  busy.value = true;
  savingPreferences.value = preferences;
  error.value = "";
  notice.value = "";
  try {
    await fn();
    await load();
    notice.value = "Saved.";
  } catch (e) {
    error.value = ({
      members_or_preferences_incomplete: "Invite the expected number of friends and ask every member to save their preferences before publishing.",
      expected_friends_below_current_members: "The expected friend count cannot be lower than the friends already in your group.",
      configure_group_first: "Save your group settings before creating an invitation.",
      invitation_unavailable: "This invitation has expired or is no longer available. Ask the host for a new link.",
      invitation_used: "This single-use invitation has already been accepted. Ask the host for a new link.",
      already_in_concert_group: "You already belong to or host a group for this concert.",
      active_matching_proposal_exists: "Review your active matching proposal before joining another group.",
    })[e.message] ?? (e.status === 401 ? "Sign in to manage your group." : "Could not save this change. Review your group settings and try again.");
  } finally {
    busy.value = false;
    savingPreferences.value = false;
  }
}
async function accept() {
  await act(async () => {
    const r = await api.acceptFriendInvite(props.token);
    await router.push(
      `/groups/${encodeURIComponent(r.membership.partyId)}/members`,
    );
  });
}
async function invite() {
  await act(async () => {
    const r = await api.friendInvite(props.id);
    link.value = new URL(r.invitation.path, window.location.origin).href;
  });
}
</script>
<template>
  <div class="container groups-page">
    <header class="group-management-heading">
      <h1>{{ token ? "Join a friend's group" : "Manage group" }}</h1>
      <p v-if="!token" class="group-muted">Manage your members, preferences, invitations and publishing settings.</p>
    </header>
    <GroupNavigation />
    <nav v-if="group" class="group-actions" aria-label="Selected group links">
      <RouterLink :to="`/concerts/${encodeURIComponent(group.concertId)}`">Concert details</RouterLink>
      <RouterLink :to="{path:'/meetups',query:{partyId:id}}">Plan meetup</RouterLink>
      <RouterLink v-if="isHost" :to="{path:'/groups/connect',query:{view:'connections',groupId:id,concertId:group.concertId}}">Connect with other groups</RouterLink>
    </nav>
    <p v-if="error" role="alert" class="group-error">{{ error }}</p>
    <p v-if="notice" role="status" class="group-success">{{ notice }}</p>
    <p v-if="busy && !savingPreferences" class="loading-state" role="status"><LoadingSpinner />Updating your group…</p>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading your group…</p>
    <section v-if="token && !group" class="card group-panel">
      <p>
        Join your friend's group using this invitation.
      </p>
      <button class="btn btn--primary" :disabled="busy" @click="accept">
        Accept invitation
      </button>
    </section>
    <template v-if="group">
      <section class="card group-panel">
        <h2>{{ group.settings?.published ? "Published group" : "Draft group" }}</h2>
        <p>{{ group.settings?.published ? "Your group is published for discovery." : "Your group is not published. Complete the member preferences before publishing." }}</p>
        <p>{{ group.members.filter((m) => m.answered).length }} of {{ group.members.length }} members have saved preferences.</p>
        <ul>
          <li v-for="m in group.members" :key="m.id">{{ m.name }} — {{ m.answered ? "Preferences saved" : "Preferences pending" }}{{ m.id === group.hostId ? " (host)" : "" }}</li>
        </ul>
      </section>
      <form
        v-if="isHost"
        class="card group-panel"
        @submit.prevent="
          act(() =>
            api.configureGroup(id, {
              expectedFriends: friends,
              strangerPlaces,
            }),
          )
        "
      >
        <h2>Group places &amp; friends</h2>
        <label
          >Number of existing friends to invite (excluding you)<input
            v-model.number="friends"
            type="number"
            min="0"
            max="100" /></label
        ><label
          >Places for new companions (zero for friends only)<input
            v-model.number="strangerPlaces"
            type="number"
            min="0"
            max="1000"
        /></label>
        <p>These group places exclude you and your invited friends. Saving changes returns a published group to draft; it does not supply concert tickets.</p>
        <button class="btn btn--ghost" :disabled="busy">
          Save and return to draft
        </button>
      </form>
      <section v-if="group.members.some((m) => m.id === currentUser?.id)" class="card group-panel">
        <h2>Your preferences</h2>
        <PreferenceEditor
          :key="id"
          :initial="group.myAnswers"
          :busy="busy"
          :saving="savingPreferences"
          @save="(answers) => act(() => api.saveMemberPreferences(id, answers), true)"
        />
      </section>
      <section v-if="isHost" class="card group-panel">
        <h2>Invitations &amp; publishing</h2>
        <button
          class="btn btn--ghost"
          :disabled="busy || !group.settings"
          @click="invite"
        >
          Create single-use friend link</button
        ><label v-if="link"
          >Copy and share privately<input
            :value="link"
            readonly
            @focus="$event.target.select()" /></label
        ><label class="group-check"
          ><input v-model="connect" type="checkbox" />Open to meeting other
          groups</label
        ><button
          class="btn btn--primary"
          :disabled="busy || !group.settings"
          @click="act(() => api.publishGroup(id, { connectOpen: connect }))"
        >
          Publish group
        </button>
        <p>All expected friends must join and every member must save their preferences before publishing.</p>
        <button
          class="btn btn--ghost"
          :disabled="busy"
          @click="act(() => api.cancelGroup(id))"
        >
          Cancel group
        </button>
      </section>
      <button
        v-else
        class="btn btn--ghost"
        :disabled="busy"
        @click="act(() => api.leaveGroup(id))"
      >
        Leave group
      </button></template
    >
  </div>
</template>
