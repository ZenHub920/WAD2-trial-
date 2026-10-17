<script setup>
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api.js";
import { currentUser } from "../auth.js";
import PreferenceEditor from "../components/PreferenceEditor.vue";
import "../assets/groups.css";
const props = defineProps({ id: String, token: String });
const router = useRouter();
const group = ref(null),
  error = ref(""),
  notice = ref(""),
  busy = ref(false),
  link = ref(""),
  friends = ref(0),
  strangerPlaces = ref(0),
  connect = ref(false);
const isHost = computed(() => group.value?.hostId === currentUser.value?.id);
async function load() {
  if (props.id) {
    group.value = (await api.groupMembership(props.id)).group;
    friends.value = group.value.settings?.expected_friends ?? 0;
    strangerPlaces.value = group.value.strangerPlaces;
    connect.value = Boolean(group.value.settings?.connect_open);
  }
}
watch(
  () => props.id,
  async () => {
    try {
      await load();
    } catch (e) {
      error.value = e.message;
    }
  },
  { immediate: true },
);
async function act(fn) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await fn();
    await load();
    notice.value = "Saved.";
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
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
  <main class="container groups-page">
    <h1>Your group</h1>
    <nav class="group-actions">
      <RouterLink to="/groups">Find a Group</RouterLink
      ><RouterLink to="/groups/connect">Connect Groups</RouterLink>
    </nav>
    <p v-if="error" role="alert" class="group-error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <section v-if="token && !group" class="card group-panel">
      <p>
        Join your friend's group using this invitation.
      </p>
      <button class="btn btn--primary" :disabled="busy" @click="accept">
        Accept invitation
      </button>
    </section>
    <template v-if="group"
      ><p>
        {{ group.members.filter((m) => m.answered).length }} of
        {{ group.members.length }} members answered.
      </p>
      <ul>
        <li v-for="m in group.members" :key="m.id">
          {{ m.name }},
          {{ m.answered ? "Answered" : "Preferences pending" }}
        </li>
      </ul>
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
        <p>These places exclude you and your invited friends.</p>
        <button class="btn btn--ghost" :disabled="busy">
          Save and return to draft
        </button>
      </form>
      <PreferenceEditor
        v-if="group.members.some((m) => m.id === currentUser?.id)"
        :key="id"
        :initial="group.myAnswers"
        :busy="busy"
        @save="(answers) => act(() => api.saveMemberPreferences(id, answers))"
      />
      <section v-if="isHost" class="card group-panel">
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
        <p>Everyone must answer before publishing.</p>
        <p>{{ group.settings?.published ? "Published" : "Draft" }}</p>
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
  </main>
</template>
