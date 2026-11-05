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
  availabilityResponse, savedAvailabilityResponse, unavailable, hasResponded, responseLabel,
  manualPlaceId, manualStartsAt, manualOption, acknowledgeNoAvailability, requestManualProposal,
  feedback, failures, placeSearchKey, confirmAction, capabilities, contributionsLocked, selectedOrigins,
  editingPlaceId, removingPlace, proposalReview, proposalReviewBody, recommendationsLoading, recommendationsInvalid,
  journeySearchKey, leavePrompt, settleLeave, journeyDirty, placeDirty, hasOwnSavedTimes, organizerRole, nextStep, followNextStep,
  selectPlace, selectJourney, invalidatePlace, invalidateJourney, editPlace, editJourney,
  selectedSlotCount, bestSavedOverlap, selectedTimes, activeStep, availabilityDirty, refreshing, syncNote,
  liveLabel, statuses, time, validCoordinates, recommendedOptions, placeChoices, pickedPlace, pickedOption, pickedVotes, pickedStartsAt, pickPlace, pickTime, comparingOptions, bestOption, pickedIsBest, useBestOption, recommendationMethod, journeySummary, recommendationEmpty,
  refreshPlanner, showStep, stepUnlocked, navigateSteps, create, saveAvailability, discardAvailability, assignJourney,
  addPlace, resetPlaceDraft, correctPlace, requestRemovePlace, removePlace, vote, requestProposal, propose, approve, requestOrganizerAction, organizerAction, postComment, getWeather, getTravelSuggestions, getParking, changeShelterFilter,
 } = useMeetupBoard(props);
