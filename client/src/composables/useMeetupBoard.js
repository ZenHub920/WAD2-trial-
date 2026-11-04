import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
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
  const placeLookup = ref(null), journeyLookup = ref(null), leavePrompt = ref(false);
  const slotLookups = new Map();
  let createdAttempt = null;
  let resolveLeave;
  const creatingAdditional = ref(false);
  const capabilities = computed(() => board.value?.capabilities ?? {});
  const contributionsLocked = computed(() => !capabilities.value.canContribute);
  const coordinate = value => value !== null && value !== '' && Number.isFinite(Number(value));
  const validCoordinates = point => coordinate(point.latitude) && coordinate(point.longitude)
    && Math.abs(Number(point.latitude)) <= 90 && Math.abs(Number(point.longitude)) <= 180;
  const hasOriginDraft = computed(() => Boolean(position.label.trim()) || coordinate(position.latitude) || coordinate(position.longitude));
  const selectedOrigins = computed(() => Object.values(slots.value).filter(slot => slot.selected && validCoordinates(slot)).length);
  const recommendedOptions = computed(() => (travelRecommendations.value?.options ?? board.value?.suggestions ?? [])
    .filter(option => !travelOptions.shelteredOnly || board.value?.places.some(p => p.id === option.placeId && p.sheltered)));
  const hasSavedAvailability = computed(() => board.value?.grid.some(slot => slot.availableCount > 0));
  const recommendationEmpty = computed(() => !board.value?.places.length ? 'No places suggested yet. Add a public meeting place above.'
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
    ? 'You are this group’s only required organizer. Confirming records your approval and fixes the time and place.'
    : 'Submitting creates a proposal. Both organizers must explicitly approve this version before it is confirmed.');
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
  const selectionSnapshot = rows => JSON.stringify(Object.entries(rows).filter(([, slot]) => slot.selected)
    .map(([start, slot]) => [Number(start), slot.travelMode, slot.latitude, slot.longitude, slot.label]));
  const availabilityDirty = computed(() => selectionSnapshot(slots.value) !== savedSlots.value);
  const journeySnapshot = () => JSON.stringify(position);
  const appliedJourney = ref(journeySnapshot());
  const journeyDirty = computed(() => journeySnapshot() !== appliedJourney.value
    && (hasOriginDraft.value || position.travelMode !== JSON.parse(appliedJourney.value).travelMode));
  const hasUnsavedDrafts = computed(() => Boolean(props.id && currentUser.value && board.value && (
    availabilityDirty.value || journeyDirty.value || comment.value.trim() || place.label.trim()
    || String(place.latitude).trim() || String(place.longitude).trim() || !place.sheltered)));
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
  watch(() => selectionSnapshot(slots.value), () => { feedback.availability = ''; }, { flush: 'sync' });
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
  function editSlotLocation(start, field) {
    const previous = slotLookups.get(String(start)), slot = slots.value[start];
    if (!previous) return;
    if (field === 'label') { slot.latitude = null; slot.longitude = null; }
    slotLookups.delete(String(start));
  }
  const liveLabel = computed(() => connectionState.value === 'live' ? 'Live with your group' : 'Keeping your group in sync');
  let alive = true, loadRequest = 0, refreshTimer, pollTimer, stopEvents, refreshQueued = false;
  const context = () => `${props.id ?? ''}:${currentUser.value?.id ?? ''}:${JSON.stringify(scope.value)}`;
  const statuses = { planning: "Collecting availability", proposed: "Awaiting required approvals", confirmed: "Meetup confirmed", cancelled: "Meetup cancelled" };
  const iso = (ms) => new Date(ms).toISOString();
  const time = formatMeetupDateTime;
  async function load({ preserveDrafts = false } = {}) {
    const key = context(), request = ++loadRequest;
    if (props.id) {
      const data = (await api.meetup(props.id)).meetup;
      if (!alive || context() !== key || request !== loadRequest) return;
      const keepDraft = preserveDrafts && availabilityDirty.value;
      if (board.value?.version !== data.version) {
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
      if (keepDraft) for (const start of Object.keys(nextSlots)) if (slots.value[start]) nextSlots[start] = slots.value[start];
      slots.value = nextSlots;
      for (const [start, point] of slotLookups) if (!nextSlots[start]
        || ['label', 'latitude', 'longitude'].some(field => String(nextSlots[start][field]) !== String(point[field]))) slotLookups.delete(start);
      const firstLoad = !board.value;
      board.value = data;
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
      if (context() !== key) return;
      if ([401, 403, 404].includes(e.status)) {
        board.value = null; slots.value = {}; savedSlots.value = '[]';
        error.value = 'This meetup is unavailable, or you are no longer a participant.';
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
  function showStep(step) {
    if (!plannerSteps.includes(step)) return;
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
      if (type === 'ready' || ['group-members', 'connection-members'].includes(type)
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
  async function act(fn, { savingAvailability = false, area = 'review', success = '' } = {}) {
    if (busy.value) return;
    const key = context();
    busy.value = true;
    error.value = "";
    feedback[area] = ''; failures[area] = '';
    try {
      const result = await fn();
      invalidateMeetupSummaries();
      if (!alive || context() !== key) return;
      if (savingAvailability) savedSlots.value = selectionSnapshot(slots.value);
      // A successful mutation must not be reported as a failed save merely
      // because its follow-up read was unavailable.
      try { await load({ preserveDrafts: !savingAvailability }); }
      catch (refreshError) {
        if (!alive || context() !== key) return;
        if ([401, 403, 404].includes(refreshError.status)) {
          board.value = null; slots.value = {}; savedSlots.value = '[]';
          error.value = 'Your change was saved, but this meetup is no longer available to you.';
          return true;
        }
        syncNote.value = 'Your change was saved. Group details could not refresh; use Refresh planner to retry.';
      }
      if (context() !== key) return;
      feedback[area] = typeof success === 'function' ? success(result) : success;
      return true;
    } catch (e) {
      if (!alive || context() !== key) return;
      failures[area] = meetupErrorMessage(e.message);
      if (e.message === 'stale_meetup_version') await refreshPlannerAfterConflict();
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
      ),
      { savingAvailability: true, area: 'availability', success: 'Your availability and journey have been saved.' },
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
    const label = place.label.trim();
    const ok = await act(() => api.proposeMeetupPlace(props.id, { ...place, label, version: board.value.version,
      latitude: Number(place.latitude), longitude: Number(place.longitude) }), { area: 'places',
      success: () => `${label} is saved in suggested places.${hasSavedAvailability.value ? '' : ' Recommendations will appear once participants save their available times.'}` });
    if (ok) {
      Object.assign(place, { label: '', latitude: '', longitude: '', sheltered: true });
      placeLookup.value = null; placeSearchKey.value++;
    }
  }
  function vote(placeId) {
    return act(() => api.voteMeetupPlace(props.id, placeId, board.value.version), { area: 'places', success: 'Your vote has been saved.' });
  }
  async function propose(option) {
    const ok = await act(() => api.proposeMeetupPlan(props.id, { placeId: option.placeId,
      startsAt: iso(option.startsAt), version: board.value.version }), { area: 'review', success: result => result.proposal?.confirmed
        ? 'The meetup is confirmed. Your organizer approval has been recorded.' : 'Your plan has been submitted for approval.' });
    if (ok) showStep('review');
  }
  const approve = () => act(() => api.approveMeetup(props.id, board.value.version), {
    area: 'review', success: result => result.approval.confirmed ? 'The meetup is confirmed.' : 'Your approval has been recorded.',
  });
  function requestOrganizerAction(action) {
    confirmAction.value = action;
    confirmVersion.value = board.value.version;
  }
  async function organizerAction() {
    const action = confirmAction.value;
    const ok = await act(() => action === 'reopen' ? api.reopenMeetup(props.id, confirmVersion.value)
      : api.cancelMeetup(props.id, confirmVersion.value), { area: 'review',
      success: action === 'reopen' ? 'The organizer has reopened planning. A new proposal needs fresh approvals.' : 'The meetup has been cancelled.' });
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
    const key = context(), version = board.value?.version, id = props.id;
    busy.value = true; failures[area] = '';
    const stillCurrent = () => alive && context() === key && board.value?.version === version;
    try {
      const result = await request(id);
      if (stillCurrent()) apply(result);
    } catch {
      if (stillCurrent()) failures[area] = failureMessage;
    } finally {
      if (context() === key) { busy.value = false; if (refreshQueued) scheduleRefresh(); }
    }
  }
  const getWeather = () => readPlan(id => api.meetupEnvironment(id), ({ environment }) => {
    weather.value = environment.forecast; rainfall.value = environment.rainfall;
  }, 'review', 'Could not load the weather forecast. Please try again.');
  const getTravelSuggestions = () => readPlan(id => api.meetupTravelSuggestions(id, { ...travelOptions }),
    data => { travelRecommendations.value = data.recommendations; }, 'recommendations',
    'Could not refresh travel options. Your saved places are still available; try again.');
  const getParking = () => readPlan(id => api.meetupTransport(id, { parkingOnly: 'true' }),
    data => { transport.value = data.transport; }, 'review', 'Could not check nearby parking. Please try again.');

  return {
    route, router, currentUser, context, board, boards, error, busy, loading, creationContext,
    scope, hasActiveBoards, showCreation, creatingAdditional, returnRoute, returnLabel, proposalLabel, proposalGuidance, approvalGuidance,
    weather, rainfall, travelRecommendations, transport, comment, slots, place, position, travelOptions,
    feedback, failures, placeSearchKey, journeySearchKey, confirmAction, capabilities, contributionsLocked, selectedOrigins,
    leavePrompt, settleLeave, hasUnsavedDrafts, journeyDirty,
    selectPlace, selectJourney, invalidatePlace, invalidateJourney, editPlace, editJourney, editSlotLocation,
    selectedSlotCount, bestSavedOverlap, selectedTimes, activeStep, availabilityDirty, refreshing, syncNote,
    liveLabel, statuses, time, validCoordinates, recommendedOptions, hasSavedAvailability, recommendationEmpty,
    refreshPlanner, showStep, navigateSteps, create, saveAvailability, discardAvailability, assignJourney,
    addPlace, vote, propose, approve, requestOrganizerAction, organizerAction, postComment, getWeather, getTravelSuggestions, getParking,
   };

}
