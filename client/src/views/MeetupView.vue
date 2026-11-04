<script setup>
import LoadingSpinner from '../components/LoadingSpinner.vue';
import BackArrow from '../components/BackArrow.vue';
import MeetupOverview from '../components/MeetupOverview.vue';
import MeetupLocationSearch from '../components/MeetupLocationSearch.vue';
import MeetupAvailabilityGrid from '../components/MeetupAvailabilityGrid.vue';
import MeetupTransportPanel from '../components/MeetupTransportPanel.vue';
import MeetupCreationForm from '../components/MeetupCreationForm.vue';
import MeetupDiscussionPanel from '../components/MeetupDiscussionPanel.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { useMeetupBoard } from '../composables/useMeetupBoard.js';
import '../assets/groups.css';
const props = defineProps({ id: String });
const {
  route, router, currentUser, context, board, boards, error, busy, loading, creationContext,
  scope, hasActiveBoards, showCreation, creatingAdditional, returnRoute, returnLabel, proposalLabel, proposalGuidance, approvalGuidance,
  weather, rainfall, travelRecommendations, transport, comment, slots, place, position, travelOptions,
  feedback, failures, placeSearchKey, confirmAction, capabilities, contributionsLocked, selectedOrigins,
  journeySearchKey, leavePrompt, settleLeave, journeyDirty,
  selectPlace, selectJourney, invalidatePlace, invalidateJourney, editPlace, editJourney,
  selectedSlotCount, bestSavedOverlap, selectedTimes, activeStep, availabilityDirty, refreshing, syncNote,
  liveLabel, statuses, time, validCoordinates, recommendedOptions, hasSavedAvailability, recommendationEmpty,
  refreshPlanner, showStep, navigateSteps, create, saveAvailability, discardAvailability, assignJourney,
  addPlace, vote, propose, approve, requestOrganizerAction, organizerAction, postComment, getWeather, getTravelSuggestions, getParking,
 } = useMeetupBoard(props);