</script>
<template>
  <div class="container groups-page meetup-page" :class="{ 'meetup-page--board': board }">
    <BackArrow class="back-link" :to="returnRoute" :label="returnLabel" />
    <header class="page-banner">
      <h1>{{ board?.title ?? (Object.keys(scope).length ? "Plan with your conversation" : "My meetups") }}</h1>
      <p v-if="!board">Your concert meetups in one place.</p>
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
      ><div v-if="creationContext" class="meetup-overview-context"><strong>{{ creationContext.concert?.artist }}</strong><span>{{ creationContext.scopeLabel }}</span><RouterLink v-if="hasActiveBoards" to="/meetups">All my meetup plans</RouterLink></div>
      <MeetupOverview :plans="boards" :scoped="Boolean(creationContext)" :from="route.query.from" />
      <p v-if="creationContext?.policy?.canSchedule === false" class="meetup-role-note" role="status">No future pre-concert meeting window remains. Existing plans and conversations stay available.</p>
      <div v-if="creationContext?.capabilities.canCreate && creationContext.policy?.canSchedule !== false && hasActiveBoards" class="meetup-additional-plan"><p>Need a separate meetup?</p><button type="button" class="btn btn--ghost" :disabled="busy" :aria-expanded="creatingAdditional" aria-controls="meetup-creation-area" @click="creatingAdditional = !creatingAdditional">{{ creatingAdditional ? 'Keep existing plans' : 'Create a separate plan' }}</button></div>
      <div id="meetup-creation-area"><MeetupCreationForm v-if="showCreation" :key="context()" :context="creationContext" :additional-plan="hasActiveBoards" :busy="busy" :error="failures.creation" @submit="create" /></div>
      <p v-if="creationContext && !creationContext.capabilities.canCreate && !boards.length" class="meetup-role-note">Your group host creates the planning board. You can join in once it is open.</p>
      <p v-if="!boards.length && !error && creationContext?.policy?.canSchedule !== false">No meetups yet. Start one from your group or a companion chat.</p>
      </template>
    <template v-else-if="board"
      ><div class="meetup-context"><span>{{ board.participantCount }} participants</span><strong>{{ statuses[board.status] ?? "Plan updated" }}</strong></div>
      <section v-if="nextStep" class="meetup-next-step" aria-labelledby="meetup-next-step-heading">
        <div class="meetup-next-step__content"><p class="meetup-next-step__eyebrow" id="meetup-next-step-heading">What should I do next?</p><h2>{{ nextStep.title }}</h2><p>{{ nextStep.body }}</p><p v-if="board.status === 'planning'" class="meetup-next-step__role">{{ organizerRole }}</p><p v-if="capabilities.canPropose && !hasResponded && !availabilityDirty && nextStep.step === 'review'" class="meetup-own-response-reminder">You have not shared your own availability yet. <button type="button" class="btn btn--ghost" @click="showStep('availability')">Share my availability</button></p></div>
        <button type="button" class="btn btn--primary" :disabled="busy || refreshing" @click="followNextStep">{{ nextStep.label }} <span aria-hidden="true">→</span></button>
      </section>
      <section v-if="board.status === 'proposed' || board.status === 'confirmed'" class="meetup-role-note meetup-recovery" aria-label="Planning is locked">
        <p>{{ board.status === 'confirmed' ? 'This plan is confirmed.' : 'Waiting for organizer approval.' }} Changes are locked, but you can still chat.</p>
        <p v-if="!capabilities.canReopen">Ask an organizer to reopen planning to make changes.</p>
        <div v-if="activeStep !== 'review'" class="group-actions"><button type="button" class="btn btn--ghost" @click="showStep('review')">View the {{ board.status === 'confirmed' ? 'confirmed plan' : 'proposal' }}</button><button v-if="capabilities.canReopen" type="button" class="btn btn--primary" :disabled="busy" @click="requestOrganizerAction('reopen')">{{ board.status === 'proposed' ? 'Withdraw proposal and reopen planning' : 'Reopen planning' }}</button></div>
      </section>
      <nav class="meetup-steps" role="tablist" aria-label="Meeting planning steps">
        <button id="meetup-tab-availability" type="button" role="tab" data-planner-step="availability" aria-controls="meetup-availability" :aria-selected="activeStep === 'availability'" :tabindex="activeStep === 'availability' ? 0 : -1" @click="showStep('availability')" @keydown="navigateSteps"><span>1</span><strong>Share availability</strong></button>
        <button id="meetup-tab-places" type="button" role="tab" data-planner-step="places" aria-controls="meetup-places" :aria-selected="activeStep === 'places'" :aria-disabled="!stepUnlocked('places')" :tabindex="activeStep === 'places' ? 0 : -1" @click="showStep('places')" @keydown="navigateSteps"><span>2</span><strong>Suggest places</strong></button>
        <button id="meetup-tab-review" type="button" role="tab" data-planner-step="review" aria-controls="meetup-review" :aria-selected="activeStep === 'review'" :aria-disabled="!stepUnlocked('review')" :tabindex="activeStep === 'review' ? 0 : -1" @click="showStep('review')" @keydown="navigateSteps"><span>3</span><strong>Finalise meetup</strong></button>
      </nav>
      <p v-if="syncNote" class="group-muted" role="status">{{ syncNote }}</p>
      <section id="meetup-availability" v-show="activeStep === 'availability'" role="tabpanel" aria-labelledby="meetup-tab-availability" class="card group-panel meetup-availability meetup-workspace">
        <h2>Select the times you are available</h2>
        <p class="group-muted">Click or tap a half-hour block to select it; drag across several to paint your availability. Darker green means more saved availability.</p>
        <div class="meetup-availability__summary"><strong>{{ selectedSlotCount }} half-hour {{ selectedSlotCount === 1 ? 'block' : 'blocks' }} selected</strong><span :class="{ 'meetup-unsaved': availabilityDirty }">{{ availabilityDirty ? 'Unsaved changes' : savedAvailabilityResponse === 'unanswered' ? 'No response saved' : savedAvailabilityResponse === 'unavailable' ? 'Unavailable response saved' : 'Your saved availability' }}</span></div>
        <div class="meetup-time-layout">
          <MeetupAvailabilityGrid :grid="board.grid" :participant-count="board.participantCount" v-model:selected="selectedTimes" :disabled="busy || contributionsLocked" />
          <aside class="meetup-time-context" aria-labelledby="meetup-group-availability-heading">
            <h3 id="meetup-group-availability-heading">Group availability ({{ board.participantCount }})</h3>
            <!-- Only once the person has actually saved: before that there is
                 nothing to have saved yet, so the line would read as a fault. -->
            <p v-if="hasResponded && !bestSavedOverlap" class="meetup-time-context__empty">No available times saved yet.</p>
            <div v-if="board.availabilityResponses" class="meetup-response-summary" aria-label="Availability responses">
              <strong>{{ board.availabilityResponses.respondedCount }} of {{ board.participantCount }} participants responded</strong>
              <!-- Nobody unavailable is the ordinary case, and "0 cannot make
                   these times" reads as a problem where there is none. -->
              <span v-if="board.availabilityResponses.unavailableCount">{{ board.availabilityResponses.unavailableCount }} cannot make these times</span>
            </div>
          </aside>
        </div>
        <fieldset class="meetup-response-controls" :disabled="busy || contributionsLocked">
          <label class="group-check"><input v-model="unavailable" type="checkbox" />I can't make any of these times</label>
          <p class="group-muted">This clears your selected blocks in this draft. Save to tell the group; you can revise your response later.</p>
          <p :class="availabilityDirty ? 'meetup-unsaved' : 'group-muted'" role="status">{{ availabilityDirty ? 'Unsaved response' : 'Your response' }}: {{ responseLabel }}</p>
        </fieldset>
        <details class="meetup-disclosure meetup-journey">
          <summary>My private starting point <span class="meetup-audience meetup-audience--private">Only you &middot; Optional</span></summary>
          <p class="group-muted">Where will you be travelling from? Add an approximate starting point to your selected times to help compare journeys. Other participants cannot see it. This does not suggest a meeting place.</p>
          <fieldset class="meetup-travel-fields" :disabled="busy || contributionsLocked">
            <label>Travel method<select v-model="position.travelMode"><option value="transit">Public transport</option><option value="drive">Car</option></select></label>
            <MeetupLocationSearch :meetup-id="id" :reset-key="journeySearchKey" label="Private starting point" placeholder="e.g. your nearest MRT or approximate starting area" :disabled="busy || contributionsLocked" selection-hint="Private starting point selected. Press Apply to selected times, then save." @selected="selectJourney" @selection-invalidated="invalidateJourney" />
            <details class="meetup-manual-entry"><summary>Enter coordinates manually</summary>
              <div class="group-controls">
                <label>Location label<input v-model="position.label" maxlength="100" placeholder="e.g. Tampines MRT" @input="editJourney('label')" /></label>
                <label>Latitude<input v-model="position.latitude" type="number" min="-90" max="90" step="any" placeholder="No location supplied" @input="editJourney('latitude')" /></label>
                <label>Longitude<input v-model="position.longitude" type="number" min="-180" max="180" step="any" placeholder="No location supplied" @input="editJourney('longitude')" /></label>
              </div>
            </details>
            <button type="button" class="btn btn--ghost" :disabled="busy || contributionsLocked || !selectedSlotCount" @click="assignJourney">Apply to selected times</button>
            <p v-if="!selectedSlotCount" class="group-muted">Pick your times first.</p>
            <p v-if="journeyDirty" class="meetup-unsaved" role="status">Not applied yet. Press Apply to selected times.</p>
            <p v-if="feedback.journey" class="group-success" role="status">{{ feedback.journey }}</p>
            <p v-if="failures.journey" class="group-error" role="alert">{{ failures.journey }}</p>
          </fieldset>
        </details>
        <p v-if="feedback.availability" class="group-success" role="status">{{ feedback.availability }}</p>
        <p v-if="failures.availability" class="group-error" role="alert">{{ failures.availability }}</p>
        <p v-if="!busy && !contributionsLocked && (failures.availability || availabilityDirty || !hasResponded)" class="meetup-save-state" role="status">{{ failures.availability ? 'Availability was not saved. Your draft is kept.' : availabilityDirty ? 'Save your changes to update the group. Exploring other steps keeps your draft.' : 'No response saved for you. Select times or choose that you cannot make these times, then save. You can explore the other steps first.' }}</p>
        <div class="group-actions meetup-save-bar">
        <button
          class="btn btn--primary"
          :disabled="busy || contributionsLocked || (!selectedSlotCount && !availabilityDirty)"
          @click="saveAvailability"
        >
          {{ busy ? 'Saving…' : availabilityResponse === 'unavailable' ? 'Save my response' : 'Save my times' }}
        </button>
        <button v-if="availabilityDirty" type="button" class="btn btn--ghost" :disabled="busy" @click="discardAvailability">Discard my changes</button>
        <button type="button" class="btn btn--ghost" :disabled="!stepUnlocked('places')" @click="showStep('places')">Next: suggest places <span aria-hidden="true">→</span></button>
        </div>
      </section>
      <div id="meetup-places" v-show="activeStep === 'places'" role="tabpanel" aria-labelledby="meetup-tab-places" class="meetup-workspace meetup-place-workspace">
      <p v-if="!hasResponded && !contributionsLocked" class="meetup-role-note">You can suggest or vote on places now. Share your availability in step 1 when you are ready.</p>
      <p v-if="availabilityDirty || journeyDirty" class="meetup-role-note" role="status">You have unsaved time changes. Recommendations use saved availability.</p>
      <form class="card group-panel meetup-place-editor" @submit.prevent="addPlace">
        <h2>{{ editingPlaceId ? 'Correct your meeting-place suggestion' : 'Suggest a meeting place' }}</h2>
        <span class="meetup-audience meetup-audience--shared">Shared with this group</span>
        <p class="group-muted">Suggest a public landmark or entrance where everyone could meet. This is separate from your private starting point. Adding a place invites votes; it does not set the final plan.</p>
        <p v-if="editingPlaceId" class="meetup-role-note" role="status">Renaming keeps the saved coordinates. Choose a new search result or edit coordinates to move the meeting place. Existing votes for this place will be cleared when you save a correction. Participants can review the change and vote again.</p>
        <fieldset class="meetup-travel-fields" :disabled="busy || contributionsLocked">
          <MeetupLocationSearch :meetup-id="id" :reset-key="placeSearchKey" label="Shared meeting place" placeholder="e.g. Funan entrance or a public meeting landmark" :disabled="busy || contributionsLocked" :selection-hint="editingPlaceId ? 'Replacement selected. Press Save place correction to share it.' : 'Selection is not saved. Press Add place to share it.'" @selected="selectPlace" @selection-invalidated="invalidatePlace" />
          <label>Place name<input v-model="place.label" required maxlength="150" @input="editPlace('label')" /></label>
          
          <details class="meetup-manual-entry"><summary>Enter coordinates manually</summary><div class="group-controls">
            <label>Latitude<input v-model="place.latitude" type="number" min="-90" max="90" step="any" @input="editPlace('latitude')" /></label>
            <label>Longitude<input v-model="place.longitude" type="number" min="-180" max="180" step="any" @input="editPlace('longitude')" /></label>
          </div></details>
          <label class="group-check"><input v-model="place.sheltered" type="checkbox" />Sheltered (optional)</label>
          <div class="group-actions"><button class="btn btn--primary" :disabled="busy || contributionsLocked || (editingPlaceId && !placeDirty)">{{ busy ? 'Saving place...' : editingPlaceId ? 'Save place correction' : 'Add place' }}</button><button v-if="editingPlaceId || place.label || place.latitude !== '' || place.longitude !== ''" type="button" class="btn btn--ghost" :disabled="busy" @click="resetPlaceDraft">{{ editingPlaceId ? 'Cancel correction' : 'Clear place draft' }}</button></div>
          <p v-if="editingPlaceId && !placeDirty" class="group-muted">No changes to this suggestion yet.</p>
        </fieldset>
        <p v-if="failures.places" class="group-error" role="alert">{{ failures.places }}</p>
        <p v-if="feedback.places" class="group-success" role="status">{{ feedback.places }}</p>
      </form>
      <section class="card group-panel meetup-suggested-places" aria-labelledby="suggested-places-heading">
        <h2 id="suggested-places-heading">Suggested meeting places</h2>
        <p class="group-muted">Optional: one place vote per person. Choose another place to switch your vote, or remove it. This does not select a meeting time or approve a proposal.</p>
        <p v-if="!board.places.length">No places yet. Suggest one above.</p>
        <article v-for="candidate in board.places" :key="candidate.id" class="meetup-place-row">
          <div><h3>{{ candidate.label }}</h3><p class="group-muted">{{ candidate.sheltered ? 'Sheltered' : 'Not marked sheltered' }} &middot; {{ candidate.votes ?? 0 }} {{ candidate.votes === 1 ? 'vote' : 'votes' }}<span v-if="candidate.proposed_by === currentUser?.id"> &middot; Suggested by you</span></p></div>
          <div class="group-actions meetup-place-actions">
            <template v-if="contributionsLocked"><span v-if="board.currentVotePlaceId === candidate.id" class="meetup-preferred-place">Your vote</span><span v-else class="group-muted">Voting locked</span></template>
            <button v-else type="button" class="btn btn--ghost" :disabled="busy" :aria-pressed="board.currentVotePlaceId === candidate.id" @click="vote(candidate.id)">{{ board.currentVotePlaceId === candidate.id ? 'Remove vote' : 'Vote for place' }}</button>
            <button v-if="candidate.canEdit" type="button" class="btn btn--ghost" :disabled="busy || contributionsLocked" @click="correctPlace(candidate)">Correct place</button>
            <button v-if="candidate.canRemove" type="button" class="btn btn--ghost" :disabled="busy || contributionsLocked" @click="requestRemovePlace(candidate)">Remove place</button>
          </div>
        </article>
      </section>
      <button type="button" class="btn btn--ghost meetup-review-link" :disabled="!stepUnlocked('review')" @click="showStep('review')">Next: finalise meetup <span aria-hidden="true">→</span></button>
      </div>
      <div id="meetup-review" v-show="activeStep === 'review'" role="tabpanel" aria-labelledby="meetup-tab-review" class="meetup-workspace meetup-review-workspace">
      <p v-if="feedback.review" class="group-success" role="status">{{ feedback.review }}</p>
      <p v-if="failures.review" class="group-error" role="alert">{{ failures.review }}</p>
      <section v-if="capabilities.canPropose" class="card group-panel meetup-recommendations">
        <h2>Recommended meetup</h2>
        <p class="group-muted">Start with the leading recommendation, or compare alternatives. Reviewing an option does not submit or approve it.</p>
        <p v-if="failures.recommendations" class="group-error" role="alert">{{ failures.recommendations }}</p>
        <p v-if="!recommendedOptions.length" class="meetup-empty-state" role="status">{{ recommendationEmpty }}</p>
        <div v-if="bestOption" class="meetup-best-summary" aria-label="Leading recommendation">
          <span class="meetup-next-step__eyebrow">Top meetup recommendation</span><strong>{{ bestOption.label }}</strong><span>{{ time(bestOption.startsAt) }} · {{ bestOption.availableCount }} of {{ bestOption.participantCount }} marked available</span>
          <p class="group-muted">Availability comes first. Saved journey information helps compare suitable options; a private starting point is optional.</p>
          <button v-if="!pickedIsBest" type="button" class="btn btn--ghost" :disabled="busy || recommendationsLoading || refreshing" @click="useBestOption">Use recommended option</button>
        </div>
        <button v-if="pickedOption" type="button" class="btn btn--ghost meetup-compare-toggle" :aria-expanded="comparingOptions" aria-controls="meetup-option-comparison" @click="comparingOptions = !comparingOptions">{{ comparingOptions ? 'Hide alternative options' : 'Compare other options' }}</button>
        <div v-if="pickedOption" v-show="comparingOptions" id="meetup-option-comparison" class="meetup-comparison">
        <p class="group-muted">Choose a place, then a ranked time. “Up to” is that place’s best overlap; attendance may differ at each time. Changing these menus only changes your preview.</p>
        <div class="meetup-picker">
          <label class="meetup-picker-field">Place
            <select :value="pickedPlace.placeId" :disabled="busy || recommendationsLoading || refreshing" @change="pickPlace($event.target.value)">
              <option v-for="p in placeChoices" :key="p.placeId" :value="p.placeId">{{ p.label }} · up to {{ p.maximumAvailable }} of {{ p.best.participantCount }} available · best rank {{ p.best.rank }}</option>
            </select>
          </label>
          <label class="meetup-picker-field">Time
            <select :value="String(pickedOption.startsAt)" :disabled="busy || recommendationsLoading || refreshing" @change="pickTime($event.target.value)">
              <option v-for="t in pickedPlace.times" :key="t.startsAt" :value="String(t.startsAt)">Rank {{ t.rank }} · {{ time(t.startsAt) }} · {{ t.availableCount }} of {{ t.participantCount }} available</option>
            </select>
          </label>
        </div>
        </div>
        <article v-if="pickedOption" class="meetup-option" aria-live="polite">
          <p class="meetup-next-step__eyebrow">{{ pickedIsBest ? 'Review the recommendation' : 'Your alternative to review' }}</p>
          <div class="meetup-option-heading"><h3>{{ pickedOption.label }}</h3><span class="meetup-rank">Rank {{ pickedOption.rank }} of {{ recommendedOptions.length }}</span></div>
          <strong class="meetup-option-time">{{ time(pickedOption.startsAt) }}</strong>
          <p :class="pickedOption.availableCount < pickedOption.participantCount ? 'meetup-partial-attendance' : 'group-muted'">{{ pickedOption.availableCount }} of {{ pickedOption.participantCount }} available<span v-if="pickedOption.availableCount < pickedOption.participantCount"> · Not everyone is available</span></p>
          <p class="group-muted meetup-place-support">{{ pickedVotes }} place {{ pickedVotes === 1 ? 'vote' : 'votes' }}<span v-if="board.currentVotePlaceId === pickedOption.placeId" class="meetup-preferred-place"> · Your preferred place</span></p>
          <details class="meetup-disclosure meetup-option-details"><summary>Journey details <span>Optional estimates</span></summary>
          <p class="group-muted meetup-journey-summary">{{ journeySummary(pickedOption) }}</p>
          <p v-if="pickedOption.travelModes" class="group-muted">Saved travel choices: {{ pickedOption.travelModes.transit }} public transport · {{ pickedOption.travelModes.drive }} car.</p>
          <p class="group-muted meetup-ranking-context">{{ recommendationMethod }}</p>
          </details>
          <button type="button" class="btn btn--primary" :disabled="busy || recommendationsLoading || refreshing" @click="requestProposal(pickedOption)">{{ proposalLabel }}</button>
        </article>
      </section>
      <p v-if="capabilities.canPropose && recommendedOptions.length" class="group-muted meetup-proposal-guidance">{{ proposalGuidance }}</p>
      <p class="group-muted meetup-proposal-guidance">Suggesting adds a place. Voting records a preference. Only the required organizers can choose and approve the final time and place.</p>
      <details v-if="capabilities.canPropose && board.places.length" class="meetup-disclosure meetup-manual-proposal">
        <summary>Propose another listed time <span>Organizer choice</span></summary>
        <p class="group-muted">The recommendations above favour times people can make. If you have discussed another arrangement, review an existing place and a time from this planning window.</p>
        <div class="group-controls">
          <label>Alternative meeting place<select v-model="manualPlaceId" aria-label="Alternative meeting place" :disabled="busy || refreshing"><option disabled value="">Choose a suggested place</option><option v-for="candidate in board.places" :key="candidate.id" :value="candidate.id">{{ candidate.label }}</option></select></label>
          <label>Alternative meeting time<select v-model="manualStartsAt" aria-label="Alternative meeting time" :disabled="busy || refreshing"><option disabled value="">Choose a listed time</option><option v-for="slot in board.grid" :key="slot.startsAt" :value="String(slot.startsAt)">{{ time(slot.startsAt) }} &middot; {{ slot.availableCount }} of {{ board.participantCount }} marked available</option></select></label>
        </div>
        <div v-if="manualOption && !manualOption.availableCount" class="meetup-attendance-warning" role="status">
          <strong>No participant has marked this time available.</strong>
          <label class="group-check"><input v-model="acknowledgeNoAvailability" type="checkbox" :disabled="busy || refreshing" />I understand this time has no recorded availability and want to review it anyway.</label>
        </div>
        <p v-if="recommendationsInvalid" class="group-muted" role="status">Refresh the planner before reviewing another time. Your saved changes are kept.</p>
        <button type="button" class="btn btn--ghost" :disabled="busy || refreshing || recommendationsInvalid || recommendationsLoading || !manualOption || (!manualOption.availableCount && !acknowledgeNoAvailability)" @click="requestManualProposal">Review this alternative</button>
      </details>
      <p v-if="!capabilities.canPropose && board.status === 'planning'" class="meetup-role-note">Your organizers choose and propose the final time and place. You can suggest places and vote in step 2, then follow the proposal here.</p>
      <section v-if="board.selected_place_id" class="card group-panel meetup-current-proposal">
        <h2>{{ board.status === 'confirmed' ? 'Your confirmed meetup' : board.status === 'cancelled' ? 'Cancelled meetup' : 'Current proposal' }}</h2>
        <p class="meetup-decision">
          {{
            board.places.find((p) => p.id === board.selected_place_id)?.label
          }}, {{ time(board.selected_start) }}
        </p>
        <p v-if="board.confirmationContext?.confirmedBeforeJoined" class="meetup-role-note meetup-confirmation-context">This meetup was confirmed before you joined the group. You can view the arrangement and discuss any changes with an organizer.</p>
        <div class="meetup-approval-progress" role="status"><strong>Approvals: {{ board.approvals.length }}/{{ board.requiredApprovers.length }}</strong><p>{{ approvalGuidance }}</p><p v-if="board.status === 'proposed' && board.requiredApprovers.length > 1" class="group-muted">{{ board.scope?.kakiConversationId || board.kaki_conversation_id ? 'Both companions' : 'Both group hosts' }} must approve.</p></div>
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
          <p class="group-muted">Live car park availability near the meeting place.</p>
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
      <section v-else class="card group-panel meetup-current-proposal"><h2>No time and place proposed yet</h2><p class="group-muted">{{ capabilities.canPropose ? 'Review a recommendation above, or suggest a place in step 2 if there are no options yet.' : 'The host will propose one soon.' }}</p><button type="button" class="btn btn--ghost" @click="showStep('places')">Back to places</button></section>
      <MeetupTransportPanel :key="`${id}:${currentUser?.id}`" :active="activeStep === 'review'" :meetup-id="id" :concert="board.concert" :plan-version="board.version" :has-meeting-place="Boolean(board.selected_place_id)" />
      <MeetupDiscussionPanel v-model="comment" :comments="board.comments" :busy="busy" :can-discuss="capabilities.canDiscuss" :notice="feedback.discussion" :error="failures.discussion" @submit="postComment" />
      <section v-if="capabilities.canCancel" class="meetup-management" aria-label="Manage this meetup"><h2>Manage this meetup</h2><button type="button" class="btn btn--ghost meetup-cancel" :disabled="busy" @click="requestOrganizerAction('cancel')">Cancel meetup</button></section>
      </div></template
    >
    <ConfirmDialog :open="Boolean(confirmAction)" :busy="busy" :title="confirmAction === 'reopen' ? (board?.status === 'proposed' ? 'Withdraw proposal and reopen planning?' : 'Reopen planning?') : 'Cancel this meetup?'" :body="confirmAction === 'reopen' ? 'The selected time and place will be cleared. Availability, places, votes and discussion are kept. Previous approvals will no longer authorize the plan; all required organizers must approve a new proposal. Participants will be notified.' : 'This meetup will become read-only. Participants will be notified.'" :confirm-label="confirmAction === 'reopen' ? 'Reopen planning' : 'Cancel meetup'" cancel-label="Keep current plan" :danger="confirmAction === 'cancel'" @cancel="confirmAction = null" @confirm="organizerAction" />
    <ConfirmDialog :open="leavePrompt" title="Leave with unsaved changes?" body="Your availability, journey, place or discussion draft has not been saved. Leaving this planner discards it. Any update already sent may still complete." confirm-label="Discard changes and leave" cancel-label="Keep editing" initial-focus="cancel" danger @cancel="settleLeave(false)" @confirm="settleLeave(true)" />
    <ConfirmDialog :open="Boolean(proposalReview)" :busy="busy || refreshing || recommendationsLoading" :title="proposalReview?.availableCount < proposalReview?.participantCount ? 'Not everyone is available — review this meetup' : 'Review the time and place'" :body="proposalReviewBody" :confirm-label="proposalReview?.immediate ? 'Confirm meetup now' : 'Submit proposal for approval'" cancel-label="Keep comparing" initial-focus="cancel" @cancel="proposalReview = null" @confirm="propose" />
    <ConfirmDialog :open="Boolean(removingPlace)" :busy="busy" title="Remove your suggested place?" :body="`${removingPlace?.label ?? ''} will be removed from the suggestions. Votes for this place will also be removed. Availability and other places are kept.`" confirm-label="Remove suggested place" cancel-label="Keep place" initial-focus="cancel" danger @cancel="removingPlace = null" @confirm="removePlace" />
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
.meetup-next-step {
  display: flex;
  align-items: center;
  gap: 1rem 1.5rem;
  flex-wrap: wrap;
  padding: clamp(1rem, 3vw, 1.5rem);
  border: 1px solid color-mix(in srgb, var(--accent-400) 42%, var(--panel-edge));
  border-left: 3px solid var(--accent-400);
  border-radius: var(--radius-md);
  background: linear-gradient(115deg, color-mix(in srgb, var(--accent-400) 9%, var(--surface-interactive)), var(--surface-interactive));
  box-shadow: inset 0 1px 0 var(--panel-highlight), 0 5px 18px color-mix(in srgb, var(--ink-900) 10%, transparent);
}
.meetup-next-step__content { flex: 1 1 28rem; min-width: 0; }
.meetup-next-step__content h2 { margin: .3rem 0 .5rem; font-size: clamp(1.15rem, 2.4vw, 1.4rem); line-height: 1.3; }
.meetup-next-step__content > p:not(.meetup-next-step__eyebrow) { color: var(--text-300); font-size: var(--step--1); line-height: 1.55; }
.meetup-next-step__role { margin-top: .65rem; padding-top: .65rem; border-top: var(--border-soft); }
.meetup-next-step__eyebrow { color: var(--text-100); font-size: .75rem; font-weight: 700; letter-spacing: .055em; text-transform: uppercase; }
.meetup-next-step > button { flex: 0 1 auto; white-space: normal; text-align: left; }
.meetup-best-summary { display: grid; gap: .35rem; padding: 1rem; border: 1px solid color-mix(in srgb, var(--accent-400) 40%, var(--panel-edge)); border-radius: var(--radius-sm); background: var(--surface-interactive); }
.meetup-best-summary > strong { color: var(--text-100); font-size: var(--step-1); }
.meetup-best-summary > span:not(:first-child) { color: var(--text-100); font-size: var(--step--1); }
.meetup-best-summary > .btn { justify-self: start; margin-top: .35rem; }
.meetup-compare-toggle { align-self: flex-start; justify-self: start; }
.meetup-comparison { display: grid; gap: .85rem; padding: 1rem; border: var(--border-soft); border-radius: var(--radius-sm); }
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
.meetup-place-actions { justify-content: flex-end; flex-wrap: wrap; }
.meetup-place-row > div:first-child { flex: 1 1 12rem; min-width: 0; overflow-wrap: anywhere; }
.meetup-place-row + .meetup-place-row { border-top: var(--border-soft); margin-top: 1rem; }
.meetup-preferred-place { color: var(--mint-400); font-size: var(--step--1); font-weight: 600; }
.meetup-ranking-context { display: grid; gap: .45rem; padding: .8rem 1rem; border-left: 2px solid var(--accent-400); background: var(--surface-interactive); color: var(--text-300); font-size: var(--step--1); line-height: 1.6; }
.meetup-ranking-context p { margin: 0; }
.meetup-option-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: .5rem 1rem; overflow-wrap: anywhere; }
.meetup-rank { display: inline-block; padding: .18rem .4rem; margin: 0 .5rem .4rem 0; border: var(--border-soft); border-radius: var(--radius-sm); color: var(--text-300); font-size: var(--step--1); }
.meetup-option-time { font-size: var(--step--1); }
.meetup-partial-attendance { color: var(--text-100); font-weight: 600; }
.meetup-eyebrow {
  color: var(--mint-400);
  font-size: .875rem;
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
.meetup-steps button[aria-disabled="true"] { opacity: .5; cursor: not-allowed; }
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
  font-size: .85rem;
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
/* No longer nested in the metrics list that used to carry it. */
.meetup-time-context__empty { color: var(--text-300); font-size: var(--step--1); line-height: 1.5; }
.meetup-time-context .meetup-time-context__note { color: var(--text-300); font-size: .85rem; line-height: 1.65; }
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
  font-size: .85rem;
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
.meetup-picker {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
  gap: .75rem;
}
.meetup-picker-field {
  display: grid;
  gap: .35rem;
  min-width: 0;
}
.meetup-picker-field select { width: 100%; max-width: 100%; min-width: 0; text-overflow: ellipsis; }
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
  .meetup-place-row > div:first-child { flex: initial; }
  .meetup-place-actions { justify-content: flex-start; }
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
.meetup-audience { display:inline-flex; align-items:center; padding:.2rem .55rem; border:1px solid var(--panel-edge); border-radius:var(--radius-pill); font-size:.75rem; font-weight:650; line-height:1.4; }
.meetup-audience--private { color:var(--text-300); background:var(--surface-interactive); }
.meetup-audience--shared { color:var(--mint-400); border-color:color-mix(in srgb,var(--mint-400) 40%,var(--panel-edge)); margin-bottom:.35rem; }
.meetup-response-controls { display:grid; gap:.5rem; margin:1rem 0; padding:1rem; border:var(--border-soft); border-radius:var(--radius-sm); min-width:0; }
.meetup-response-controls p { margin:0; }
.meetup-response-summary { display:grid; gap:.3rem; font-size:var(--step--1); line-height:1.6; border-top:var(--border-soft); padding-top:1rem; }
.meetup-response-summary span { color:var(--text-300); }
.meetup-own-response-reminder { display:flex; align-items:center; flex-wrap:wrap; gap:.5rem; margin-top:.75rem; }
.meetup-own-response-reminder .btn { min-height:2.25rem; font-size:var(--step--1); }
.meetup-attendance-warning { display:grid; gap:.75rem; padding:1rem; border-left:3px solid var(--accent-400); background:var(--surface-interactive); border-radius:var(--radius-sm); margin-block:1rem; }
.meetup-manual-proposal > .group-controls { margin-block:1rem; }
.meetup-option-details { margin-block:.75rem; }
</style>
