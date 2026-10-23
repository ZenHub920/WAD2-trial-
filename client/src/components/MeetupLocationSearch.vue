<script setup>
import { ref } from 'vue';
import { api } from '../api.js';
const props = defineProps({ meetupId: { type: String, required: true }, label: { type: String, default: 'Search a public place or postal code' } });
const emit = defineEmits(['selected']);
const query = ref(''), results = ref([]), busy = ref(false), message = ref('');
async function search() {
  if (busy.value || query.value.trim().length < 2) return;
  busy.value = true; message.value = ''; results.value = [];
  try {
    const { result } = await api.meetupLocations(props.meetupId, query.value.trim());
    if (result.status === 'available') {
      results.value = result.locations;
      if (!results.value.length) message.value = 'No places found. Try a building name, MRT station or postal code.';
      else if (result.stale) message.value = 'Showing a saved address lookup while OneMap is unavailable.';
    } else message.value = 'Address search is unavailable. You can still enter a place and its coordinates below.';
  } catch { message.value = 'Could not search places. Please try again.'; }
  finally { busy.value = false; }
}
function select(location) { emit('selected', location); results.value = []; message.value = `Selected ${location.label}.`; }
</script>
<template>
  <div class="meetup-location-search">
    <label>{{ label }}<input v-model="query" maxlength="100" placeholder="e.g. City Hall MRT" @keydown.enter.prevent="search" /></label>
    <button type="button" class="btn btn--ghost" :disabled="busy || query.trim().length < 2" @click="search">{{ busy ? 'Searching…' : 'Search OneMap' }}</button>
    <p v-if="message" class="group-muted" role="status">{{ message }}</p>
    <ul v-if="results.length" class="meetup-search-results">
      <li v-for="(location, index) in results" :key="index"><button type="button" class="btn btn--ghost" @click="select(location)">{{ location.label }}<small>{{ location.address }}</small></button></li>
    </ul>
  </div>
</template>
<style scoped>
.meetup-location-search { margin-block: 1rem; }
.meetup-search-results { list-style: none; padding: 0; display: grid; gap: .4rem; max-height: 18rem; overflow: auto; }
.meetup-search-results button { display: grid; gap: .25rem; width: 100%; text-align: left; }
.meetup-search-results small { opacity: .7; }
</style>