</script>
<template>
  <div class="container groups-page meetup-page" :class="{ 'meetup-page--board': board }">
    <BackArrow class="back-link" :to="returnRoute" :label="returnLabel" />
    <header class="page-banner">
      <h1>{{ board?.title ?? (Object.keys(scope).length ? "Plan with your conversation" : "My meetups") }}</h1>
      <p>{{ board ? "Find a time together, compare places and agree on the plan." : "Your concert plans, required approvals and next steps in one place." }}</p>
    </header>
    <nav v-if="id" class="group-actions">
      <button type="button" class="btn btn--ghost" @click="router.push('/meetups')">All plans</button>
      <button type="button" class="btn btn--ghost" :disabled="refreshing || busy" @click="refreshPlanner">Refresh planner</button>
      <span class="meetup-live" role="status"><span aria-hidden="true"></span>{{ liveLabel }}{{ refreshing ? ' · Updating…' : '' }}</span>
    </nav>
    <p v-if="error" class="group-error" role="alert">{{ error }}</p>
    <p v-if="busy" class="loading-state" role="status"><LoadingSpinner />Updating your meetup plan…</p>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading meetup plans…</p>
    <template v-else-if="!id"
      ><p>
        Plan a meetup with your group or a mutual companion match.
      </p>
      <div v-if="creationContext" class="meetup-overview-context"><strong>{{ creationContext.concert?.artist }}</strong><span>{{ creationContext.scopeLabel }}</span><RouterLink v-if="hasActiveBoards" to="/meetups">All my meetup plans</RouterLink></div>
      <MeetupOverview :plans="boards" :scoped="Boolean(creationContext)" :from="route.query.from" />
      <p v-if="creationContext?.policy?.canSchedule === false" class="meetup-role-note" role="status">No future pre-concert meeting window remains. Existing plans and conversations stay available.</p>
      <div v-if="creationContext?.capabilities.canCreate && creationContext.policy?.canSchedule !== false && hasActiveBoards" class="meetup-additional-plan"><p>Continue an existing plan above. Need a genuinely separate arrangement?</p><button type="button" class="btn btn--ghost" :disabled="busy" :aria-expanded="creatingAdditional" aria-controls="meetup-creation-area" @click="creatingAdditional = !creatingAdditional">{{ creatingAdditional ? 'Keep existing plans' : 'Create a separate plan' }}</button></div>
      <div id="meetup-creation-area"><MeetupCreationForm v-if="showCreation" :key="context()" :context="creationContext" :additional-plan="hasActiveBoards" :busy="busy" :error="failures.creation" @submit="create" /></div>
      <p v-if="creationContext && !creationContext.capabilities.canCreate && !boards.length" class="meetup-role-note">Your group host creates the planning board. You can contribute availability, places and discussion once it is open.</p>
      <p v-if="!boards.length && !error && creationContext?.policy?.canSchedule !== false">No meetup plans yet. Start a plan from your group or an active companion conversation.</p>
      </template>
    <template v-else-if="board"
      ><div class="meetup-context"><span>{{ board.participantCount }} participants</span><strong>{{ statuses[board.status] ?? "Plan updated" }}</strong></div>
      <section v-if="board.status === 'proposed' || board.status === 'confirmed'" class="meetup-role-note meetup-recovery" aria-label="Planning is locked">
        <p>{{ board.status === 'confirmed' ? 'This plan is confirmed.' : 'This proposal is awaiting organizer approval.' }} Availability, suggestions and votes stay locked to protect the agreed version. Discussion stays open.</p>
        <p v-if="capabilities.canReopen">Need to change it? {{ board.status === 'proposed' ? 'Withdraw this proposal' : 'Reopen planning' }} to keep everyone’s contributions and choose again. A revised proposal needs fresh approvals.</p>
        <p v-else>Ask an organizer to reopen planning before changing availability, places or votes.</p>
        <div v-if="activeStep !== 'review'" class="group-actions"><button type="button" class="btn btn--ghost" @click="showStep('review')">View the {{ board.status === 'confirmed' ? 'confirmed plan' : 'proposal' }}</button><button v-if="capabilities.canReopen" type="button" class="btn btn--primary" :disabled="busy" @click="requestOrganizerAction('reopen')">{{ board.status === 'proposed' ? 'Withdraw proposal and reopen planning' : 'Reopen planning' }}</button></div>
      </section>
      <p v-else-if="board.status === 'planning' && !capabilities.isOrganizer" class="group-muted">Share your availability, suggest places and vote. Your group host chooses and confirms the final plan.</p>
      <nav class="meetup-steps" role="tablist" aria-label="Meeting planning steps">
        <button id="meetup-tab-availability" type="button" role="tab" data-planner-step="availability" aria-controls="meetup-availability" :aria-selected="activeStep === 'availability'" :tabindex="activeStep === 'availability' ? 0 : -1" @click="showStep('availability')" @keydown="navigateSteps"><span>1</span><strong>Find a time</strong><small>Paint your availability</small></button>
        <button id="meetup-tab-places" type="button" role="tab" data-planner-step="places" aria-controls="meetup-places" :aria-selected="activeStep === 'places'" :tabindex="activeStep === 'places' ? 0 : -1" @click="showStep('places')" @keydown="navigateSteps"><span>2</span><strong>Choose a place</strong><small>Compare everyone's journey</small></button>
        <button id="meetup-tab-review" type="button" role="tab" data-planner-step="review" aria-controls="meetup-review" :aria-selected="activeStep === 'review'" :tabindex="activeStep === 'review' ? 0 : -1" @click="showStep('review')" @keydown="navigateSteps"><span>3</span><strong>Agree on the plan</strong><small>Discuss, approve and travel</small></button>
      </nav>
      <p v-if="syncNote" class="group-muted" role="status">{{ syncNote }}</p>
      <section id="meetup-availability" v-show="activeStep === 'availability'" role="tabpanel" aria-labelledby="meetup-tab-availability" class="card group-panel meetup-availability meetup-workspace">
        <span class="meetup-eyebrow">01 / Your availability</span>
        <h2>When are you available?</h2>
        <p class="group-muted">Mark your free times. Stronger green means more people can make it.</p>
        <div class="meetup-availability__summary"><strong>{{ selectedSlotCount }} half-hour {{ selectedSlotCount === 1 ? 'block' : 'blocks' }} selected</strong><span :class="{ 'meetup-unsaved': availabilityDirty }">{{ availabilityDirty ? 'Unsaved changes' : 'Your saved availability' }}</span></div>
        <div class="meetup-time-layout">
          <MeetupAvailabilityGrid :grid="board.grid" :participant-count="board.participantCount" v-model:selected="selectedTimes" :disabled="busy || contributionsLocked" />
          <aside class="meetup-time-context" aria-labelledby="meetup-group-availability-heading">
            <h3 id="meetup-group-availability-heading">Group availability</h3>
            <p class="group-muted">{{ board.participantCount }} {{ board.participantCount === 1 ? 'person' : 'people' }} on this plan</p>
            <dl class="meetup-time-context__metrics">
              <div><dt>Your selected time</dt><dd><strong>{{ selectedSlotCount / 2 }}</strong> {{ selectedSlotCount === 2 ? 'hour' : 'hours' }}<span>{{ availabilityDirty ? 'In your unsaved draft' : 'In your saved availability' }}</span></dd></div>
              <div><dt>Most overlap saved</dt><dd v-if="bestSavedOverlap"><strong>{{ bestSavedOverlap.availableCount }}<small>/{{ board.participantCount }}</small></strong> available together<span>{{ time(bestSavedOverlap.startsAt) }}</span></dd><dd v-else class="meetup-time-context__empty">No available times saved yet.</dd></div>
            </dl>
            <p class="meetup-time-context__note">Group totals reflect saved answers. Your painted times join the grid when you save.</p>
          </aside>
        </div>
        <details class="meetup-disclosure meetup-journey">
          <summary>Your journey to the meetup <span>Optional &middot; Private starting place</span></summary>
          <p class="group-muted">Use an approximate public place, building, MRT station or postal code. Your starting location stays private.</p>
          <fieldset class="meetup-travel-fields" :disabled="busy || contributionsLocked">
            <label>Travel method<select v-model="position.travelMode"><option value="transit">Public transport</option><option value="drive">Car</option></select></label>
            <MeetupLocationSearch :meetup-id="id" :reset-key="journeySearchKey" label="Find your approximate starting place" :disabled="busy || contributionsLocked" selection-hint="To use this selection, apply journey to selected times, then save availability and journey." @selected="selectJourney" @selection-invalidated="invalidateJourney" />
            <details class="meetup-manual-entry"><summary>Advanced/manual entry</summary>
              <div class="group-controls">
                <label>Location label<input v-model="position.label" maxlength="100" placeholder="e.g. nearby MRT station" @input="editJourney('label')" /></label>
                <label>Latitude<input v-model="position.latitude" type="number" min="-90" max="90" step="any" placeholder="No location supplied" @input="editJourney('latitude')" /></label>
                <label>Longitude<input v-model="position.longitude" type="number" min="-180" max="180" step="any" placeholder="No location supplied" @input="editJourney('longitude')" /></label>
              </div>
            </details>
            <button type="button" class="btn btn--ghost" :disabled="busy || contributionsLocked || !selectedSlotCount" @click="assignJourney">Apply journey to selected times</button>
            <p v-if="!selectedSlotCount" class="group-muted">Paint or select times in the grid first, then apply your journey.</p>
            <p v-if="journeyDirty" class="meetup-unsaved" role="status">Journey input has not been applied. Apply it to selected times before saving.</p>
            <p v-if="feedback.journey" class="group-success" role="status">{{ feedback.journey }}</p>
            <p v-if="failures.journey" class="group-error" role="alert">{{ failures.journey }}</p>
          </fieldset>
        </details>
        <p class="group-muted meetup-journey-summary">{{ selectedOrigins }} of {{ selectedSlotCount }} selected times have a private starting location. {{ availabilityDirty ? 'Draft changes are not saved yet.' : 'Showing your saved availability and journey.' }}</p>
        <p v-if="feedback.availability" class="group-success" role="status">{{ feedback.availability }}</p>
        <p v-if="failures.availability" class="group-error" role="alert">{{ failures.availability }}</p>
        <p class="meetup-save-state" role="status">{{ busy ? 'An update is in progress.' : failures.availability ? 'Availability was not saved. Your draft is kept.' : availabilityDirty ? 'Unsaved availability. Save to share it with your group.' : 'Showing your saved availability.' }}</p>
        <div class="group-actions meetup-save-bar">
        <button
          class="btn btn--primary"
          :disabled="busy || contributionsLocked"
          @click="saveAvailability"
        >
          {{ busy ? 'Updating…' : 'Save availability and journey' }}
        </button>
        <button v-if="availabilityDirty" type="button" class="btn btn--ghost" :disabled="busy" @click="discardAvailability">Discard my changes</button>
        <button type="button" class="btn btn--ghost" @click="showStep('places')">Continue to places <span aria-hidden="true">→</span></button>
        </div>
        <p class="group-muted meetup-continue-note">Continue changes the step. It does not save your draft.</p>
      </section>
      <div id="meetup-places" v-show="activeStep === 'places'" role="tabpanel" aria-labelledby="meetup-tab-places" class="meetup-workspace meetup-place-workspace">
      <p v-if="availabilityDirty || journeyDirty" class="meetup-role-note" role="status">Your time and journey draft is kept. Recommendations use saved availability; return to Find a time to apply and save changes.</p>
      <form class="card group-panel meetup-place-editor" @submit.prevent="addPlace">
        <span class="meetup-eyebrow">02 / Places &amp; journeys</span>
        <h2>Suggest a meeting place</h2>
        <p class="group-muted">Search, select a result, then add it to suggested places. Everyone can contribute while planning is open.</p>
        <fieldset class="meetup-travel-fields" :disabled="busy || contributionsLocked">
          <MeetupLocationSearch :meetup-id="id" :reset-key="placeSearchKey" :disabled="busy || contributionsLocked" selection-hint="Selection is not saved. Press Add place to share this suggestion." @selected="selectPlace" @selection-invalidated="invalidatePlace" />
          <label>Place name<input v-model="place.label" required maxlength="150" @input="editPlace('label')" /></label>
          <p v-if="validCoordinates(place)" class="group-muted">Location selected. Add the place to save it for everyone.</p>
          <details class="meetup-manual-entry"><summary>Advanced/manual entry</summary><p class="group-muted">If search is unavailable, enter the public place name above and both coordinates here.</p><div class="group-controls">
            <label>Latitude<input v-model="place.latitude" type="number" min="-90" max="90" step="any" @input="editPlace('latitude')" /></label>
            <label>Longitude<input v-model="place.longitude" type="number" min="-180" max="180" step="any" @input="editPlace('longitude')" /></label>
          </div></details>
          <label class="group-check"><input v-model="place.sheltered" type="checkbox" />Sheltered place</label>
          <button class="btn btn--primary" :disabled="busy || contributionsLocked">{{ busy ? 'Saving place...' : 'Add place' }}</button>
        </fieldset>
        <p v-if="failures.places" class="group-error" role="alert">{{ failures.places }}</p>
        <p v-if="feedback.places" class="group-success" role="status">{{ feedback.places }}</p>
      </form>
      <section class="card group-panel meetup-suggested-places" aria-labelledby="suggested-places-heading">
        <h2 id="suggested-places-heading">Suggested meeting places</h2>
        <p class="group-muted">Saved suggestions stay here even before anyone shares availability.</p>
        <p v-if="!board.places.length">No places suggested yet. Add a public meeting place above.</p>
        <article v-for="candidate in board.places" :key="candidate.id" class="meetup-place-row">
          <div><h3>{{ candidate.label }}</h3><p class="group-muted">{{ candidate.sheltered ? 'Sheltered' : 'Not marked sheltered' }} &middot; {{ candidate.votes ?? 0 }} {{ candidate.votes === 1 ? 'vote' : 'votes' }}<span v-if="candidate.proposed_by === currentUser?.id"> &middot; Suggested by you</span></p></div>
          <button type="button" class="btn btn--ghost" :disabled="busy || contributionsLocked" :aria-pressed="board.currentVotePlaceId === candidate.id" @click="vote(candidate.id)">{{ board.currentVotePlaceId === candidate.id ? 'Your vote' : 'Vote for place' }}</button>
        </article>
      </section>
      <section class="card group-panel meetup-recommendations">
        <h2>Recommended meeting times and places</h2>
        <p class="group-muted">Find times when more people are free, then compare convenient meeting places.</p>
        <details class="meetup-disclosure"><summary>How recommendations work</summary><ul>
          <li>More available participants rank higher.</li>
          <li>Journey times are compared when reliable routes are sufficiently complete. The longest journey helps break ties.</li>
          <li>Without complete routes, straight-line distances are approximate. Missing journeys never count as zero.</li>
          <li>Votes and time help break remaining ties. Travel estimates are not guarantees.</li>
        </ul></details>
        <label class="group-check"><input v-model="travelOptions.shelteredOnly" type="checkbox" :disabled="busy" @change="travelRecommendations = null" />Only places marked sheltered</label>
        <button class="btn btn--ghost" :disabled="busy || board.status === 'cancelled' || !hasSavedAvailability || !board.places.length" @click="getTravelSuggestions">Compare travel options</button>
        <p v-if="failures.recommendations" class="group-error" role="alert">{{ failures.recommendations }}</p>
        <p v-if="travelRecommendations" class="group-muted" role="status">{{ travelRecommendations.rankingBasis === 'route_times' ? 'Comparing estimated journey times.' : 'Fresh routes are incomplete or unavailable. Comparing approximate distances instead.' }}</p>
        <p v-if="!recommendedOptions.length" class="meetup-empty-state" role="status">{{ recommendationEmpty }}</p>
        <article v-for="s in recommendedOptions" :key="`${s.placeId}:${s.startsAt}`" class="meetup-option">
          <h3>{{ s.label }}</h3><p>{{ time(s.startsAt) }}</p>
          <div class="group-tags"><span>{{ s.availableCount }} of {{ s.participantCount }} participants available</span><span v-if="s.totalTravelMinutes !== null && s.totalTravelMinutes !== undefined">Estimated journey time: {{ s.totalTravelMinutes }} minutes combined</span><span v-else>{{ s.totalDistanceKm === null ? 'Distance unavailable' : `Approximate distance: ${s.totalDistanceKm} km combined` }}</span></div>
          <p v-if="s.travelModes" class="group-muted">Travel methods: {{ s.travelModes.transit }} by public transport &middot; {{ s.travelModes.drive }} by car.</p>
          <p v-if="s.totalTravelMinutes !== null && s.totalTravelMinutes !== undefined" class="group-muted">Longest estimated journey: {{ s.maximumTravelMinutes }} minutes.</p>
          <p v-if="s.basis === 'straight_line_distance' || s.basis === undefined" class="group-muted">Straight-line distance estimate. Fresh route times are unavailable for this option.</p>
          <div class="group-actions">
            <button type="button" class="btn btn--ghost" :disabled="busy || contributionsLocked" @click="vote(s.placeId)">Vote for place</button>
            <button v-if="capabilities.canPropose" type="button" class="btn btn--primary" :disabled="busy" @click="propose(s)">{{ proposalLabel }}</button>
          </div>
        </article>
      </section>
      <p v-if="capabilities.canPropose && recommendedOptions.length" class="group-muted meetup-proposal-guidance">{{ proposalGuidance }}</p>
      <button type="button" class="btn btn--ghost meetup-review-link" @click="showStep('review')">Review the plan <span aria-hidden="true">→</span></button>
      </div>
      <div id="meetup-review" v-show="activeStep === 'review'" role="tabpanel" aria-labelledby="meetup-tab-review" class="meetup-workspace meetup-review-workspace">
      <p v-if="feedback.review" class="group-success" role="status">{{ feedback.review }}</p>
      <p v-if="failures.review" class="group-error" role="alert">{{ failures.review }}</p>
      <section v-if="board.selected_place_id" class="card group-panel meetup-current-proposal">
        <span class="meetup-eyebrow">03 / Group decision</span>
        <h2>{{ board.status === 'confirmed' ? 'Your confirmed meetup' : board.status === 'cancelled' ? 'Cancelled meetup' : 'Current proposal' }}</h2>
        <p class="meetup-decision">
          {{
            board.places.find((p) => p.id === board.selected_place_id)?.label
          }}, {{ time(board.selected_start) }}
        </p>
        <div class="meetup-approval-progress" role="status"><strong>Approvals: {{ board.approvals.length }}/{{ board.requiredApprovers.length }}</strong><p>{{ approvalGuidance }}</p><p v-if="board.status === 'proposed' && board.requiredApprovers.length > 1" class="group-muted">{{ board.scope?.kakiConversationId || board.kaki_conversation_id ? 'Both companions' : 'Both group hosts' }} must explicitly approve this version. Submitting the proposal does not approve it.</p></div>
        <button
          v-if="
            capabilities.canApprove
          "
          class="btn btn--success"
          :disabled="busy"
          @click="approve"
        >
          Approve plan</button
        >
        <button v-if="capabilities.canReopen" type="button" class="btn btn--ghost meetup-reopen" :disabled="busy" @click="requestOrganizerAction('reopen')">{{ board.status === 'proposed' ? 'Withdraw proposal and reopen planning' : 'Reopen planning' }}</button>
        <details class="meetup-disclosure meetup-weather"><summary>Weather &amp; nearby parking <span>Check before travelling</span></summary><button class="btn btn--ghost" :disabled="busy" @click="getWeather">
          Check weather and recent rainfall
        </button>
        <p v-if="weather">{{ weather.message ?? 'Weather is unavailable right now.' }}</p>
        <p v-if="weather?.stale" class="group-muted">This is a cached forecast; check again before travelling.</p>
        <p v-if="rainfall?.status === 'available'" class="group-muted">Recent rainfall: {{ rainfall.millimetres }} mm at {{ rainfall.station }}, {{ rainfall.distanceKm }} km from the meeting place ({{ time(Date.parse(rainfall.observedAt)) }}). This is an observation, not a forecast.</p>
        <div class="meetup-parking">
          <h3>Driving to the meetup?</h3>
          <p class="group-muted">Check nearby car parks around the proposed meeting place. Available lots describe conditions now and may change before your meetup.</p>
          <button type="button" class="btn btn--ghost" :disabled="busy" @click="getParking">Check nearby parking</button>
          <template v-if="transport?.parking">
            <p v-if="transport.parking.status !== 'available'">Parking information is unavailable right now. Please try again later.</p>
            <template v-else>
              <p v-if="transport.parking.stale" class="group-muted">Showing saved parking availability. Refresh before travelling.</p>
              <p v-if="transport.parking.coverage === 'bounded_snapshot'" class="group-muted">Showing a limited set of reporting car parks; other parking may be available.</p>
              <p v-if="!transport.parking.carparks.length">No reported car parks within {{ transport.parking.radiusKm }} km of this meeting place.</p>
              <ul v-else class="meetup-parking__list">
                <li v-for="carpark in transport.parking.carparks" :key="carpark.id"><strong>{{ carpark.name }}</strong><span>Approx. {{ carpark.distanceKm }} km away · {{ carpark.availableLots }} {{ carpark.availableLots === 1 ? 'car lot' : 'car lots' }} available</span></li>
              </ul>
            </template>
          </template>
        </div>
        </details>
      </section>
      <section v-else class="card group-panel meetup-current-proposal"><span class="meetup-eyebrow">03 / Group decision</span><h2>A plan everyone can agree on</h2><p class="group-muted">Choose a suggested time and place first. Your group can then discuss the proposal and give the required approvals.</p><button type="button" class="btn btn--primary" @click="showStep('places')">Choose a time &amp; place</button></section>
      <MeetupTransportPanel :key="`${id}:${currentUser?.id}`" :active="activeStep === 'review'" :meetup-id="id" :concert="board.concert" :plan-version="board.version" :has-meeting-place="Boolean(board.selected_place_id)" />
      <MeetupDiscussionPanel v-model="comment" :comments="board.comments" :busy="busy" :can-discuss="capabilities.canDiscuss" :notice="feedback.discussion" :error="failures.discussion" @submit="postComment" />
      <section v-if="capabilities.canCancel" class="meetup-management" aria-label="Manage this meetup"><h2>Manage this meetup</h2><p class="group-muted">To revise the time or place, reopen planning. Cancel only if this meetup is no longer going ahead.</p><button type="button" class="btn btn--ghost meetup-cancel" :disabled="busy" @click="requestOrganizerAction('cancel')">Cancel meetup</button></section>
      </div></template
    >
    <ConfirmDialog :open="Boolean(confirmAction)" :busy="busy" :title="confirmAction === 'reopen' ? (board?.status === 'proposed' ? 'Withdraw proposal and reopen planning?' : 'Reopen planning?') : 'Cancel this meetup?'" :body="confirmAction === 'reopen' ? 'The selected time and place will be cleared. Availability, places, votes and discussion are kept. Previous approvals will no longer authorize the plan; all required organizers must approve a new proposal. Participants will be notified.' : 'This meetup will become read-only. Participants will be notified.'" :confirm-label="confirmAction === 'reopen' ? 'Reopen planning' : 'Cancel meetup'" cancel-label="Keep current plan" :danger="confirmAction === 'cancel'" @cancel="confirmAction = null" @confirm="organizerAction" />
    <ConfirmDialog :open="leavePrompt" title="Leave with unsaved changes?" body="Your availability, journey, place or discussion draft has not been saved. Leaving this planner discards it. Any update already sent may still complete." confirm-label="Discard changes and leave" cancel-label="Keep editing" initial-focus="cancel" danger @cancel="settleLeave(false)" @confirm="settleLeave(true)" />
  </div>
