import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { currentUser } from '../auth.js';
import { connectionState, onChatEvent } from '../chatLive.js';
import { meetupErrorMessage } from '../utils/meetupFeedback.js';
import { formatMeetupDateTime } from '../utils/meetupTime.js';
import { meetupReturnLabel, meetupReturnRoute, meetupRouteForBoard, normalizeMeetupOrigin, normalizeMeetupScope } from '../utils/meetupNavigation.js';
import { isMeetupHistorical } from '../utils/meetupSummaries.js';
import { invalidateMeetupSummaries } from './useMeetupSummaries.js';

// Per-page state: authorization still belongs to the server.
export function useMeetupBoard(props) {
  const route = useRoute(),
    router = useRouter();
  const board = ref(null),
    boards = ref([]),
    error = ref(""),
    busy = ref(false),
    loading = ref(true),
    creationContext = ref(null),
    weather = ref(null),
    rainfall = ref(null),
    travelRecommendations = ref(null),
    transport = ref(null),
    comment = ref(""),
    slots = ref({});
  const place = reactive({
    label: "",
    latitude: '',
    longitude: '',
    sheltered: true,
  });
  const position = reactive({ latitude: '', longitude: '', label: "", travelMode: 'transit' });
  const feedback = reactive({}), failures = reactive({});
  const placeSearchKey = ref(0), journeySearchKey = ref(0), confirmAction = ref(null), confirmVersion = ref(null);
  const editingPlaceId = ref(null), removingPlace = ref(null), proposalReview = ref(null);
  const recommendationsLoading = ref(false), recommendationsInvalid = ref(false);
  const placeLookup = ref(null), journeyLookup = ref(null), leavePrompt = ref(false);
  const slotLookups = new Map();
  let createdAttempt = null;
  let resolveLeave;
  const creatingAdditional = ref(false);
  const availabilityResponse = ref('unanswered'), savedAvailabilityResponse = ref('unanswered');
  const unavailable = computed({ get: () => availabilityResponse.value === 'unavailable', set: value => {
    selectedTimes.value = [];
    availabilityResponse.value = value ? 'unavailable' : 'unanswered';
  } });
  const hasResponded = computed(() => savedAvailabilityResponse.value !== 'unanswered');
  const responseLabel = computed(() => ({ available: 'Available times selected', unavailable: 'Unavailable for these times', unanswered: 'No response selected' })[availabilityResponse.value]);
  const manualPlaceId = ref(''), manualStartsAt = ref(''), acknowledgeNoAvailability = ref(false);
  const manualOption = computed(() => {
    const candidate = board.value?.places.find(place => place.id === manualPlaceId.value);
    const slot = board.value?.grid.find(slot => String(slot.startsAt) === String(manualStartsAt.value));
    return candidate && slot ? { placeId: candidate.id, label: candidate.label, startsAt: slot.startsAt,
      availableCount: slot.availableCount, participantCount: board.value.participantCount, votes: candidate.votes ?? 0 } : null;
  });
  watch([manualPlaceId, manualStartsAt], () => { acknowledgeNoAvailability.value = false; });
  const capabilities = computed(() => board.value?.capabilities ?? {});
  const contributionsLocked = computed(() => !capabilities.value.canContribute);
  const coordinate = value => value !== null && value !== '' && Number.isFinite(Number(value));
  const validCoordinates = point => coordinate(point.latitude) && coordinate(point.longitude)
    && Math.abs(Number(point.latitude)) <= 90 && Math.abs(Number(point.longitude)) <= 180;
  const hasOriginDraft = computed(() => Boolean(position.label.trim()) || coordinate(position.latitude) || coordinate(position.longitude));
  const selectedOrigins = computed(() => Object.values(slots.value).filter(slot => slot.selected && validCoordinates(slot)).length);
  const timestamp = value => typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : typeof value === 'string' ? Date.parse(value) : NaN;
  const recommendedOptions = computed(() => (recommendationsLoading.value || recommendationsInvalid.value ? [] : travelRecommendations.value?.options ?? board.value?.suggestions ?? [])
    .map(option => ({ ...option, startsAt: timestamp(option.startsAt) }))
    .filter(option => Number.isFinite(option.startsAt) && Number.isFinite(new Date(option.startsAt).getTime()) && option.availableCount > 0
      && board.value?.places.some(p => p.id === option.placeId && (!travelOptions.shelteredOnly || p.sheltered))));
  const pickedPlaceId = ref(''), pickedStartsAt = ref(''), selectionTouched = ref(false);
  const placeChoices = computed(() => {
    const grouped = new Map();
    recommendedOptions.value.forEach((option, index) => {
      const ranked = { ...option, rank: index + 1 };
      if (!grouped.has(option.placeId)) grouped.set(option.placeId, { placeId: option.placeId, label: option.label,
        best: ranked, maximumAvailable: option.availableCount, times: [] });
      const choice = grouped.get(option.placeId);
      choice.maximumAvailable = Math.max(choice.maximumAvailable, option.availableCount);
      choice.times.push(ranked);
    });
    return [...grouped.values()];
  });
  const pickedPlace = computed(() => placeChoices.value.find(choice => choice.placeId === pickedPlaceId.value) ?? null);
  const pickedOption = computed(() => pickedPlace.value?.times.find(option => String(option.startsAt) === pickedStartsAt.value) ?? null);
  const pickedVotes = computed(() => board.value?.places.find(candidate => candidate.id === pickedPlaceId.value)?.votes ?? pickedOption.value?.votes ?? 0);
  const comparingOptions = ref(false);
  const bestOption = computed(() => recommendedOptions.value[0] ?? null);
  const pickedIsBest = computed(() => pickedOption.value?.placeId === bestOption.value?.placeId
    && pickedOption.value?.startsAt === bestOption.value?.startsAt);
  function useBestOption() {
    if (!bestOption.value || busy.value || refreshing.value) return;
    pickPlace(bestOption.value.placeId); pickTime(bestOption.value.startsAt);
  }
  function pickPlace(placeId) {
    const choice = placeChoices.value.find(option => option.placeId === placeId);
    if (!choice) return;
    selectionTouched.value = true; pickedPlaceId.value = placeId; pickedStartsAt.value = String(choice.best.startsAt);
  }
  function pickTime(startsAt) {
    if (!pickedPlace.value?.times.some(option => String(option.startsAt) === String(startsAt))) return;
    selectionTouched.value = true; pickedStartsAt.value = String(startsAt);
  }
  const rankingMessage = computed(() => travelRecommendations.value?.rankingMessage ?? board.value?.rankingMessage
    ?? 'Ranked by attendance, combined journey burden, longest individual journey, then place votes. Votes break journey ties; earlier times break remaining ties.');
  const recommendationMethod = computed(() => {
    const basis = travelRecommendations.value?.rankingBasis ?? board.value?.rankingBasis;
    if (basis === 'route_times') return 'Comparing route times using saved car or public-transport choices. These are estimates, not live traffic predictions.';
    if (basis === 'insufficient_journey_data') return 'Insufficient journey data for a consistent travel comparison. Coverage is shown for each time; unknown journeys are not counted as zero. Transport choices do not affect straight-line estimates.';
    return 'Straight-line distance estimate. Transport choices do not affect straight-line estimates. Missing starting locations make comparisons less reliable.';
  });
  const recommendationScope = computed(() => travelRecommendations.value
    ? `Route comparison covers ${travelRecommendations.value.options?.length ?? 0} time/place options across ${travelRecommendations.value.shortlistedPlaces ?? '?'} of ${travelRecommendations.value.eligiblePlaces ?? board.value?.places.length ?? '?'} eligible places. This is a bounded shortlist, not a global route optimization.` : 'Suggestions use saved availability. You choose the final time and place; recommendations do not confirm a meetup.');
  const hasSavedAvailability = computed(() => board.value?.grid.some(slot => slot.availableCount > 0));
  const recommendationEmpty = computed(() => recommendationsLoading.value ? 'Updating filtered recommendations…'
    : recommendationsInvalid.value ? 'Recommendations need refreshing. Your saved places remain in step 2.'
    : !board.value?.places.length ? 'No places suggested yet. Add a public meeting place in step 2.'
    : travelOptions.shelteredOnly && !board.value.places.some(p => p.sheltered) ? 'The shelter filter excludes all suggested places. Clear it or suggest a sheltered place.'
      : !hasSavedAvailability.value ? 'Your suggested places are saved. Recommendations will appear once participants save their available times.'
        : 'No suitable time and place combinations yet. Review saved availability or suggest another place.');
  const travelOptions = reactive({ shelteredOnly: false });
  const selectedSlotCount = computed(() => Object.values(slots.value).filter(slot => slot.selected).length);
  const bestSavedOverlap = computed(() => (board.value?.grid ?? []).reduce((best, slot) =>
    slot.availableCount > (best?.availableCount ?? 0) ? slot : best, null));
  const selectedTimes = computed({
    get: () => Object.entries(slots.value).filter(([, slot]) => slot.selected).map(([start]) => Number(start)),
    set: times => {
      const chosen = new Set(times);
      for (const [start, slot] of Object.entries(slots.value)) slot.selected = chosen.has(Number(start));
      availabilityResponse.value = chosen.size ? 'available' : 'unanswered';
    },
  });
  const scope = computed(() => normalizeMeetupScope(route.query));
  const hasActiveBoards = computed(() => boards.value.some(plan => !isMeetupHistorical(plan)));
  const showCreation = computed(() => creationContext.value?.capabilities.canCreate && creationContext.value.policy?.canSchedule !== false
    && (!hasActiveBoards.value || creatingAdditional.value));
  const returnRoute = computed(() => props.id ? meetupReturnRoute(board.value ?? {}, route.query)
    : Object.keys(scope.value).length ? meetupReturnRoute({ scope: scope.value }, route.query) : '/messages');
  const returnLabel = computed(() => returnRoute.value === '/messages' ? 'Back to messages'
    : meetupReturnLabel(board.value ?? { scope: scope.value }, route.query));
  const isSoleApprover = computed(() => board.value?.requiredApprovers?.length === 1
    && board.value.requiredApprovers[0] === currentUser.value?.id && capabilities.value.isOrganizer);
  const proposalLabel = computed(() => isSoleApprover.value ? 'Confirm this time & place' : 'Propose this time & place');
  const proposalGuidance = computed(() => isSoleApprover.value
    ? 'Confirming fixes the time and place.'
    : board.value?.scope?.kakiConversationId || board.value?.kaki_conversation_id
      ? 'Both companions then need to approve it.' : 'Both organizers then need to approve it.');
  const proposalReviewBody = computed(() => {
    const selected = proposalReview.value;
    if (!selected) return '';
    const attendance = selected.availableCount < selected.participantCount
      ? `Only ${selected.availableCount} of ${selected.participantCount} participants marked themselves available for this time.`
      : `${selected.availableCount} of ${selected.participantCount} participants marked themselves available.`;
    return `${selected.label} · ${time(selected.startsAt)}. ${attendance} ${selected.votes ?? 0} place ${(selected.votes ?? 0) === 1 ? 'vote' : 'votes'}${selected.preferred ? '; your preferred place' : ''}. ${selected.immediate
      ? 'This action immediately confirms the meetup and records your organizer approval. Availability and places will be locked until planning is reopened.'
      : 'This submits a formal proposal. The required organizers must then approve it before the meetup is confirmed; availability and places are locked while approval is pending.'}`;
  });
  const approvalGuidance = computed(() => {
    const plan = board.value;
    if (!plan) return '';
    if (plan.status === 'confirmed') return 'All required approvals are recorded. This is the agreed time and place.';
    if (plan.status === 'cancelled') return 'This meetup has ended. Its saved contributions remain available for reference.';
    if (plan.hasApproved) return 'Your approval is saved. Waiting for the other required organizer.';
    if (plan.requiredApprovers?.includes(currentUser.value?.id)) return 'Your approval is still needed for this version of the plan.';
    return 'The required organizers approve the final plan. You can discuss any changes below.';
  });
  const plannerSteps = ['availability', 'places', 'review'];
  const stepFromHash = () => plannerSteps.find(step => route.hash === `#meetup-${step}`) ?? 'availability';
  const activeStep = ref(stepFromHash());
  watch(() => route.hash, () => { activeStep.value = stepFromHash(); });
  const savedSlots = ref('[]'), refreshing = ref(false), syncNote = ref('');
  watch([placeChoices, () => loading.value || busy.value || refreshing.value || recommendationsLoading.value || recommendationsInvalid.value], ([choices, pending]) => {
    if (!choices.length) {
      if (!pending) { pickedPlaceId.value = ''; pickedStartsAt.value = ''; }
      return;
    }
    const retainedPlace = choices.find(choice => choice.placeId === pickedPlaceId.value);
    const choice = selectionTouched.value && retainedPlace ? retainedPlace : choices[0];
    const retainedTime = selectionTouched.value && retainedPlace && choice.times.find(option => String(option.startsAt) === pickedStartsAt.value);
    pickedPlaceId.value = choice.placeId;
    pickedStartsAt.value = String((retainedTime || choice.best).startsAt);
  }, { immediate: true, flush: 'sync' });
  const selectionSnapshot = rows => JSON.stringify(Object.entries(rows).filter(([, slot]) => slot.selected)
    .map(([start, slot]) => [Number(start), slot.travelMode, slot.latitude, slot.longitude, slot.label]));
  const availabilityDirty = computed(() => selectionSnapshot(slots.value) !== savedSlots.value
    || availabilityResponse.value !== savedAvailabilityResponse.value);
  const journeySnapshot = () => JSON.stringify(position);
  const appliedJourney = ref(journeySnapshot());
  const journeyDirty = computed(() => journeySnapshot() !== appliedJourney.value
    && (hasOriginDraft.value || position.travelMode !== JSON.parse(appliedJourney.value).travelMode));
  const placeDirty = computed(() => {
    if (!editingPlaceId.value) return Boolean(place.label.trim() || String(place.latitude).trim() || String(place.longitude).trim() || !place.sheltered);
    const saved = board.value?.places.find(candidate => candidate.id === editingPlaceId.value);
    return !saved || place.label.trim() !== saved.label || Number(place.latitude) !== saved.latitude
      || Number(place.longitude) !== saved.longitude || place.sheltered !== Boolean(saved.sheltered);
  });
  const hasUnsavedDrafts = computed(() => Boolean(props.id && currentUser.value && board.value && (
    availabilityDirty.value || journeyDirty.value || comment.value.trim() || placeDirty.value)));
  const hasOwnSavedTimes = computed(() => savedSlots.value !== '[]');
  const organizerRole = computed(() => capabilities.value.isOrganizer
    ? 'You help choose and approve the final plan. Everyone can share times, suggest places and vote while planning is open.'
    : 'You can share times, suggest places and vote while planning is open. The required organizers choose and approve the final plan.');
  const nextStep = computed(() => {
    const plan = board.value;
    if (!plan) return null;
    if (plan.status === 'confirmed') return { title: 'Your meetup is confirmed', body: 'The agreed time and place are saved. Check travel information before setting off; discussion stays open.', label: 'View the agreed plan', step: 'review', target: '.meetup-current-proposal' };
    if (plan.status === 'cancelled') return { title: 'This meetup is cancelled', body: 'Saved contributions are read-only. Return to your conversation to arrange another plan.', label: 'View the saved plan', step: 'review', target: '.meetup-current-proposal' };
    if (plan.status === 'proposed') {
      if (capabilities.value.canApprove) return { title: 'Your approval is needed', body: 'Review the proposed time and place, then explicitly approve this version. It is confirmed only when every required approval is recorded.', label: 'Review and approve', step: 'review', target: '.meetup-current-proposal .btn--success' };
      return { title: plan.hasApproved ? 'Waiting for the remaining approval' : 'Waiting for organizer approval', body: plan.hasApproved ? 'Your approval is saved. The other required approver still needs to review this version.' : 'The organizers are reviewing this proposal. You can read it and discuss any concerns; place votes do not count as approval.', label: 'View the proposal', step: 'review', target: '.meetup-current-proposal' };
    }
    if (!capabilities.value.canContribute) return { title: 'View the planning progress', body: 'Your current permissions allow you to inspect this plan. Contribution controls follow the current planning permissions.', label: 'View planning discussion', step: 'review', target: '.meetup-discussion' };
    if (availabilityDirty.value) return { title: 'Save your time changes', body: 'Your selected times are still a private draft. Recommendations and other participants use your last saved availability until you save.', label: 'Review and save my times', step: 'availability', target: '.meetup-save-bar .btn--primary' };
    if (journeyDirty.value) return { title: 'Apply your optional journey details', body: 'These starting-point or travel changes have not been applied. Apply them to selected times, then save your availability. You can also leave the starting point blank.', label: 'Review journey details', step: 'availability', target: '.meetup-journey' };
    if (placeDirty.value) return { title: editingPlaceId.value ? 'Save your place correction' : 'Share your place suggestion', body: 'This place is still a draft. Saving shares it with participants; it does not select a final time or approve a meetup.', label: 'Review my place draft', step: 'places', target: '.meetup-place-editor input[required]' };
    if (comment.value.trim()) return { title: 'Finish your discussion message', body: 'Your message has not been posted. Review it in the discussion before leaving this planner.', label: 'Review my message', step: 'review', target: '.meetup-discussion textarea' };
    if (capabilities.value.canPropose && recommendationsInvalid.value) return { title: 'Refresh the recommendations', body: 'Your saved contributions are kept. Refresh the options before choosing the final time and place.', label: 'Reload recommendations', refresh: true };
    if (capabilities.value.canPropose && bestOption.value) return { title: 'Review a time and place for your group', body: `${bestOption.value.availableCount} of ${bestOption.value.participantCount} participants marked themselves available for the leading option. Review it or compare alternatives before submitting.`, label: 'Review the recommendation', step: 'review', target: '.meetup-option .btn--primary' };
    if (!hasResponded.value) return { title: 'Share when you can meet', body: 'No response is saved for you. Select the half-hour blocks you can make, or tell the group you cannot make these times, then save. You can explore the other steps first.', label: 'Choose my available times', step: 'availability', target: '[data-availability-start]' };
    if (!plan.places.length) return { title: 'Suggest somewhere to meet', body: 'Your response is saved. Add a public meeting place so the group can compare time and place options. A suggestion is not a confirmed plan.', label: 'Suggest a meeting place', step: 'places', target: '.meetup-place-editor input[required]' };
    if (capabilities.value.canPropose) return { title: 'Collect availability for a recommendation', body: 'Places are saved, but there is no usable time and place combination yet. Ask participants to save times, or review the saved availability.', label: 'Review group availability', step: 'availability', target: '.meetup-time-context' };
    return plan.currentVotePlaceId
      ? { title: 'Your place preference is saved', body: 'Your vote helps the organizers compare places. It does not approve a meeting time. You can change your vote or discuss the plan while organizers choose.', label: 'View planning discussion', step: 'review', target: '.meetup-discussion' }
      : { title: 'Help choose a meeting place', body: 'Your response is saved. Suggest a place or optionally vote for an existing one. The organizers choose the final time and place; you do not need to vote to read the discussion.', label: 'Explore suggested places', step: 'places', target: '.meetup-suggested-places' };
  });
  async function followNextStep() {
    if (busy.value || refreshing.value || !nextStep.value) return;
    if (nextStep.value.refresh) { await refreshPlanner(); return; }
    const key = context();
    const { step, target } = nextStep.value;
    showStep(step);
    await nextTick();
    if (context() !== key || !board.value) return;
    const element = document.querySelector(target);
    if (!element) return;
    if (element instanceof HTMLDetailsElement) element.open = true;
    if (!element.matches('button, input, textarea, select, summary, [tabindex]')) element.tabIndex = -1;
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
  }
  // Hash changes only switch stages on the same board. All other ordinary
  // navigation shares one confirmation, including Back and in-app links.
  const stopNavigationGuard = router.beforeEach((to, from) => {
    if (!hasUnsavedDrafts.value || (to.path === from.path
      && JSON.stringify(normalizeMeetupScope(to.query)) === JSON.stringify(normalizeMeetupScope(from.query)))) return true;
    if (!resolveLeave) {
      leavePrompt.value = true;
      const pending = new Promise(resolve => { resolveLeave = resolve; });
      leaveDecision = pending;
    }
    return leaveDecision;
  });
  let leaveDecision;
  function settleLeave(discard) {
    const resolve = resolveLeave;
    resolveLeave = null; leavePrompt.value = false; leaveDecision = undefined;
    resolve?.(discard);
  }
  function beforeUnload(event) {
    if (!hasUnsavedDrafts.value) return;
    event.preventDefault(); event.returnValue = '';
  }
  const clearNotice = area => { feedback[area] = ''; failures[area] = ''; };
  watch(() => `${availabilityResponse.value}:${selectionSnapshot(slots.value)}`, () => { feedback.availability = ''; }, { flush: 'sync' });
  watch(journeySnapshot, () => { feedback.journey = ''; }, { flush: 'sync' });
  watch(() => JSON.stringify(place), () => {
    if (place.label.trim() || place.latitude !== '' || place.longitude !== '' || !place.sheltered) feedback.places = '';
  });
  watch(comment, value => { if (value.trim()) feedback.discussion = ''; });
  const lookupPoint = location => ({ label: location.label, latitude: location.latitude, longitude: location.longitude });
  function selectLocation(target, lookup, location) {
    const point = lookupPoint(location);
    Object.assign(target, point); lookup.value = point;
  }
  function invalidateLocation(target, lookup) {
    if (!lookup.value) return;
    // Only clear fields still derived from this lookup, never intentional
    // manual edits or coordinates already applied to availability periods.
    for (const field of ['label', 'latitude', 'longitude'])
      if (String(target[field]) === String(lookup.value[field])) target[field] = '';
    lookup.value = null;
  }
  function editLocation(target, lookup, reset, field) {
    if (!lookup.value) return;
    if (field === 'label') { target.latitude = ''; target.longitude = ''; }
    lookup.value = null; reset.value++;
  }
  const selectPlace = location => selectLocation(place, placeLookup, location);
  const selectJourney = location => selectLocation(position, journeyLookup, location);
  const invalidatePlace = () => invalidateLocation(place, placeLookup);
  const invalidateJourney = () => invalidateLocation(position, journeyLookup);
  const editPlace = field => editLocation(place, placeLookup, placeSearchKey, field);
  const editJourney = field => editLocation(position, journeyLookup, journeySearchKey, field);
  const liveLabel = computed(() => connectionState.value === 'live' ? 'Live with your group' : 'Keeping your group in sync');
  let alive = true, loadRequest = 0, refreshTimer, pollTimer, stopEvents, refreshQueued = false;
  const context = () => `${props.id ?? ''}:${currentUser.value?.id ?? ''}:${JSON.stringify(scope.value)}`;
  const statuses = { planning: "Collecting availability", proposed: "Awaiting required approvals", confirmed: "Meetup confirmed", cancelled: "Meetup cancelled" };
  const iso = (ms) => new Date(ms).toISOString();
  const time = formatMeetupDateTime;
  function clearUnavailable(message = 'This meetup is unavailable, or you are no longer a participant.') {
    loadRequest++;
    board.value = null; slots.value = {}; savedSlots.value = '[]';
    availabilityResponse.value = savedAvailabilityResponse.value = 'unanswered';
    travelRecommendations.value = null; transport.value = null; weather.value = null; rainfall.value = null;
    confirmAction.value = null; proposalReview.value = null; removingPlace.value = null;
    error.value = message;
  }
  async function load({ preserveDrafts = false } = {}) {
    const key = context(), request = ++loadRequest;
    if (props.id) {
      const data = (await api.meetup(props.id, travelOptions.shelteredOnly ? { shelteredOnly: true } : {})).meetup;
      if (!alive || context() !== key || request !== loadRequest) return;
      const keepDraft = preserveDrafts && availabilityDirty.value;
      if (board.value?.version !== data.version || board.value?.participationRevision !== data.participationRevision) {
        travelRecommendations.value = null; transport.value = null; weather.value = null; rainfall.value = null;
      }
      const nextSlots = Object.fromEntries(
        data.grid.map((s) => {
          const own = data.availability.find(
            (a) => a.starts_at <= s.startsAt && a.ends_at >= s.startsAt + 1800000,
          );
          return [
            s.startsAt,
            {
              selected: Boolean(own),
              latitude: own?.latitude ?? null,
              longitude: own?.longitude ?? null,
              label: own?.label ?? "",
              travelMode: own?.travel_mode ?? own?.travelMode ?? 'transit',
            },
          ];
        }),
      );
      savedSlots.value = selectionSnapshot(nextSlots);
      savedAvailabilityResponse.value = data.availabilityResponse ?? (data.availability.length ? 'available' : 'unanswered');
      if (!keepDraft) availabilityResponse.value = savedAvailabilityResponse.value;
      if (keepDraft) for (const start of Object.keys(nextSlots)) if (slots.value[start]) nextSlots[start] = slots.value[start];
      slots.value = nextSlots;
      for (const [start, point] of slotLookups) if (!nextSlots[start]
        || ['label', 'latitude', 'longitude'].some(field => String(nextSlots[start][field]) !== String(point[field]))) slotLookups.delete(start);
      const firstLoad = !board.value;
      board.value = data;
      if (recommendationsInvalid.value) failures.recommendations = '';
      recommendationsInvalid.value = false;
      if (firstLoad && !plannerSteps.some(step => route.hash === `#meetup-${step}`))
        activeStep.value = ['proposed', 'confirmed', 'cancelled'].includes(data.status) ? 'review' : 'availability';
      if (data.status === 'cancelled') syncNote.value = 'This plan was cancelled. Your draft has been kept for reference.';
      else if (keepDraft) syncNote.value = data.status === 'planning' ? 'Group updates received. Your unsaved availability is kept.'
        : 'Planning is locked. Your unsaved availability is kept; an organizer must reopen planning before you can save it.';
      else syncNote.value = '';
    } else {
      const scoped = Object.keys(scope.value).length > 0;
      const data = scoped ? await api.meetupContext(scope.value) : await api.meetups();
      if (alive && context() === key && request === loadRequest) {
        boards.value = scoped ? data.context.meetups ?? [] : data.meetups;
        creationContext.value = scoped ? data.context : null;

      }
    }
  }
  watch(
    context,
    async () => {
      loadRequest++;
      error.value = "";
      creationContext.value = null; confirmAction.value = null;
      proposalReview.value = null; removingPlace.value = null; editingPlaceId.value = null;
      pickedPlaceId.value = ''; pickedStartsAt.value = ''; selectionTouched.value = false;
      comparingOptions.value = false;
      manualPlaceId.value = ''; manualStartsAt.value = ''; acknowledgeNoAvailability.value = false;
      availabilityResponse.value = savedAvailabilityResponse.value = 'unanswered';
      recommendationsLoading.value = false; recommendationsInvalid.value = false;
      createdAttempt = null; slotLookups.clear();
      creatingAdditional.value = false;
      for (const key of Object.keys(feedback)) delete feedback[key];
      for (const key of Object.keys(failures)) delete failures[key];
      board.value = null;
      activeStep.value = stepFromHash();
      boards.value = []; slots.value = {}; savedSlots.value = '[]'; syncNote.value = '';
      busy.value = false; refreshing.value = false; refreshQueued = false; clearTimeout(refreshTimer);
      comment.value = ''; travelRecommendations.value = null;
      Object.assign(place, { label: '', latitude: '', longitude: '', sheltered: true });
      Object.assign(position, { latitude: '', longitude: '', label: '', travelMode: 'transit' });
      appliedJourney.value = journeySnapshot();
      placeLookup.value = null; journeyLookup.value = null;
      placeSearchKey.value++; journeySearchKey.value++;
      settleLeave(false);
      travelOptions.shelteredOnly = false;
      weather.value = null;
      rainfall.value = null;
      transport.value = null;
      loading.value = true;
      const key = context();
      if (!currentUser.value) { loading.value = false; return; }
      try {
        await load();
      } catch (e) {
        if (context() === key) error.value = e.status === 404 ? "This meetup is unavailable, or you are no longer a participant." : "Could not load your meetup plans. Please try again.";
      } finally {
        if (alive && context() === key) loading.value = false;
      }
    },
    { immediate: true },
  );
  async function refreshPlanner() {
    if (!alive || !currentUser.value || document.visibilityState !== 'visible') return;
    if (busy.value || refreshing.value) { refreshQueued = true; return; }
    const key = context();
    refreshing.value = true;
    try { await load({ preserveDrafts: true }); }
    catch (e) {
      if (!alive || context() !== key) return;
      if ([401, 403, 404].includes(e.status)) {
        clearUnavailable();
      } else syncNote.value = 'Live refresh paused. Your draft is safe; use Refresh planner to retry.';
    } finally {
      if (context() === key) {
        refreshing.value = false;
        if (refreshQueued && !busy.value) scheduleRefresh();
      }
    }
  }
  function scheduleRefresh() {
    refreshQueued = true;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (busy.value || refreshing.value) return;
      refreshQueued = false;
      void refreshPlanner();
    }, 150);
  }
  // Detail access already authorizes reading every stage. Missing personal
  // availability is guidance, not a server contribution or approval restriction.
  const stepUnlocked = step => plannerSteps.includes(step);
  function showStep(step) {
    if (!plannerSteps.includes(step) || !stepUnlocked(step)) return;
    activeStep.value = step;
    if (props.id && route.hash !== `#meetup-${step}`)
      void router.replace({ path: route.path, query: route.query, hash: `#meetup-${step}` });
    document.getElementById(`meetup-tab-${step}`)?.focus({ preventScroll: true });
  }
  function navigateSteps(event) {
    let index = plannerSteps.indexOf(activeStep.value);
    if (event.key === 'ArrowRight') index = (index + 1) % plannerSteps.length;
    else if (event.key === 'ArrowLeft') index = (index + plannerSteps.length - 1) % plannerSteps.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = plannerSteps.length - 1;
    else return;
    event.preventDefault();
    showStep(plannerSteps[index]);
  }
  onMounted(() => {
    stopEvents = onChatEvent((type, data) => {
      if (type === 'ready' || type === 'group-members'
        || (type === 'meetup-updated' && (!props.id || data.meetupId === props.id))) scheduleRefresh();
    });
    window.addEventListener('focus', scheduleRefresh);
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', scheduleRefresh);
    // Reconcile missed events and separate server processes without provider calls.
    pollTimer = setInterval(scheduleRefresh, 15000);
  });
  onUnmounted(() => {
    alive = false; loadRequest++; stopEvents?.(); clearTimeout(refreshTimer); clearInterval(pollTimer);
    window.removeEventListener('focus', scheduleRefresh);
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('visibilitychange', scheduleRefresh);
    stopNavigationGuard(); settleLeave(false);
  });
  async function act(fn, { savingAvailability = false, area = 'review', success = '', onSaved } = {}) {
    if (busy.value) return;
    const key = context();
    busy.value = true;
    error.value = "";
    feedback[area] = ''; failures[area] = '';
    try {
      const result = await fn();
      invalidateMeetupSummaries();
      if (!alive || context() !== key) return;
      onSaved?.(result);
      if (savingAvailability) {
        savedSlots.value = selectionSnapshot(slots.value);
        savedAvailabilityResponse.value = availabilityResponse.value;
      }
      // A successful mutation must not be reported as a failed save merely
      // because its follow-up read was unavailable.
      try { await load({ preserveDrafts: !savingAvailability }); }
      catch (refreshError) {
        if (!alive || context() !== key) return;
        if ([401, 403, 404].includes(refreshError.status)) {
          clearUnavailable('Your change was saved, but this meetup is no longer available to you.');
          return true;
        }
        syncNote.value = 'Your change was saved. Group details could not refresh; use Refresh planner to retry.';
      }
      if (context() !== key) return;
      feedback[area] = typeof success === 'function' ? success(result) : success;
      return true;
    } catch (e) {
      if (!alive || context() !== key) return;
      if (e.status === 401 || ['meetup_not_found', 'scope_membership_required'].includes(e.message)) {
        clearUnavailable(); return;
      }
      failures[area] = meetupErrorMessage(e.message);
      if (['stale_meetup_version', 'stale_meetup_membership'].includes(e.message)) await refreshPlannerAfterConflict();
    } finally {
      if (context() === key) {
        busy.value = false;
        if (refreshQueued) scheduleRefresh();
      }
    }
  }
  async function discardAvailability() {
    if (busy.value) return;
    const key = context(); busy.value = true;
    try { await load(); }
    catch { if (context() === key) error.value = 'Could not reload your saved availability. Please try again.'; }
    finally { if (context() === key) busy.value = false; }
  }
  async function refreshPlannerAfterConflict() {
    try { await load({ preserveDrafts: true }); }
    catch { /* Keep the original conflict and the draft available for retry. */ }
  }
  async function create(input, settleAttempt = () => {}) {
    if (busy.value) return;
    const key = context(), creationScope = { ...scope.value }, from = route.query.from;
    let created = false;
    busy.value = true; clearNotice('creation');
    try {
      const r = createdAttempt?.requestId === input.creationRequestId ? { meetup: createdAttempt.meetup }
        : await api.createMeetup({ ...input, ...creationScope });
      if (!r?.meetup || typeof r.meetup.id !== 'string' || !r.meetup.id.trim()) throw new Error('invalid_creation_response');
      created = true;
      settleAttempt('created');
      invalidateMeetupSummaries();
      if (!alive || context() !== key) return;
      createdAttempt = { requestId: input.creationRequestId, meetup: r.meetup };
      const failure = await router.push(meetupRouteForBoard(r.meetup, { from: normalizeMeetupOrigin(from), stage: 'availability' }));
      if (failure && alive && context() === key) failures.creation = 'Your plan was created. Press Open created plan to open it safely.';
    } catch (e) {
      settleAttempt(created ? 'created' : e.status >= 400 && e.status < 500 ? 'rejected' : 'uncertain');
      if (alive && context() === key) failures.creation = created
        ? 'Your plan was created. Press Open created plan to open it safely.' : meetupErrorMessage(e.message);
    } finally { if (alive && context() === key) busy.value = false; }
  }
  async function saveAvailability() {
    if (busy.value) return;
    clearNotice('availability');
    const selected = Object.values(slots.value).filter(slot => slot.selected);
    if (selected.some(slot => (slot.label?.trim() || coordinate(slot.latitude) || coordinate(slot.longitude)
      || (slot.latitude !== null && slot.latitude !== '' && slot.latitude !== undefined)
      || (slot.longitude !== null && slot.longitude !== '' && slot.longitude !== undefined)) && !validCoordinates(slot))) {
      failures.availability = meetupErrorMessage('invalid_availability'); return;
    }
    const ok = await act(() =>
      api.meetupAvailability(
        props.id,
        Object.entries(slots.value)
          .filter(([, s]) => s.selected)
          .map(([start, s]) => ({
            startsAt: iso(Number(start)),
            endsAt: iso(Number(start) + 1800000),
            travelMode: s.travelMode ?? 'transit',
            ...(validCoordinates(s)
              ? { latitude: Number(s.latitude), longitude: Number(s.longitude), label: s.label }
              : {}),
          })),
        board.value.version,
        ...(!selected.length ? [availabilityResponse.value] : []),
      ),
      { savingAvailability: true, area: 'availability', onSaved: result => {
        travelRecommendations.value = null; recommendationsInvalid.value = true;
        const previous = board.value.availabilityResponse ?? (board.value.availability.length ? 'available' : 'unanswered');
        const status = availabilityResponse.value;
        if (board.value.availabilityResponses && previous !== status) {
          const counts = { ...board.value.availabilityResponses };
          counts[`${previous}Count`]--; counts[`${status}Count`]++;
          counts.respondedCount += Number(status !== 'unanswered') - Number(previous !== 'unanswered');
          board.value.availabilityResponses = counts;
        }
        board.value.availabilityResponse = status; board.value.hasResponded = status !== 'unanswered';
        if (Number.isInteger(result.result?.version)) board.value.version = result.result.version;
      }, success: () => availabilityResponse.value === 'unavailable'
        ? "Your availability has been saved. The group knows you cannot make these times."
        : availabilityResponse.value === 'unanswered' ? 'Your saved response has been cleared. You have not marked yourself unavailable.'
          : 'Your availability has been saved.' },
    );
    if (ok) feedback.journey = '';
  }
  function assignJourney() {
    failures.journey = ''; feedback.journey = ''; feedback.availability = '';
    if (contributionsLocked.value || busy.value || !selectedSlotCount.value) return;
    if (hasOriginDraft.value && !validCoordinates(position)) {
      failures.journey = 'Select a starting location from the search results, or enter both valid coordinates under Advanced/manual entry.';
      return;
    }
    for (const [start, slot] of Object.entries(slots.value)) if (slot.selected) {
      slot.travelMode = position.travelMode;
      if (hasOriginDraft.value) {
        Object.assign(slot, { latitude: Number(position.latitude), longitude: Number(position.longitude), label: position.label.trim() });
        if (journeyLookup.value) slotLookups.set(start, lookupPoint(slot));
        else slotLookups.delete(start);
      }
    }
    appliedJourney.value = journeySnapshot();
    feedback.journey = `Journey details applied to ${selectedSlotCount.value} selected ${selectedSlotCount.value === 1 ? 'time' : 'times'}. ${availabilityDirty.value ? 'Not saved yet. Save to share.' : 'These details already match your saved availability.'}`;
  }
  async function addPlace() {
    if (busy.value) return;
    clearNotice('places');
    if (!place.label.trim() || !validCoordinates(place)) { failures.places = meetupErrorMessage('invalid_place'); return; }
    const label = place.label.trim(), editing = editingPlaceId.value;
    const data = { ...place, label, version: board.value.version, latitude: Number(place.latitude), longitude: Number(place.longitude) };
    const ok = await act(() => editing ? api.updateMeetupPlace(props.id, editing, data) : api.proposeMeetupPlace(props.id, data), { area: 'places',
      onSaved: result => {
        travelRecommendations.value = null; recommendationsInvalid.value = true;
        if (Number.isInteger(result.place?.version)) board.value.version = result.place.version;
        if (!editing && result.place?.id && !result.place.unchanged && !board.value.places.some(candidate => candidate.id === result.place.id))
          board.value.places = [...board.value.places, { ...data, id: result.place.id, proposed_by: currentUser.value.id,
            votes: 0, canEdit: true, canRemove: true }];
        if (editing && !result.place?.unchanged) board.value = { ...board.value,
          places: board.value.places.map(candidate => candidate.id === editing ? { ...candidate, ...data, votes: 0 } : candidate),
          currentVotePlaceId: board.value.currentVotePlaceId === editing ? null : board.value.currentVotePlaceId };
      },
      success: result => editing ? result.place?.unchanged ? `${label} already matches the saved suggestion. Existing votes are kept.`
        : `${label} has been corrected. Existing votes for this place were cleared; participants can vote again.`
        : `${label} is saved in suggested places.${hasSavedAvailability.value ? '' : ' Recommendations will appear once participants save their available times.'}` });
    if (ok) resetPlaceDraft();
  }
  function resetPlaceDraft() {
    Object.assign(place, { label: '', latitude: '', longitude: '', sheltered: true });
    editingPlaceId.value = null; placeLookup.value = null; placeSearchKey.value++;
  }
  function correctPlace(candidate) {
    if (busy.value || !candidate.canEdit) return;
    if (place.label.trim() || String(place.latitude).trim() || String(place.longitude).trim()) {
      failures.places = 'Save or clear your current place draft before correcting a saved suggestion.';
      return;
    }
    clearNotice('places');
    editingPlaceId.value = candidate.id;
    Object.assign(place, { label: candidate.label, latitude: candidate.latitude, longitude: candidate.longitude, sheltered: Boolean(candidate.sheltered) });
    // A saved suggestion has established coordinates. Renaming it should not
    // invalidate them; a newly selected search replacement still does.
    placeLookup.value = null; placeSearchKey.value++;
    document.querySelector('.meetup-place-editor input[required]')?.focus();
  }
  function requestRemovePlace(candidate) {
    if (!busy.value && candidate.canRemove) removingPlace.value = { ...candidate, version: board.value.version };
  }
  async function removePlace() {
    const selected = removingPlace.value, key = context();
    if (!selected) return;
    await act(() => api.removeMeetupPlace(props.id, selected.id, selected.version), { area: 'places',
      onSaved: result => {
        if (Number.isInteger(result.result?.version)) board.value.version = result.result.version;
        board.value.places = board.value.places.filter(candidate => candidate.id !== selected.id);
        if (board.value.currentVotePlaceId === selected.id) board.value.currentVotePlaceId = null;
        board.value.suggestions = board.value.suggestions.filter(option => option.placeId !== selected.id);
        travelRecommendations.value = null; recommendationsInvalid.value = true;
        if (editingPlaceId.value === selected.id) resetPlaceDraft();
      }, success: `${selected.label} and its associated votes have been removed.` });
    if (context() === key) removingPlace.value = null;
  }
  function vote(placeId) {
    const previous = board.value.currentVotePlaceId, removing = previous === placeId;
    return act(() => removing ? api.removeMeetupVote(props.id, board.value.version) : api.voteMeetupPlace(props.id, placeId, board.value.version), {
      area: 'places', success: removing ? 'Your vote has been removed.' : 'Your vote has been saved. This records your preferred place; the final time and place still need organizer confirmation.',
      onSaved: result => {
        board.value = { ...board.value, currentVotePlaceId: removing ? null : placeId,
          ...(Number.isInteger(result.result?.version) ? { version: result.result.version } : {}),
          places: board.value.places.map(candidate => ({ ...candidate, votes: Math.max(0, (candidate.votes ?? 0)
            - (candidate.id === previous ? 1 : 0) + (!removing && candidate.id === placeId ? 1 : 0)) })) };
        travelRecommendations.value = null; recommendationsInvalid.value = true;
      },
    });
  }
  function requestProposal(option) {
    if (busy.value || refreshing.value || recommendationsLoading.value || recommendationsInvalid.value || !capabilities.value.canPropose || !recommendedOptions.value.some(candidate => candidate.placeId === option?.placeId
      && String(candidate.startsAt) === String(option?.startsAt))) return;
    proposalReview.value = { ...option, version: board.value.version, participationRevision: board.value.participationRevision, immediate: isSoleApprover.value,
      votes: board.value.places.find(candidate => candidate.id === option.placeId)?.votes ?? option.votes ?? 0,
      preferred: board.value.currentVotePlaceId === option.placeId };
  }
  function requestManualProposal() {
    const option = manualOption.value;
    if (!option || busy.value || refreshing.value || recommendationsInvalid.value || recommendationsLoading.value || !capabilities.value.canPropose) return;
    if (!option.availableCount && !acknowledgeNoAvailability.value) {
      failures.recommendations = 'No participant has marked this time available. Acknowledge this before reviewing the proposal.';
      return;
    }
    proposalReview.value = { ...option, manual: true, version: board.value.version,
      participationRevision: board.value.participationRevision,
      acknowledgeNoAvailability: !option.availableCount && acknowledgeNoAvailability.value,
      immediate: isSoleApprover.value, preferred: board.value.currentVotePlaceId === option.placeId };
  }
  function reviewedChoiceExists(option) {
    return option.manual
      ? board.value.places.some(place => place.id === option.placeId)
        && board.value.grid.some(slot => slot.startsAt === option.startsAt && slot.availableCount === option.availableCount)
        && (option.availableCount > 0 || option.acknowledgeNoAvailability === true)
      : recommendedOptions.value.some(candidate => candidate.placeId === option.placeId && String(candidate.startsAt) === String(option.startsAt));
  }
  async function propose() {
    const option = proposalReview.value, key = context();
    if (!option) return;
    if (board.value?.version !== option.version || board.value?.participationRevision !== option.participationRevision || !capabilities.value.canPropose
      || !reviewedChoiceExists(option)) {
      proposalReview.value = null;
      failures.recommendations = 'This recommendation or plan has changed. Review the current time and place before submitting again.';
      return;
    }
    const ok = await act(() => api.proposeMeetupPlan(props.id, { placeId: option.placeId,
      startsAt: iso(option.startsAt), version: option.version,
      ...(option.participationRevision !== undefined ? { participationRevision: option.participationRevision } : {}),
      ...(option.acknowledgeNoAvailability ? { acknowledgeNoAvailability: true } : {}) }), { area: 'review',
      onSaved: result => {
        if (!result.proposal) return;
        const confirmed = Boolean(result.proposal.confirmed);
        board.value.status = confirmed ? 'confirmed' : 'proposed';
        board.value.selected_place_id = option.placeId; board.value.selected_start = option.startsAt;
        if (Number.isInteger(result.proposal.version)) board.value.version = result.proposal.version;
        Object.assign(board.value.capabilities, { canContribute: false, canPropose: false, canReopen: true,
          canApprove: !confirmed && capabilities.value.isOrganizer });
        if (confirmed && option.immediate) {
          board.value.hasApproved = true;
          board.value.approvals = [...new Set([...(board.value.approvals ?? []), currentUser.value.id])];
        }
      }, success: result => result.proposal?.confirmed
        ? 'The meetup is confirmed. Your organizer approval has been recorded.' : 'Your plan has been submitted for approval.' });
    if (context() !== key) return;
    proposalReview.value = null;
    if (ok) showStep('review');
    else if (activeStep.value !== 'review') { failures.recommendations = failures.review; failures.review = ''; }
  }
  function journeySummary(option) {
    if (option.totalTravelMinutes !== null && option.totalTravelMinutes !== undefined) {
      const count = option.routedRespondents ?? option.locationRespondents ?? 0;
      return `${option.totalTravelMinutes} min combined route time for ${count} of ${option.availableCount} available participants; longest journey ${option.maximumTravelMinutes} min${travelRecommendations.value?.rankingBasis !== 'route_times' ? '. Supplementary estimate; not used to rank these results' : ''}.`;
    }
    const count = option.locationRespondents ?? 0;
    if (!count || option.totalDistanceKm === null || option.totalDistanceKm === undefined)
      return `No starting locations supplied for these ${option.availableCount} available participants. Journey burden is unknown.`;
    return `About ${option.totalDistanceKm} km combined distance for ${count} of ${option.availableCount} available participants who supplied a starting location.${option.distanceCoverageComparable === false || option.basis === 'insufficient_journey_data' ? ' Coverage is not comparable; these distances are not used to rank options.' : ''}`;
  }
  async function changeShelterFilter() {
    if (!props.id || !board.value) return;
    const key = context();
    travelRecommendations.value = null; failures.recommendations = ''; recommendationsLoading.value = true;
    try { await load({ preserveDrafts: true }); }
    catch (cause) { if (alive && context() === key) {
      recommendationsInvalid.value = true;
      if ([401, 403, 404].includes(cause.status)) {
        clearUnavailable();
      } else failures.recommendations = 'Could not refresh filtered recommendations. Your saved places are kept; use Refresh planner to retry.';
    } }
    finally { if (alive && context() === key) recommendationsLoading.value = false; }
  }
  const approve = () => act(() => api.approveMeetup(props.id, board.value.version), {
    area: 'review', onSaved: result => {
      if (!result.approval) return;
      if (Number.isInteger(result.approval.version)) board.value.version = result.approval.version;
      board.value.hasApproved = true;
      board.value.approvals = result.approval.approvals ?? [...new Set([...(board.value.approvals ?? []), currentUser.value.id])];
      if (Array.isArray(result.approval.requiredApprovers)) board.value.requiredApprovers = result.approval.requiredApprovers;
      board.value.capabilities.canApprove = false;
      if (result.approval.confirmed) board.value.status = 'confirmed';
    }, success: result => result.approval.confirmed ? 'The meetup is confirmed.' : 'Your approval has been recorded.',
  });
  function requestOrganizerAction(action) {
    confirmAction.value = action;
    confirmVersion.value = board.value.version;
  }
  async function organizerAction() {
    const action = confirmAction.value, key = context();
    const ok = await act(() => action === 'reopen' ? api.reopenMeetup(props.id, confirmVersion.value)
      : api.cancelMeetup(props.id, confirmVersion.value), { area: 'review',
      onSaved: result => {
        if (action === 'reopen' && result.result?.reopened) {
          board.value.status = 'planning'; board.value.selected_place_id = null; board.value.selected_start = null;
          board.value.approvals = []; board.value.hasApproved = false;
          if (Number.isInteger(result.result.version)) board.value.version = result.result.version;
          Object.assign(board.value.capabilities, { canContribute: true, canPropose: true, canApprove: false, canReopen: false });
          travelRecommendations.value = null; recommendationsInvalid.value = true;
        } else if (action === 'cancel' && result.result?.cancelled) {
          board.value.status = 'cancelled';
          Object.assign(board.value.capabilities, { canContribute: false, canPropose: false, canApprove: false, canReopen: false, canCancel: false, canDiscuss: false });
        }
      },
      success: action === 'reopen' ? 'The organizer has reopened planning. A new proposal needs fresh approvals.' : 'The meetup has been cancelled.' });
    if (context() !== key) return;
    confirmAction.value = null;
    if (ok && action === 'reopen') { feedback.availability = feedback.review; feedback.review = ''; showStep('availability'); }
    else showStep('review');
  }
  async function postComment() {
    const ok = await act(() => api.meetupComment(props.id, comment.value), { area: 'discussion', success: 'Your message was posted.' });
    if (ok) comment.value = '';
  }
  // These reads share the same board/session/version guards and never overwrite drafts.
  async function readPlan(request, apply, area, failureMessage) {
    if (busy.value) return;
    const key = context(), version = board.value?.version, participation = board.value?.participationRevision, id = props.id, filter = travelOptions.shelteredOnly;
    busy.value = true; failures[area] = '';
    const stillCurrent = () => alive && context() === key && board.value?.version === version && board.value?.participationRevision === participation && travelOptions.shelteredOnly === filter;
    try {
      const result = await request(id);
      if (stillCurrent()) {
        const recommendations = result.recommendations;
        if (recommendations && (recommendations.version !== version || recommendations.participationRevision !== participation)) {
          travelRecommendations.value = null; recommendationsInvalid.value = true;
          failures.recommendations = 'The plan changed while journey options were loading. Refresh the planner before reviewing a final choice.';
        } else apply(result);
      }
    } catch (cause) {
      if (stillCurrent()) {
        if ([401, 403, 404].includes(cause.status)) clearUnavailable();
        else failures[area] = failureMessage;
      }
    } finally {
      if (context() === key) { busy.value = false; if (refreshQueued) scheduleRefresh(); }
    }
  }
  const getWeather = () => readPlan(id => api.meetupEnvironment(id), ({ environment }) => {
    weather.value = environment.forecast; rainfall.value = environment.rainfall;
  }, 'review', 'Could not load the weather forecast. Please try again.');
  const getTravelSuggestions = () => readPlan(id => api.meetupTravelSuggestions(id, { ...travelOptions }),
    data => { travelRecommendations.value = data.recommendations; recommendationsInvalid.value = false; }, 'recommendations',
    'Could not refresh travel options. Your saved places are still available; try again.');
  const getParking = () => readPlan(id => api.meetupTransport(id, { parkingOnly: 'true' }),
    data => { transport.value = data.transport; }, 'review', 'Could not check nearby parking. Please try again.');

  return {
    route, router, currentUser, context, board, boards, error, busy, loading, creationContext,
    scope, hasActiveBoards, showCreation, creatingAdditional, returnRoute, returnLabel, proposalLabel, proposalGuidance, approvalGuidance,
    weather, rainfall, travelRecommendations, transport, comment, slots, place, position, travelOptions,
    availabilityResponse, savedAvailabilityResponse, unavailable, hasResponded, responseLabel,
    manualPlaceId, manualStartsAt, manualOption, acknowledgeNoAvailability, requestManualProposal,
    feedback, failures, placeSearchKey, journeySearchKey, confirmAction, capabilities, contributionsLocked, selectedOrigins,
    editingPlaceId, removingPlace, proposalReview, proposalReviewBody, recommendationsLoading, recommendationsInvalid,
    leavePrompt, settleLeave, hasUnsavedDrafts, journeyDirty, placeDirty, hasOwnSavedTimes, organizerRole, nextStep, followNextStep,
    selectPlace, selectJourney, invalidatePlace, invalidateJourney, editPlace, editJourney,
    selectedSlotCount, bestSavedOverlap, selectedTimes, activeStep, availabilityDirty, refreshing, syncNote,
    liveLabel, statuses, time, validCoordinates, recommendedOptions, placeChoices, pickedPlace, pickedOption, pickedVotes, pickedStartsAt, pickPlace, pickTime, comparingOptions, bestOption, pickedIsBest, useBestOption, rankingMessage, recommendationMethod, recommendationScope, journeySummary, hasSavedAvailability, recommendationEmpty,
    refreshPlanner, showStep, stepUnlocked, navigateSteps, create, saveAvailability, discardAvailability, assignJourney,
    addPlace, resetPlaceDraft, correctPlace, requestRemovePlace, removePlace, vote, requestProposal, propose, approve, requestOrganizerAction, organizerAction, postComment, getWeather, getTravelSuggestions, getParking, changeShelterFilter,
   };

}