</template>
<style scoped>
.meetup-overview-context { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem 1rem; color:var(--text-300); padding-block:.5rem 1rem; border-bottom:var(--border-soft); font-size:var(--step--1); }
.meetup-overview-context strong { color:var(--text-100); }
.meetup-overview-context a { margin-left:auto; }
.meetup-additional-plan { display:flex; flex-wrap:wrap; align-items:center; gap:1rem; padding-top:1rem; border-top:var(--border-soft); }
.meetup-additional-plan p { flex:1 1 18rem; color:var(--text-300); font-size:var(--step--1); }

.meetup-page {
  max-width: 66rem;
  gap: var(--space-5);
}
.meetup-page--board { gap: var(--space-4); }
.meetup-page--board .page-banner {
  padding: 1rem 1.25rem;
  border: var(--border-soft);
  border-left: 3px solid var(--accent-400);
  border-radius: var(--radius-md);
  background: var(--surface-interactive);
  box-shadow: inset 0 1px 0 var(--panel-highlight);
}
.meetup-page--board .page-banner h1 {
  font-size: clamp(1.45rem, 3vw, 2rem);
  line-height: 1.2;
  color: var(--text-100);
}
.meetup-page--board .page-banner p { margin-top: .35rem; color: var(--text-300); font-size: var(--step--1); }
.meetup-page--board .page-banner::before, .meetup-page--board .page-banner::after { display: none; }
.meetup-context {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: .55rem 1rem;
  color: var(--text-300);
  font-size: var(--step--1);
}
.meetup-context > strong {
  padding: .3rem .65rem;
  border: 1px solid color-mix(in srgb, var(--accent-400) 25%, var(--panel-edge));
  border-radius: 5px;
  color: var(--text-100);
  background: color-mix(in srgb, var(--accent-400) 5%, var(--ink-800));
  font-weight: 500;
}
.meetup-role-note, .meetup-empty-state { padding: .85rem 1rem; border: 1px solid var(--panel-edge); border-radius: 8px; background: var(--ink-850); color: var(--text-300); }
.meetup-recovery { display: grid; gap: .65rem; border-left: 3px solid var(--accent-400); }
.meetup-recovery p { margin: 0; }
.meetup-approval-progress { padding: .85rem 1rem; border: var(--border-soft); border-radius: var(--radius-sm); background: var(--surface-interactive); }
.meetup-approval-progress p { margin: .5rem 0 0; }
.meetup-reopen { justify-self: start; }
.meetup-management { border-top: var(--border-soft); padding-top: 1.25rem; display: grid; justify-items: start; gap: .75rem; }
.meetup-management h2 { font-size: var(--step-0); }
.meetup-cancel { color: var(--text-300); }
.meetup-journey .meetup-travel-fields { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 1rem; }
.meetup-journey .meetup-travel-fields > button { justify-self: start; }
.meetup-manual-entry { border-top: 1px solid var(--panel-edge); padding-top: .8rem; }
.meetup-manual-entry > summary { color: var(--text-300); font-size: var(--step--1); }
.meetup-place-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding-top: 1rem; }
.meetup-place-row h3 { margin-bottom: .35rem; }
.meetup-place-row .btn { flex-shrink: 0; }
.meetup-place-row .btn[aria-pressed="true"] { border-color: var(--mint-400); color: var(--mint-400); }
.meetup-eyebrow {
  color: var(--mint-400);
  font-size: .8rem;
  font-weight: 600;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.meetup-live {
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  color: var(--text-300);
  font-size: var(--step--1);
}
.meetup-live > span {
  width: .5rem;
  height: .5rem;
  border-radius: 50%;
  background: var(--mint-400);
}
.meetup-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 5px;
  border: 1px solid var(--ink-500);
  border-radius: 12px;
  background: var(--ink-850);
  box-shadow: inset 0 1px 4px color-mix(in srgb, var(--ink-500) 20%, transparent), var(--shadow-md);
}
.meetup-steps button {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: .2rem .7rem;
  align-items: center;
  text-align: left;
  min-height: 4.4rem;
  padding: .8rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-100);
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease, box-shadow 180ms ease, transform 120ms ease;
}
.meetup-steps button[aria-selected="true"] {
  border-color: color-mix(in srgb, var(--accent-400) 50%, var(--panel-edge));
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent-400) 10%, var(--ink-800)), var(--ink-750));
  box-shadow: inset 0 1px 0 var(--panel-highlight), var(--shadow-sm);
}
.meetup-steps button:hover {
  background-color: var(--ink-750);
}
.meetup-steps button:active {
  transform: translateY(1px);
  box-shadow: inset 0 2px 5px color-mix(in srgb, var(--ink-500) 30%, transparent);
}
.meetup-steps button:focus-visible {
  outline: 2px solid var(--accent-400);
  outline-offset: 1px;
}
.meetup-steps button > span {
  grid-row: span 2;
  display: grid;
  place-items: center;
  width: 1.65rem;
  height: 1.65rem;
  border: 1px solid var(--ink-500);
  border-radius: 6px;
  color: var(--text-300);
  font-size: .75rem;
}
.meetup-steps button[aria-selected="true"] > span {
  color: var(--mint-400);
  border-color: color-mix(in srgb, var(--accent-400) 50%, var(--panel-edge));
  background: color-mix(in srgb, var(--accent-400) 8%, var(--ink-800));
}
.meetup-steps small {
  color: var(--text-300);
}
.meetup-workspace {
  animation: meetup-panel-in 220ms cubic-bezier(.2, .75, .3, 1) both;
  min-width: 0;
}
.meetup-place-workspace, .meetup-review-workspace {
  display: grid;
  gap: var(--space-5);
  align-content: start;
}
.meetup-page .group-panel {
  gap: 1rem;
  padding: clamp(1rem, 3vw, 2rem);
}
.meetup-page .meetup-workspace > p, .meetup-page .group-panel > p {
  max-width: 70ch;
}
.meetup-availability > h2 {
  margin-bottom: -.5rem;
}
.meetup-availability__summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: .5rem;
  padding-block: .85rem;
  border-block: 1px solid var(--ink-500);
  color: var(--text-300);
}
.meetup-unsaved {
  color: var(--accent-400);
}
.meetup-save-state { font-size: var(--step--1); font-weight: 600; color: var(--text-200); }
.meetup-continue-note { font-size: var(--step--1); }
.meetup-decision { font-size: var(--step-1); font-weight: 600; line-height: 1.5; color: var(--text-100); }
.meetup-availability__summary strong {
  color: var(--text-200);
  font-weight: 500;
}
.meetup-time-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(12rem, .6fr);
  align-items: start;
  gap: clamp(1.5rem, 4vw, 3rem);
  padding-block: .25rem 1rem;
}
.meetup-time-context {
  padding-left: clamp(1.25rem, 3vw, 2rem);
  border-left: 1px solid var(--panel-edge);
  display: grid;
  gap: .5rem;
}
.meetup-time-context h3 { font-size: var(--step-0); }
.meetup-time-context > p { font-size: var(--step--1); }
.meetup-time-context__metrics { display: grid; gap: 1.5rem; margin: 1rem 0; }
.meetup-time-context__metrics dt { color: var(--text-300); font-size: var(--step--1); }
.meetup-time-context__metrics dd { margin: .3rem 0 0; color: var(--text-200); font-size: .8rem; }
.meetup-time-context__metrics dd > strong { color: var(--text-100); font-size: 2rem; font-weight: 600; letter-spacing: -.05em; line-height: 1.2; }
.meetup-time-context__metrics strong > small { color: var(--text-300); font-size: 1rem; font-weight: 400; letter-spacing: 0; }
.meetup-time-context__metrics dd > span { display: block; margin-top: .4rem; color: var(--text-300); line-height: 1.5; }
.meetup-time-context__metrics .meetup-time-context__empty { margin-top: .5rem; color: var(--text-300); line-height: 1.5; }
.meetup-time-context .meetup-time-context__note { color: var(--text-300); font-size: .75rem; line-height: 1.65; }
.meetup-save-bar {
  border-top: 1px solid var(--ink-500);
  padding-top: 1rem;
  margin-top: .25rem;
}
.meetup-save-bar > .btn:last-child:not(:first-child) {
  margin-left: auto;
}
.meetup-disclosure {
  border: 1px solid var(--ink-500);
  border-radius: 8px;
  background: color-mix(in srgb, var(--ink-900) 45%, var(--ink-800));
  padding: 1rem;
}
.meetup-disclosure > summary {
  font-weight: 600;
  color: var(--text-200);
  line-height: 1.5;
}
.meetup-disclosure > summary span {
  font-size: .75rem;
  font-weight: 400;
  color: var(--text-300);
  margin-left: .7rem;
}
.meetup-disclosure[open] > summary {
  padding-bottom: .75rem;
  border-bottom: 1px solid var(--ink-500);
  margin-bottom: 1rem;
}
.meetup-weather > .btn {
  margin-bottom: .75rem;
}
.meetup-option {
  display: grid;
  gap: .7rem;
  padding: 1.1rem;
  background: color-mix(in srgb, var(--accent-400) 3%, var(--ink-800));
  border: 1px solid var(--ink-500);
  border-left: 2px solid color-mix(in srgb, var(--accent-400) 55%, var(--panel-edge));
  border-radius: 6px;
}
.meetup-review-link {
  justify-self: end;
}
.meetup-travel-fields {
  display: block;
  border: 0;
  margin: var(--space-4) 0;
  padding: 0;
  min-width: 0;
  width: 100%;
}
/* Add place sits equally between the Sheltered tick box and the card's bottom edge. */
.meetup-place-editor .meetup-travel-fields { margin-bottom: 0; }
.meetup-place-editor .meetup-travel-fields > .group-check { margin-bottom: 0; }
.meetup-place-editor .meetup-travel-fields > button { display: block; margin-top: var(--space-5); }
.meetup-travel-fields legend {
  font-weight: 600;
  padding-bottom: var(--space-3);
}
@keyframes meetup-panel-in {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (max-width: 620px) {
  .meetup-place-row { align-items: start; flex-direction: column; }
  .meetup-steps {
    gap: 2px;
    padding: 3px;
  }
  .meetup-steps small {
    display: none;
  }
  .meetup-steps button {
    grid-template-columns: 1fr;
    gap: .45rem;
    align-content: start;
    min-height: 5.1rem;
    padding: .65rem .45rem;
    font-size: .875rem;
  }
  .meetup-steps button > span {
    grid-row: auto;
    width: 1.35rem;
    height: 1.35rem;
    font-size: .65rem;
  }
  .meetup-save-bar > .btn:last-child:not(:first-child) {
    margin-left: 0;
  }
  .meetup-disclosure > summary span {
    display: block;
    margin-left: 1rem;
    margin-top: .2rem;
  }
}
@media (max-width: 800px) {
  .meetup-time-layout { grid-template-columns: minmax(0, 1fr); gap: 1.25rem; }
  .meetup-time-context { padding: 1.25rem 0 0; border-left: 0; border-top: 1px solid var(--panel-edge); }
  .meetup-time-context__metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin: .75rem 0; }
}
.meetup-parking {
  display: grid;
  justify-items: start;
  gap: var(--space-3);
  padding-top: var(--space-4);
  margin-top: var(--space-3);
  border-top: var(--border-hairline);
}
.meetup-parking h3 {
  font-size: var(--step-1);
}
.meetup-parking__list {
  display: grid;
  gap: var(--space-3);
  width: 100%;
  padding: 0;
  list-style: none;
}
.meetup-parking__list li {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  background: var(--ink-750);
  border-radius: var(--radius-sm);
}
.meetup-parking__list span {
  color: var(--text-300);
  font-size: var(--step--1);
}
@media (prefers-reduced-motion: reduce) {
  .meetup-workspace { animation: none; }
  .meetup-steps button { transition: none; }
}
</style>
