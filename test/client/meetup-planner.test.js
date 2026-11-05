import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import MeetupView from '../../client/src/views/MeetupView.vue';
import MeetupLocationSearch from '../../client/src/components/MeetupLocationSearch.vue';
import { api } from '../../client/src/api.js';
import { meetupDatePolicy, singaporeInputValue } from '../../shared/meetupDates.mjs';
import { button, field, mountPage } from './helpers.js';
const live = vi.hoisted(() => ({ handler: null }));
vi.mock('../../client/src/chatLive.js', async () => {
  const { ref } = await import('vue');
  return { connectionState: ref('live'), onChatEvent: handler => { live.handler = handler; return () => { live.handler = null; }; } };
});
vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: {
  meetup: vi.fn(), meetupAvailability: vi.fn(), meetupLocations: vi.fn(), meetupTravelSuggestions: vi.fn(),
  meetups: vi.fn(), meetupContext: vi.fn(), createMeetup: vi.fn(), proposeMeetupPlace: vi.fn(),
  voteMeetupPlace: vi.fn(), proposeMeetupPlan: vi.fn(), approveMeetup: vi.fn(), reopenMeetup: vi.fn(),
  removeMeetupVote: vi.fn(), updateMeetupPlace: vi.fn(), removeMeetupPlace: vi.fn(),
  cancelMeetup: vi.fn(), meetupComment: vi.fn(), meetupTransport: vi.fn(), meetupEnvironment: vi.fn(),
} }));
vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'user-1' }) };
});
const start = Date.parse('2030-01-01T04:00:00Z');
const concert = { id: 'concert-1', artist: 'Test artist', event_date: '2030-01-01', event_time: '20:00:00', event_timezone: 'Asia/Singapore', venue: 'Singapore Indoor Stadium' };
const permissions = (status = 'planning', organizer = true) => ({
  isOrganizer: organizer, canContribute: status === 'planning', canDiscuss: status !== 'cancelled',
  canPropose: organizer && status === 'planning', canApprove: organizer && status === 'proposed',
  canReopen: organizer && ['proposed', 'confirmed'].includes(status), canCancel: organizer && status !== 'cancelled',
});
const publicPlace = { id: 'place-1', label: 'City Hall MRT', latitude: 1.293, longitude: 103.852, sheltered: true, votes: 0, proposed_by: 'user-1' };
const suggestion = { placeId: 'place-1', label: 'City Hall MRT', startsAt: start, availableCount: 2, participantCount: 2,
  totalDistanceKm: 4, locationRespondents: 2, basis: 'straight_line_distance', totalTravelMinutes: null, travelModes: { transit: 1, drive: 1 } };
const board = () => ({
  id: 'meetup-1', title: 'Concert meetup', status: 'planning', participantCount: 2,
  creator_id: 'user-1', version: 1, starts_at: start, ends_at: start + 3600000,
  requiredApprovers: [], approvals: [], comments: [], places: [], suggestions: [],
  capabilities: permissions(), concert,
  availability: [{ starts_at: start, ends_at: start + 1800000, travel_mode: 'transit', latitude: 1.3, longitude: 103.85, label: 'City Hall' }],
  grid: [{ startsAt: start, availableCount: 1 }],
});
beforeEach(() => {
  vi.resetAllMocks(); api.meetup.mockImplementation(async () => ({ meetup: board() }));
  api.meetupAvailability.mockResolvedValue({});
  api.meetups.mockResolvedValue({ meetups: [] });
  api.meetupContext.mockResolvedValue({ context: { concert, policy: meetupDatePolicy(concert), capabilities: { canCreate: true } } });
  api.createMeetup.mockResolvedValue({ meetup: { id: 'new-meetup' } });
  api.proposeMeetupPlace.mockResolvedValue({}); api.voteMeetupPlace.mockResolvedValue({});
  api.removeMeetupVote.mockResolvedValue({}); api.updateMeetupPlace.mockResolvedValue({}); api.removeMeetupPlace.mockResolvedValue({});
  api.proposeMeetupPlan.mockResolvedValue({}); api.reopenMeetup.mockResolvedValue({});
  api.cancelMeetup.mockResolvedValue({}); api.meetupComment.mockResolvedValue({});
  api.approveMeetup.mockResolvedValue({ approval: { confirmed: false } });
});

describe('three-stage planning, explicit responses and current participant decisions', () => {
  const counts = (availableCount = 0, unavailableCount = 0) => ({ respondedCount: availableCount + unavailableCount,
    availableCount, unavailableCount, unansweredCount: 2 - availableCount - unavailableCount });
  const open = async (overrides = {}) => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), availability: [], availabilityResponse: 'unanswered',
      availabilityResponses: counts(), participationRevision: 'cohort-1', ...overrides } });
    return (await mountPage(MeetupView, { props: { id: 'meetup-1' } })).wrapper;
  };
  const unavailableChoice = wrapper => field(wrapper.get('.meetup-response-controls'), "I can't make any of these times");
  it('places final recommendation selection and proposal controls only in Finalise meetup', async () => {
    const wrapper = await open({ places: [publicPlace], suggestions: [suggestion] });
    expect(wrapper.findAll('.meetup-steps strong').map(node => node.text())).toEqual(['Share availability', 'Suggest places', 'Finalise meetup']);
    expect(wrapper.get('#meetup-places').find('.meetup-recommendations').exists()).toBe(false);
    expect(wrapper.get('#meetup-review').get('.meetup-recommendations').exists()).toBe(true);
    expect(wrapper.get('#meetup-places').find('.meetup-option').exists()).toBe(false);
    expect(wrapper.get('.meetup-next-step h2').text()).toBe('Review a time and place for your group');
    expect(wrapper.get('.meetup-own-response-reminder').text()).toContain('not shared your own availability');
    await wrapper.get('.meetup-next-step > .btn--primary').trigger('click'); await flushPromises();
    expect(wrapper.get('#meetup-review').isVisible()).toBe(true);
    expect(document.activeElement).toBe(wrapper.get('.meetup-option .btn--primary').element);
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(wrapper.get('.meetup-option-details').element.open).toBe(false);
    expect(wrapper.get('.meetup-picker').isVisible()).toBe(false);
    await button(wrapper, 'Compare other options').trigger('click');
    expect(wrapper.get('.meetup-picker').isVisible()).toBe(true);
  });
  it('visually distinguishes a private starting point from shared place suggestions and keeps votes out of final decisions', async () => {
    const wrapper = await open({ places: [publicPlace], suggestions: [suggestion] });
    expect(wrapper.get('.meetup-journey > summary').text()).toContain('My private starting point');
    expect(wrapper.get('.meetup-journey > summary').text()).toContain('Only you');
    expect(wrapper.get('.meetup-journey').element.open).toBe(false);
    expect(wrapper.get('.meetup-place-editor h2').text()).toBe('Suggest a meeting place');
    expect(wrapper.get('.meetup-place-editor .meetup-audience').text()).toBe('Shared with this group');
    expect(wrapper.get('.meetup-place-editor').text()).toContain('does not set the final plan');
    expect(wrapper.get('.meetup-option').findAll('button').some(node => /Vote/.test(node.text()))).toBe(false);
    await button(wrapper, 'Vote for place').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('This records your preferred place');
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled(); expect(api.approveMeetup).not.toHaveBeenCalled();
  });
  it('saves explicit unavailability without fabricated intervals and reports real aggregate responses', async () => {
    const wrapper = await open();
    await unavailableChoice(wrapper).setValue(true);
    expect(wrapper.get('.meetup-response-controls').text()).toContain('Unsaved response');
    expect(wrapper.get('[data-availability-start]').attributes('aria-pressed')).toBe('false');
    expect(api.meetupAvailability).not.toHaveBeenCalled();
    api.meetupAvailability.mockResolvedValueOnce({ result: { saved: true, version: 2, responseStatus: 'unavailable' } });
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), availability: [], version: 2, availabilityResponse: 'unavailable',
      availabilityResponses: counts(0, 1) } });
    await button(wrapper, 'Save my response').trigger('click'); await flushPromises();
    expect(api.meetupAvailability).toHaveBeenCalledExactlyOnceWith('meetup-1', [], 1, 'unavailable');
    expect(wrapper.text()).toContain('Your availability has been saved.');
    expect(wrapper.get('.meetup-response-summary').text()).toContain('1 of 2 participants responded');
    expect(wrapper.get('.meetup-response-summary').text()).toContain('1 cannot make these times');
    expect(wrapper.get('.meetup-response-summary').text()).not.toContain('have not responded');
    expect(unavailableChoice(wrapper).element.checked).toBe(true);
    expect(wrapper.text()).not.toContain('Unsaved changes');
  });
  it('allows an unavailable member to revise by painting a real time without sending the response automatically', async () => {
    const wrapper = await open({ availabilityResponse: 'unavailable', availabilityResponses: counts(0, 1),
      capabilities: permissions('planning', false), places: [publicPlace] });
    expect(wrapper.get('.meetup-next-step h2').text()).toBe('Help choose a meeting place');
    await wrapper.get('[data-availability-start]').trigger('click');
    expect(unavailableChoice(wrapper).element.checked).toBe(false);
    expect(wrapper.get('.meetup-response-controls').text()).toContain('Unsaved response: Available times selected');
    expect(api.meetupAvailability).not.toHaveBeenCalled();
    api.meetup.mockRejectedValueOnce(new Error('read_offline'));
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(api.meetupAvailability).toHaveBeenCalledExactlyOnceWith('meetup-1', [expect.objectContaining({ startsAt: new Date(start).toISOString() })], 1);
    // Nobody unavailable: the line is hidden rather than reading "0 cannot".
    expect(wrapper.get('.meetup-response-summary').text()).not.toContain('cannot make these times');
  });
  it('preserves a dirty unavailable response through live refresh and keeps it after a failed save', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await open(); await unavailableChoice(wrapper).setValue(true);
      api.meetup.mockResolvedValueOnce({ meetup: { ...board(), availability: [], version: 2,
        availabilityResponse: 'unanswered', availabilityResponses: counts(1), participationRevision: 'cohort-1' } });
      live.handler('meetup-updated', { meetupId: 'meetup-1' });
      await vi.advanceTimersByTimeAsync(160); await flushPromises();
      expect(unavailableChoice(wrapper).element.checked).toBe(true);
      expect(wrapper.text()).toContain('Unsaved changes');
      api.meetupAvailability.mockRejectedValueOnce(new Error('offline'));
      await button(wrapper, 'Save my response').trigger('click'); await flushPromises();
      expect(unavailableChoice(wrapper).element.checked).toBe(true);
      expect(wrapper.text()).toContain('Availability was not saved. Your draft is kept.');
      expect(wrapper.get('.meetup-response-summary').text()).not.toContain('cannot make these times');
    } finally { vi.useRealTimers(); }
  });
  it('retains an acknowledged unavailable save and updates own response counts when the following read fails', async () => {
    const wrapper = await open(); await unavailableChoice(wrapper).setValue(true);
    api.meetupAvailability.mockResolvedValueOnce({ result: { saved: true, version: 2, responseStatus: 'unavailable' } });
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Save my response').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Your availability has been saved.');
    expect(wrapper.text()).toContain('Group details could not refresh');
    expect(wrapper.text()).not.toContain('Unsaved changes');
    expect(wrapper.get('.meetup-response-summary').text()).toContain('1 of 2 participants responded');
    expect(wrapper.get('.meetup-response-summary').text()).toContain('1 cannot make these times');
    expect(button(wrapper, 'Save my response').element.disabled).toBe(true);
  });
  it('does not mistake clearing all blocks for explicitly saying unavailable', async () => {
    const wrapper = await open({ availability: board().availability, availabilityResponse: 'available', availabilityResponses: counts(1) });
    await wrapper.get('[data-availability-start]').trigger('click');
    expect(unavailableChoice(wrapper).element.checked).toBe(false);
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(api.meetupAvailability).toHaveBeenCalledExactlyOnceWith('meetup-1', [], 1, 'unanswered');
    expect(wrapper.text()).toContain('Your saved response has been cleared.');
    expect(wrapper.get('.meetup-response-summary').text()).toContain('0 of 2 participants responded');
  });
  it('keeps organizer-only finalisation unavailable to a regular member while allowing read-only stage inspection', async () => {
    const wrapper = await open({ capabilities: permissions('planning', false), places: [publicPlace], suggestions: [suggestion] });
    await wrapper.get('[data-planner-step="review"]').trigger('click');
    expect(wrapper.get('#meetup-review').isVisible()).toBe(true);
    expect(wrapper.find('.meetup-recommendations').exists()).toBe(false);
    expect(wrapper.find('.meetup-manual-proposal').exists()).toBe(false);
    expect(wrapper.get('#meetup-review').text()).toContain('Your organizers choose and propose');
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
  });
  it('requires explicit acknowledgement and a second review before proposing a zero-attendance listed time', async () => {
    const wrapper = await open({ grid: [{ startsAt: start, availableCount: 0 }], places: [publicPlace],
      requiredApprovers: ['user-1'] });
    const panel = wrapper.get('.meetup-manual-proposal');
    expect(panel.element.open).toBe(false);
    await panel.get('summary').trigger('click');
    await field(panel, 'Alternative meeting place').setValue(publicPlace.id);
    await field(panel, 'Alternative meeting time').setValue(String(start));
    expect(button(panel, 'Review this alternative').element.disabled).toBe(true);
    expect(panel.get('.meetup-attendance-warning').text()).toContain('No participant has marked this time available.');
    await panel.get('input[type="checkbox"]').setValue(true);
    await button(panel, 'Review this alternative').trigger('click'); await flushPromises();
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Only 0 of 2 participants');
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    api.proposeMeetupPlan.mockResolvedValueOnce({ proposal: { version: 2, confirmed: true } });
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.proposeMeetupPlan).toHaveBeenCalledExactlyOnceWith('meetup-1', { placeId: publicPlace.id,
      startsAt: new Date(start).toISOString(), version: 1, participationRevision: 'cohort-1', acknowledgeNoAvailability: true });
  });
  it('rejects a reviewed proposal after a same-count membership change even if the plan version did not change', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await open({ places: [publicPlace], suggestions: [suggestion] });
      await button(wrapper, 'Propose this time & place').trigger('click'); await flushPromises();
      api.meetup.mockResolvedValueOnce({ meetup: { ...board(), places: [publicPlace], suggestions: [suggestion],
        participationRevision: 'cohort-2', availabilityResponse: 'available' } });
      live.handler('group-members', { partyId: 'p1' });
      await vi.advanceTimersByTimeAsync(160); await flushPromises();
      document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
      expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).toBe(null);
      expect(wrapper.get('.meetup-recommendations').text()).toContain('This recommendation or plan has changed.');
    } finally { vi.useRealTimers(); }
  });
  it('invalidates cached route attendance on same-count membership replacement and uses fresh recommendations', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await open({ places: [publicPlace], suggestions: [suggestion] });
      api.meetupTravelSuggestions.mockResolvedValueOnce({ recommendations: { version: 1, participationRevision: 'cohort-1',
        options: [{ ...suggestion, label: 'Old route option' }] } });
      await wrapper.vm.getTravelSuggestions(); await flushPromises();
      expect(wrapper.get('.meetup-option').text()).toContain('Old route option');
      api.meetup.mockResolvedValueOnce({ meetup: { ...board(), places: [publicPlace],
        participationRevision: 'cohort-2', suggestions: [{ ...suggestion, label: 'Current participant option', availableCount: 1 }] } });
      live.handler('group-members', { partyId: 'p1' });
      await vi.advanceTimersByTimeAsync(160); await flushPromises();
      expect(wrapper.get('.meetup-option').text()).toContain('Current participant option');
      expect(wrapper.get('.meetup-option').text()).not.toContain('Old route option');
      expect(wrapper.get('.meetup-option').text()).toContain('1 of 2 available');
    } finally { vi.useRealTimers(); }
  });
  it('shows the actual acknowledged new place after save succeeds but refresh fails without inventing recommendations', async () => {
    const wrapper = await open();
    const form = wrapper.get('.meetup-place-editor');
    await field(form, 'Place name').setValue('Public entrance');
    await field(form, 'Latitude').setValue('1.31'); await field(form, 'Longitude').setValue('103.86');
    api.proposeMeetupPlace.mockResolvedValueOnce({ place: { id: 'real-saved-place', version: 2 } });
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    await form.trigger('submit'); await flushPromises();
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('Public entrance');
    expect(wrapper.get('.meetup-suggested-places').text()).not.toContain('No places yet');
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('Suggested by you');
    expect(field(form, 'Place name').element.value).toBe('');
    expect(wrapper.text()).toContain('Group details could not refresh');
    expect(wrapper.find('.meetup-option').exists()).toBe(false);
    expect(api.proposeMeetupPlace).toHaveBeenCalledTimes(1);
  });
  it('blocks alternative review after availability is acknowledged but current group details cannot refresh', async () => {
    const wrapper = await open({ places: [publicPlace], grid: [{ startsAt: start, availableCount: 0 }] });
    const panel = wrapper.get('.meetup-manual-proposal');
    await field(panel, 'Alternative meeting place').setValue(publicPlace.id);
    await field(panel, 'Alternative meeting time').setValue(String(start));
    await panel.get('input[type="checkbox"]').setValue(true);
    expect(button(panel, 'Review this alternative').element.disabled).toBe(false);
    await wrapper.get('[data-availability-start]').trigger('click');
    api.meetupAvailability.mockResolvedValueOnce({ result: { saved: true, version: 2, responseStatus: 'available' } });
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(button(panel, 'Review this alternative').element.disabled).toBe(true);
    expect(panel.text()).toContain('Refresh the planner before reviewing another time.');
    await wrapper.vm.requestManualProposal();
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
  });
  it.each([
    { version: 2, participationRevision: 'cohort-1' },
    { version: 1, participationRevision: 'cohort-2' },
  ])('rejects returned journey options that belong to a different canonical plan snapshot (%j)', async metadata => {
    const wrapper = await open({ places: [publicPlace], suggestions: [suggestion] });
    api.meetupTravelSuggestions.mockResolvedValueOnce({ recommendations: { ...metadata,
      options: [{ ...suggestion, label: 'Mismatched participant option' }] } });
    await wrapper.vm.getTravelSuggestions(); await flushPromises();
    expect(wrapper.find('.meetup-option').exists()).toBe(false);
    expect(wrapper.get('.meetup-recommendations').text()).not.toContain('Mismatched participant option');
    expect(wrapper.get('.meetup-recommendations').text()).toContain('The plan changed while journey options were loading.');
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
  });
  it('explains that a confirmed plan predates the current membership without unlocking it', async () => {
    const wrapper = await open({ status: 'confirmed', capabilities: permissions('confirmed', false),
      places: [publicPlace], selected_place_id: publicPlace.id, selected_start: start,
      confirmationContext: { confirmedAt: start - 86400000, confirmedBeforeJoined: true } });
    expect(wrapper.get('.meetup-confirmation-context').text()).toContain('confirmed before you joined the group');
    expect(button(wrapper, 'Save my times').element.disabled).toBe(true);
    expect(wrapper.find('.meetup-manual-proposal').exists()).toBe(false);
    expect(api.reopenMeetup).not.toHaveBeenCalled();
  });
});

describe('first-time meetup guidance follows actual permissions, saved state and drafts', () => {
  const region = wrapper => wrapper.get('[aria-labelledby="meetup-next-step-heading"]');
  const open = async (overrides = {}) => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), ...overrides } });
    return (await mountPage(MeetupView, { props: { id: 'meetup-1' } })).wrapper;
  };
  it('directs someone with no saved available times to the grid while allowing inspection of later stages', async () => {
    const wrapper = await open({ availability: [], grid: [{ startsAt: start, availableCount: 0 }] });
    expect(region(wrapper).text()).toContain('Share when you can meet');
    await wrapper.get('[data-planner-step="places"]').trigger('click');
    expect(wrapper.get('#meetup-places').isVisible()).toBe(true);
    await region(wrapper).get('button').trigger('click'); await flushPromises();
    expect(wrapper.get('#meetup-availability').isVisible()).toBe(true);
    expect(document.activeElement).toBe(wrapper.get('[data-availability-start]').element);
    expect(api.meetupAvailability).not.toHaveBeenCalled();
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
  });
  it('prioritizes unsaved availability and directs attention to the real save button without submitting', async () => {
    const wrapper = await open({ places: [publicPlace], suggestions: [suggestion] });
    await wrapper.get('[data-availability-start]').trigger('click');
    await wrapper.get('[data-planner-step="places"]').trigger('click');
    expect(region(wrapper).text()).toContain('Save your time changes');
    await region(wrapper).get('button').trigger('click'); await flushPromises();
    expect(document.activeElement).toBe(button(wrapper, 'Save my times').element);
    expect(wrapper.get('[data-availability-start]').attributes('aria-pressed')).toBe('false');
    expect(api.meetupAvailability).not.toHaveBeenCalled();
    expect(region(wrapper).text()).toContain('last saved availability');
  });
  it('keeps optional journey details secondary and distinguishes applying them from saving', async () => {
    const wrapper = await open();
    expect(wrapper.get('.meetup-journey').element.open).toBe(false);
    await field(wrapper.get('.meetup-journey'), 'Location label').setValue('Private starting area draft');
    expect(region(wrapper).text()).toContain('Apply your optional journey details');
    await region(wrapper).get('button').trigger('click'); await flushPromises();
    expect(wrapper.get('.meetup-journey').element.open).toBe(true);
    expect(region(wrapper).text()).toContain('then save your availability');
    expect(api.meetupAvailability).not.toHaveBeenCalled();
    expect(api.meetupTravelSuggestions).not.toHaveBeenCalled();
  });
  it('identifies an unsaved place and discussion draft without sharing either automatically', async () => {
    const wrapper = await open();
    await field(wrapper.get('.meetup-place-editor'), 'Place name').setValue('Public entrance draft');
    expect(region(wrapper).text()).toContain('Share your place suggestion');
    await region(wrapper).get('button').trigger('click'); await flushPromises();
    expect(document.activeElement).toBe(field(wrapper.get('.meetup-place-editor'), 'Place name').element);
    await button(wrapper, 'Clear place draft').trigger('click');
    await wrapper.get('.meetup-discussion textarea').setValue('Discussion draft');
    expect(region(wrapper).text()).toContain('Finish your discussion message');
    expect(api.proposeMeetupPlace).not.toHaveBeenCalled();
    expect(api.meetupComment).not.toHaveBeenCalled();
  });
  it.each([
    ['planning', true, false, false, 'Review a time and place for your group'],
    ['planning', false, false, false, 'Help choose a meeting place'],
    ['planning', false, false, true, 'Your place preference is saved'],
    ['proposed', true, false, false, 'Your approval is needed'],
    ['proposed', true, true, false, 'Waiting for the remaining approval'],
    ['proposed', false, false, false, 'Waiting for organizer approval'],
    ['confirmed', true, true, false, 'Your meetup is confirmed'],
    ['cancelled', false, false, false, 'This meetup is cancelled'],
  ])('explains the actual next responsibility for %s organizer=%s approved=%s voted=%s', async (status, organizer, hasApproved, voted, title) => {
    const wrapper = await open({ status, capabilities: { ...permissions(status, organizer), canApprove: status === 'proposed' && organizer && !hasApproved },
      hasApproved, requiredApprovers: ['user-1', 'host-2'], approvals: hasApproved ? ['user-1'] : [],
      currentVotePlaceId: voted ? publicPlace.id : null, places: [publicPlace], suggestions: [suggestion],
      selected_place_id: status !== 'planning' ? publicPlace.id : null, selected_start: start });
    expect(region(wrapper).get('h2').text()).toBe(title);
    await region(wrapper).get('button').trigger('click'); await flushPromises();
    if (status !== 'planning') expect(wrapper.get('#meetup-review').isVisible()).toBe(true);
    expect(api.approveMeetup).not.toHaveBeenCalled();
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(api.voteMeetupPlace).not.toHaveBeenCalled();
    if (!organizer) expect(wrapper.find('.meetup-recommendations').exists()).toBe(false);
  });
  it('uses aggregate overlap honestly without inventing respondents or exposing another origin', async () => {
    const wrapper = await open({ participantCount: 6, availability: [], grid: [{ startsAt: start, availableCount: 5 }],
      places: [publicPlace], suggestions: [{ ...suggestion, participantCount: 6, availableCount: 5, locationRespondents: 0, totalDistanceKm: null }] });
    // The panel states the group size and leaves the counts to the grid.
    expect(wrapper.get('.meetup-time-context h3').text()).toBe('Group availability (6)');
    expect(region(wrapper).text()).toContain('Review a time and place for your group');
    expect(wrapper.get('.meetup-own-response-reminder').text()).toContain('not shared your own availability');
    expect(wrapper.get('.meetup-best-summary').text()).toContain('5 of 6 marked available');
    expect(wrapper.get('.meetup-option').text()).toContain('No starting locations supplied');
    expect(wrapper.text()).not.toContain('5 responded');
  });
  it('does not turn read-only capabilities into write permissions when later stages are inspected', async () => {
    const wrapper = await open({ availability: [], capabilities: { ...permissions('planning', false), canContribute: false }, places: [publicPlace] });
    expect(region(wrapper).text()).toContain('View the planning progress');
    await wrapper.get('[data-planner-step="places"]').trigger('click');
    expect(wrapper.get('.meetup-place-editor fieldset').element.disabled).toBe(true);
    expect(wrapper.find('.meetup-recommendations').exists()).toBe(false);
    expect(button(wrapper, 'Save my times').element.disabled).toBe(true);
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('Voting locked');
  });
  it('offers an explicit read retry after a saved change cannot refresh recommendations', async () => {
    const wrapper = await open({ places: [publicPlace], suggestions: [suggestion] });
    api.voteMeetupPlace.mockResolvedValueOnce({ result: { voted: true, version: 2 } });
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Vote for place').trigger('click'); await flushPromises();
    expect(region(wrapper).get('h2').text()).toBe('Refresh the recommendations');
    expect(wrapper.find('.meetup-option').exists()).toBe(false);
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), version: 2, places: [{ ...publicPlace, votes: 1 }], suggestions: [suggestion], currentVotePlaceId: publicPlace.id } });
    await region(wrapper).get('button').trigger('click'); await flushPromises();
    expect(region(wrapper).get('h2').text()).toBe('Review a time and place for your group');
    expect(api.voteMeetupPlace).toHaveBeenCalledTimes(1);
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
  });
});

describe('organizer place/time picker preserves the algorithm and reviewed choice', () => {
  const secondPlace = { ...publicPlace, id: 'place-2', label: 'Funan public entrance', votes: 2 };
  const late = start + 3600000, early = start + 1800000;
  const ranked = () => [
    { ...suggestion, startsAt: late, availableCount: 2, participantCount: 3, totalDistanceKm: 2 },
    { ...suggestion, placeId: secondPlace.id, label: secondPlace.label, startsAt: start, availableCount: 2, participantCount: 3, totalDistanceKm: 3 },
    { ...suggestion, startsAt: early, availableCount: 1, participantCount: 3, totalDistanceKm: 1, locationRespondents: 1 },
    { ...suggestion, placeId: secondPlace.id, label: secondPlace.label, startsAt: late, availableCount: 1, participantCount: 3, totalDistanceKm: 2, locationRespondents: 1 },
  ];
  const plan = (overrides = {}) => ({ ...board(), participantCount: 3, ends_at: start + 7200000,
    requiredApprovers: ['user-1'], places: [publicPlace, secondPlace], suggestions: ranked(), ...overrides });
  const picker = wrapper => wrapper.get('.meetup-picker');
  const placeSelect = wrapper => field(picker(wrapper), 'Place');
  const timeSelect = wrapper => field(picker(wrapper), 'Time');
  const open = async (data = plan()) => {
    api.meetup.mockResolvedValue({ meetup: data });
    return (await mountPage(MeetupView, { props: { id: 'meetup-1' } })).wrapper;
  };
  it('shows the algorithm’s leading recommendation first and progressively reveals the existing two dropdowns', async () => {
    const wrapper = await open();
    expect(wrapper.get('.meetup-best-summary').text()).toContain(publicPlace.label);
    expect(wrapper.get('.meetup-best-summary').text()).toContain('2 of 3 marked available');
    expect(wrapper.get('.meetup-comparison').isVisible()).toBe(false);
    expect(button(wrapper, 'Compare other options').attributes('aria-expanded')).toBe('false');
    await button(wrapper, 'Compare other options').trigger('click');
    expect(picker(wrapper).isVisible()).toBe(false); // The places stage is still inactive.
    await wrapper.get('[data-planner-step="review"]').trigger('click');
    expect(picker(wrapper).isVisible()).toBe(true);
    expect(timeSelect(wrapper).element.value).toBe(String(late));
    await placeSelect(wrapper).setValue(secondPlace.id); await timeSelect(wrapper).setValue(String(late));
    expect(wrapper.get('.meetup-option').text()).toContain('Your alternative to review');
    await button(wrapper, 'Hide alternative options').trigger('click');
    expect(wrapper.get('.meetup-comparison').isVisible()).toBe(false);
    expect(wrapper.get('.meetup-option').text()).toContain(secondPlace.label);
    await button(wrapper, 'Use recommended option').trigger('click');
    expect(wrapper.get('.meetup-option').text()).toContain('Rank 1 of 4');
    expect(timeSelect(wrapper).element.value).toBe(String(late));
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(api.voteMeetupPlace).not.toHaveBeenCalled();
    expect(api.meetupTravelSuggestions).not.toHaveBeenCalled();
  });
  it('defaults to the best overall option and preserves global ranks rather than sorting times chronologically', async () => {
    const wrapper = await open();
    expect(placeSelect(wrapper).element.value).toBe(publicPlace.id);
    expect(timeSelect(wrapper).element.value).toBe(String(late));
    expect(placeSelect(wrapper).findAll('option').map(option => option.element.value)).toEqual([publicPlace.id, secondPlace.id]);
    expect(timeSelect(wrapper).findAll('option').map(option => option.element.value)).toEqual([String(late), String(early)]);
    expect(placeSelect(wrapper).text()).toContain('best rank 1');
    expect(timeSelect(wrapper).findAll('option').map(option => option.text().match(/Rank \d+/)[0])).toEqual(['Rank 1', 'Rank 3']);
    expect(wrapper.get('.meetup-option').text()).toContain('Rank 1 of 4');
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(api.meetupTravelSuggestions).not.toHaveBeenCalled();
  });
  it('updates its available times, summary and rank every time the place changes', async () => {
    const wrapper = await open();
    for (const expected of [secondPlace, publicPlace, secondPlace]) {
      await placeSelect(wrapper).setValue(expected.id);
      expect(wrapper.get('.meetup-option h3').text()).toBe(expected.label);
      const expectedTimes = expected.id === secondPlace.id ? [start, late] : [late, early];
      expect(timeSelect(wrapper).findAll('option').map(option => option.element.value)).toEqual(expectedTimes.map(String));
      expect(timeSelect(wrapper).element.value).toBe(String(expectedTimes[0]));
      expect(wrapper.get('.meetup-option').text()).toContain(expected.id === secondPlace.id ? 'Rank 2 of 4' : 'Rank 1 of 4');
    }
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(api.voteMeetupPlace).not.toHaveBeenCalled();
  });
  it('keeps place maximum overlap distinct from selected time attendance and submits the chosen numeric time', async () => {
    const wrapper = await open();
    await placeSelect(wrapper).setValue(secondPlace.id);
    await timeSelect(wrapper).setValue(String(late));
    expect(placeSelect(wrapper).find('option:checked').text()).toContain('up to 2 of 3 available');
    expect(wrapper.get('.meetup-option').text()).toContain('1 of 3 available');
    expect(wrapper.get('.meetup-option').text()).toContain('Not everyone is available');
    expect(wrapper.get('.meetup-option').text()).toContain('Rank 4 of 4');
    expect(wrapper.get('.meetup-option').text()).toContain('2 place votes');
    await button(wrapper, 'Confirm this time & place').trigger('click'); await flushPromises();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain(secondPlace.label);
    expect(dialog.textContent).toContain('Only 1 of 3 participants');
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    api.proposeMeetupPlan.mockResolvedValueOnce({ proposal: { confirmed: true, version: 2 } });
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    dialog.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.proposeMeetupPlan).toHaveBeenCalledExactlyOnceWith('meetup-1', { placeId: secondPlace.id,
      startsAt: new Date(late).toISOString(), version: 1 });
    expect(api.approveMeetup).not.toHaveBeenCalled();
  });
  it.each([String(late), new Date(late).toISOString()])('normalizes backend timestamp %s before native-select matching and submission', async suppliedTime => {
    const wrapper = await open(plan({ suggestions: [{ ...suggestion, startsAt: suppliedTime }] }));
    expect(timeSelect(wrapper).element.value).toBe(String(late));
    expect(wrapper.get('.meetup-option').text()).toContain('1:00');
    await button(wrapper, 'Confirm this time & place').trigger('click'); await flushPromises();
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.proposeMeetupPlan).toHaveBeenCalledWith('meetup-1', { placeId: publicPlace.id, startsAt: new Date(late).toISOString(), version: 1 });
  });
  it('ignores invalid timestamps, zero-attendance choices and suggested places with no eligible times', async () => {
    const unavailable = { ...secondPlace, id: 'place-3', label: 'No suitable times here' };
    const wrapper = await open(plan({ places: [publicPlace, secondPlace, unavailable], suggestions: [
      { ...suggestion, startsAt: 'not a time' }, { ...suggestion, startsAt: Infinity },
      { ...suggestion, startsAt: late, availableCount: 0 }, ranked()[0],
    ] }));
    expect(placeSelect(wrapper).findAll('option')).toHaveLength(1);
    expect(timeSelect(wrapper).findAll('option')).toHaveLength(1);
    expect(timeSelect(wrapper).element.value).toBe(String(late));
    expect(wrapper.get('.meetup-suggested-places').text()).toContain(unavailable.label);
    expect(wrapper.get('.meetup-option').text()).toContain('Rank 1 of 1');
  });
  it('shows unknown journey burden honestly and never suggests car/transit choices changed distance fallback', async () => {
    const wrapper = await open(plan({ suggestions: [{ ...ranked()[0], totalDistanceKm: null, locationRespondents: 0,
      distanceCoverageComparable: false, basis: 'insufficient_journey_data' }], rankingBasis: 'insufficient_journey_data' }));
    expect(wrapper.get('.meetup-option').text()).toContain('No starting locations supplied');
    expect(wrapper.get('.meetup-option').text()).toContain('Journey burden is unknown');
    expect(wrapper.get('.meetup-option').text()).toContain('Saved travel choices: 1 public transport · 1 car.');
    expect(wrapper.get('.meetup-option').text()).toContain('Transport choices do not affect straight-line estimates');
    expect(api.meetupTravelSuggestions).not.toHaveBeenCalled();
  });
  it('preserves an explicit valid place/time tuple across reordered live data and updates its displayed rank', async () => {
    const wrapper = await open();
    await placeSelect(wrapper).setValue(secondPlace.id); await timeSelect(wrapper).setValue(String(late));
    api.meetup.mockResolvedValueOnce({ meetup: plan({ version: 2, suggestions: [ranked()[3], ...ranked().slice(0, 3)] }) });
    await button(wrapper, 'Refresh planner').trigger('click'); await flushPromises();
    expect(placeSelect(wrapper).element.value).toBe(secondPlace.id);
    expect(timeSelect(wrapper).element.value).toBe(String(late));
    expect(wrapper.get('.meetup-option').text()).toContain('Rank 1 of 4');
  });
  it('follows the best refreshed recommendation until the organizer makes an explicit selection', async () => {
    const wrapper = await open();
    api.meetup.mockResolvedValueOnce({ meetup: plan({ version: 2, suggestions: [ranked()[1], ranked()[0]] }) });
    await button(wrapper, 'Refresh planner').trigger('click'); await flushPromises();
    expect(placeSelect(wrapper).element.value).toBe(secondPlace.id);
    expect(timeSelect(wrapper).element.value).toBe(String(start));
    expect(wrapper.get('.meetup-option').text()).toContain('Rank 1 of 2');
  });
  it('falls back to the same place’s best valid time when its selected time disappears', async () => {
    const wrapper = await open();
    await placeSelect(wrapper).setValue(secondPlace.id); await timeSelect(wrapper).setValue(String(late));
    api.meetup.mockResolvedValueOnce({ meetup: plan({ version: 2, suggestions: ranked().slice(0, 3) }) });
    await button(wrapper, 'Refresh planner').trigger('click'); await flushPromises();
    expect(placeSelect(wrapper).element.value).toBe(secondPlace.id);
    expect(timeSelect(wrapper).element.value).toBe(String(start));
  });
  it('falls back to the best overall combination when its selected place disappears', async () => {
    const wrapper = await open();
    await placeSelect(wrapper).setValue(secondPlace.id); await timeSelect(wrapper).setValue(String(late));
    api.meetup.mockResolvedValueOnce({ meetup: plan({ version: 2, places: [publicPlace], suggestions: [ranked()[0], ranked()[2]] }) });
    await button(wrapper, 'Refresh planner').trigger('click'); await flushPromises();
    expect(placeSelect(wrapper).element.value).toBe(publicPlace.id);
    expect(timeSelect(wrapper).element.value).toBe(String(late));
    expect(wrapper.get('.meetup-option').text()).not.toContain(secondPlace.label);
  });
  it('retains manual choice through a transient empty loading state while hiding any stale submit action', async () => {
    const wrapper = await open();
    await placeSelect(wrapper).setValue(secondPlace.id); await timeSelect(wrapper).setValue(String(late));
    let finish;
    api.meetup.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = wrapper.vm.changeShelterFilter(); await flushPromises();
    expect(wrapper.find('.meetup-picker').exists()).toBe(false);
    expect(wrapper.findAll('button').some(control => control.text() === 'Confirm this time & place')).toBe(false);
    finish({ meetup: plan({ version: 2 }) }); await pending; await flushPromises();
    expect(placeSelect(wrapper).element.value).toBe(secondPlace.id);
    expect(timeSelect(wrapper).element.value).toBe(String(late));
  });
  it('retains manual choice through failed recommendation reads and restores it on authoritative recovery', async () => {
    const wrapper = await open();
    await placeSelect(wrapper).setValue(secondPlace.id); await timeSelect(wrapper).setValue(String(late));
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    await wrapper.vm.changeShelterFilter(); await flushPromises();
    expect(wrapper.find('.meetup-picker').exists()).toBe(false);
    api.meetup.mockResolvedValueOnce({ meetup: plan({ version: 2 }) });
    await button(wrapper, 'Refresh planner').trigger('click'); await flushPromises();
    expect(placeSelect(wrapper).element.value).toBe(secondPlace.id);
    expect(timeSelect(wrapper).element.value).toBe(String(late));
  });
  it('clears authoritative empty results and prevents stale confirmation', async () => {
    const wrapper = await open();
    await placeSelect(wrapper).setValue(secondPlace.id);
    await button(wrapper, 'Confirm this time & place').trigger('click'); await flushPromises();
    api.meetup.mockResolvedValueOnce({ meetup: plan({ version: 2, suggestions: [] }) });
    await wrapper.vm.refreshPlanner(); await flushPromises();
    expect(wrapper.find('.meetup-picker').exists()).toBe(false);
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    expect(wrapper.get('.meetup-recommendations').text()).toContain('This recommendation or plan has changed');
  });
  it('does not carry a manually selected place or time into a different meetup scope', async () => {
    const wrapper = await open();
    await placeSelect(wrapper).setValue(publicPlace.id); await timeSelect(wrapper).setValue(String(early));
    api.meetup.mockResolvedValueOnce({ meetup: plan({ id: 'meetup-2', suggestions: [ranked()[1], ranked()[0], ranked()[2]] }) });
    await wrapper.setProps({ id: 'meetup-2' }); await flushPromises();
    expect(placeSelect(wrapper).element.value).toBe(secondPlace.id);
    expect(timeSelect(wrapper).element.value).toBe(String(start));
  });
  it('clears a different authenticated account’s picker choice and open proposal review', async () => {
    const { currentUser } = await import('../../client/src/auth.js');
    const previous = currentUser.value;
    let wrapper;
    try {
      wrapper = await open();
      await timeSelect(wrapper).setValue(String(early));
      await button(wrapper, 'Confirm this time & place').trigger('click'); await flushPromises();
      expect(document.querySelector('[role="dialog"]')).not.toBe(null);
      api.meetup.mockResolvedValueOnce({ meetup: plan({ requiredApprovers: ['user-1', 'user-2'], suggestions: [ranked()[1], ranked()[0], ranked()[2]] }) });
      currentUser.value = { id: 'user-2' }; await flushPromises();
      expect(document.querySelector('[role="dialog"]')).toBe(null);
      expect(placeSelect(wrapper).element.value).toBe(secondPlace.id);
      expect(timeSelect(wrapper).element.value).toBe(String(start));
      expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    } finally { wrapper?.unmount(); currentUser.value = previous; }
  });
  it('still sends the reviewed version for an unseen server conflict and never retries the proposal automatically', async () => {
    const wrapper = await open();
    await placeSelect(wrapper).setValue(secondPlace.id); await timeSelect(wrapper).setValue(String(late));
    await button(wrapper, 'Confirm this time & place').trigger('click'); await flushPromises();
    api.proposeMeetupPlan.mockRejectedValueOnce(new Error('stale_meetup_version'));
    api.meetup.mockResolvedValueOnce({ meetup: plan({ version: 2 }) });
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.proposeMeetupPlan).toHaveBeenCalledExactlyOnceWith('meetup-1', { placeId: secondPlace.id,
      startsAt: new Date(late).toISOString(), version: 1 });
    expect(wrapper.get('.meetup-recommendations').text()).toContain('This plan has changed.');
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    expect(timeSelect(wrapper).element.value).toBe(String(late));
  });
  it.each(['group', 'kaki'])('preserves %s organizer authority and its existing explicit approval semantics', async scope => {
    const multiple = scope !== 'group';
    const wrapper = await open(plan({ scope: scope === 'kaki' ? { kakiConversationId: 'pair-1' } : { partyId: 'group-1' },
      requiredApprovers: multiple ? ['user-1', 'user-2'] : ['user-1'] }));
    await button(wrapper, multiple ? 'Propose this time & place' : 'Confirm this time & place').trigger('click'); await flushPromises();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain(multiple ? 'required organizers must then approve' : 'immediately confirms');
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(api.approveMeetup).not.toHaveBeenCalled();
  });
  it('keeps ordinary group members’ contributions available without exposing organizer pickers', async () => {
    const wrapper = await open(plan({ capabilities: permissions('planning', false) }));
    expect(wrapper.find('.meetup-picker').exists()).toBe(false);
    expect(wrapper.find('.meetup-recommendations').exists()).toBe(false);
    expect(button(wrapper, 'Save my times').element.disabled).toBe(false);
    expect(wrapper.get('.meetup-suggested-places').findAll('button').filter(control => control.text() === 'Vote for place')).toHaveLength(2);
    await wrapper.vm.requestProposal(ranked()[0]);
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
  });
  it('updates passive place support after voting without introducing another vote control inside the picker', async () => {
    const wrapper = await open();
    api.meetup.mockResolvedValueOnce({ meetup: plan({ version: 2, places: [{ ...publicPlace, votes: 1 }, secondPlace], currentVotePlaceId: publicPlace.id }) });
    await wrapper.get('.meetup-place-row').findAll('button').find(control => control.text() === 'Vote for place').trigger('click'); await flushPromises();
    expect(wrapper.get('.meetup-option').text()).toContain('1 place vote');
    expect(wrapper.get('.meetup-option').text()).toContain('Your preferred place');
    expect(wrapper.get('.meetup-option').findAll('button')).toHaveLength(1);
    expect(wrapper.get('.meetup-option').text()).not.toContain('Remove vote');
  });
});
describe('meeting planner with real OneMap search child', () => {
  it('does not display an unusable creation form when the authoritative context has no future planning window', async () => {
    api.meetupContext.mockResolvedValue({ context: { concert: { ...concert, event_date: '2000-01-01' }, policy: { canSchedule: false }, capabilities: { canCreate: true }, meetups: [] } });
    const { wrapper } = await mountPage(MeetupView, { path: '/meetups?partyId=group-1' });
    expect(wrapper.text()).toContain('No future pre-concert meeting window remains');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Create a separate plan');
    expect(api.createMeetup).not.toHaveBeenCalled();
  });
  it('summarises selected duration separately from the best saved group overlap', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), participantCount: 3, grid: [
      { startsAt: start, availableCount: 1 },
      { startsAt: start + 1800000, availableCount: 2 },
      { startsAt: start + 3600000, availableCount: 2 },
    ] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const summary = wrapper.get('.meetup-time-context');
    // The panel is a group-level readout now: the size, and nothing about the
    // viewer's own draft, which the grid itself already shows.
    expect(summary.get('h3').text()).toBe('Group availability (3)');
    expect(summary.text()).not.toContain('people on this plan');
    expect(summary.text()).not.toContain('available together');
    await wrapper.get(`[data-availability-start="${start + 1800000}"]`).trigger('click');
    expect(summary.get('h3').text()).toBe('Group availability (3)');
    expect(api.meetupAvailability).not.toHaveBeenCalled();
  });
  it('shows one planning step at a time, keeps drafts across steps and supports keyboard navigation', async () => {
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const timePanel = wrapper.get('#meetup-availability'), placesPanel = wrapper.get('#meetup-places');
    expect(timePanel.isVisible()).toBe(true);
    expect(placesPanel.isVisible()).toBe(false);
    expect(wrapper.get('#meetup-review').isVisible()).toBe(false);
    await wrapper.get('[data-availability-start]').trigger('click');
    await wrapper.get('[data-planner-step="places"]').trigger('click');
    expect(timePanel.isVisible()).toBe(false);
    expect(placesPanel.isVisible()).toBe(true);
    expect(wrapper.get('[data-planner-step="places"]').attributes('aria-selected')).toBe('true');
    // Place preference votes are optional and do not block discussion/review.
    expect(wrapper.get('[data-planner-step="review"]').attributes('aria-disabled')).toBe('false');
    await wrapper.get('[data-planner-step="places"]').trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.get('#meetup-review').isVisible()).toBe(true);
    expect(placesPanel.isVisible()).toBe(false);
    await wrapper.get('[data-planner-step="review"]').trigger('keydown', { key: 'Home' });
    expect(timePanel.isVisible()).toBe(true);
    expect(wrapper.get('[data-availability-start]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.text()).toContain('Unsaved changes');
    expect(api.meetupAvailability).not.toHaveBeenCalled();
  });
  it('lets an authorized person inspect places and discussion before saving times without making any automatic writes', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), availability: [], grid: [{ startsAt: start, availableCount: 0 }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const next = button(wrapper, 'Next: suggest places →');
    expect(next.element.disabled).toBe(false);
    expect(button(wrapper, 'Save my times').element.disabled).toBe(true);
    expect(wrapper.get('.meetup-next-step').text()).toContain('No response is saved for you.');
    await wrapper.get('[data-planner-step="places"]').trigger('click');
    expect(wrapper.get('#meetup-places').isVisible()).toBe(true);
    await wrapper.get('[data-planner-step="review"]').trigger('click');
    expect(wrapper.get('#meetup-review').isVisible()).toBe(true);
    expect(wrapper.get('.meetup-discussion textarea').element.disabled).toBe(false);
    expect(api.meetupAvailability).not.toHaveBeenCalled();
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    await wrapper.get('[data-planner-step="availability"]').trigger('click');
    await wrapper.get('[data-availability-start]').trigger('click');
    expect(wrapper.text()).toContain('Save your changes to update the group.');
    expect(next.element.disabled).toBe(false);
    api.meetup.mockResolvedValue({ meetup: { ...board(), version: 2 } });
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(next.element.disabled).toBe(false);
    await next.trigger('click');
    expect(wrapper.get('#meetup-places').isVisible()).toBe(true);
  });
  it('opens review and discussion with saved times without requiring or creating a place vote', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [publicPlace] } });
    const { wrapper, router } = await mountPage(MeetupView, { path: '/meetups/meetup-1#meetup-review', props: { id: 'meetup-1' } });
    expect(wrapper.get('#meetup-review').isVisible()).toBe(true);
    expect(router.currentRoute.value.hash).toBe('#meetup-review');
    expect(button(wrapper, 'Next: finalise meetup →').element.disabled).toBe(false);
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('Optional: one place vote per person.');
    expect(api.voteMeetupPlace).not.toHaveBeenCalled();
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
  });
  it('opens an existing step anchor without changing the planner route', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [publicPlace], currentVotePlaceId: 'place-1' } });
    const { wrapper } = await mountPage(MeetupView, { path: '/meetups/meetup-1#meetup-review', props: { id: 'meetup-1' } });
    expect(wrapper.get('#meetup-review').isVisible()).toBe(true);
    expect(wrapper.get('#meetup-availability').isVisible()).toBe(false);
  });
  it.each(['drive', 'transit'])('saves selected availability using %s', async mode => {
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const travel = wrapper.findAll('select').find(select => select.findAll('option').some(option => option.text() === 'Car'));
    expect(travel.findAll('option').map(option => option.text())).toEqual(['Public transport', 'Car']);
    await travel.setValue(mode);
    await button(wrapper, 'Apply to selected times').trigger('click');
    expect(wrapper.get('.meetup-journey [role="status"]').text()).toContain(mode === 'drive'
      ? 'Not saved yet. Save to share.' : 'These details already match your saved availability.');
    expect(api.meetupAvailability).not.toHaveBeenCalled();
    await button(wrapper, 'Save my times').trigger('click');
    await flushPromises();
    expect(api.meetupAvailability).toHaveBeenCalledWith('meetup-1', [{
      startsAt: new Date(start).toISOString(), endsAt: new Date(start + 1800000).toISOString(),
      travelMode: mode, latitude: 1.3, longitude: 103.85, label: 'City Hall',
    }], 1);
    expect(wrapper.get('#meetup-availability').text()).toContain('Your availability has been saved.');
  });
  it('saves the real search child selection as the starting location', async () => {
    api.meetupLocations.mockResolvedValue({ result: { status: 'available', locations: [{ label: 'City Hall MRT', address: '150 North Bridge Road', latitude: 1.293, longitude: 103.852 }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const search = wrapper.findAllComponents(MeetupLocationSearch).find(child => child.props('label') === 'Private starting point');
    await search.get('input').setValue('City Hall');
    await button(search, 'Search OneMap').trigger('click');
    await flushPromises();
    await search.findAll('button').find(candidate => candidate.text().includes('City Hall MRT')).trigger('click');
    await button(wrapper, 'Apply to selected times').trigger('click');
    await button(wrapper, 'Save my times').trigger('click');
    await flushPromises();
    expect(api.meetupLocations).toHaveBeenCalledWith('meetup-1', 'City Hall');
    expect(api.meetupAvailability).toHaveBeenCalledWith('meetup-1', [expect.objectContaining({ label: 'City Hall MRT', latitude: 1.293, longitude: 103.852 })], 1);
  });
  it('keeps manual entry available when OneMap fails', async () => {
    api.meetupLocations.mockResolvedValue({ result: { status: 'unavailable', locations: [] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const search = wrapper.findAllComponents(MeetupLocationSearch).find(child => child.props('label') === 'Private starting point');
    await search.get('input').setValue('City Hall');
    await button(search, 'Search OneMap').trigger('click');
    await flushPromises();
    expect(search.text()).toContain('You can still enter a place and its coordinates below.');
    expect(button(wrapper, 'Save my times').element.disabled).toBe(false);
    expect(field(wrapper, 'Place name').exists()).toBe(true);
  });
  it('labels estimated journeys when fresh route times are unavailable', async () => {
    const estimate = {
      placeId: 'place-1', label: 'City Hall MRT', startsAt: start, availableCount: 2,
      participantCount: 2, totalDistanceKm: 4, locationRespondents: 2,
      basis: 'straight_line_distance', totalTravelMinutes: null, travelModes: { transit: 1, drive: 1 },
    };
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [publicPlace], suggestions: [estimate] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(wrapper.text()).toContain('About 4 km combined distance');
    expect(wrapper.text()).toContain('Straight-line distance estimate.');
  });
  it('refreshes saved group counts live while keeping unsaved locations and discussion', async () => {
    vi.useFakeTimers();
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const ownLocation = field(wrapper, 'Location label');
    await ownLocation.setValue('My unsaved station');
    await field(wrapper, 'Latitude').setValue('1.3');
    await field(wrapper, 'Longitude').setValue('103.85');
    await button(wrapper, 'Apply to selected times').trigger('click');
    await wrapper.get('textarea').setValue('A discussion draft');
    api.meetup.mockResolvedValue({ meetup: { ...board(), version: 2, participantCount: 3, grid: [{ startsAt: start, availableCount: 2 }] } });
    live.handler('meetup-updated', { meetupId: 'meetup-1', version: 2 });
    await vi.advanceTimersByTimeAsync(160); await flushPromises();
    expect(wrapper.get('[data-availability-start]').text()).toContain('2/3');
    expect(wrapper.get('[data-availability-start]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('textarea').element.value).toBe('A discussion draft');
    expect(wrapper.text()).toContain('Your unsaved availability is kept');
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(api.meetupAvailability).toHaveBeenCalledWith('meetup-1', [expect.objectContaining({ label: 'My unsaved station' })], 2);
  });
  it('refreshes same-version comments and approvals, ignores other boards and stops after unmount', async () => {
    vi.useFakeTimers();
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const calls = api.meetup.mock.calls.length;
    live.handler('meetup-updated', { meetupId: 'other-board', version: 10 });
    await vi.advanceTimersByTimeAsync(160); expect(api.meetup).toHaveBeenCalledTimes(calls);
    api.meetup.mockResolvedValue({ meetup: { ...board(), comments: [{ id: 'comment-1', name: 'Sam', body: 'Fresh live discussion' }] } });
    live.handler('meetup-updated', { meetupId: 'meetup-1', version: 1 });
    await vi.advanceTimersByTimeAsync(160); await flushPromises();
    expect(wrapper.text()).toContain('Fresh live discussion');
    wrapper.unmount();
    const after = api.meetup.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000); expect(api.meetup).toHaveBeenCalledTimes(after);
    expect(live.handler).toBe(null);
  });
  it('keeps the heatmap draft on a stale save and reloads the current version for review', async () => {
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await wrapper.get('[data-availability-start]').trigger('click');
    api.meetupAvailability.mockRejectedValue(new Error('stale_meetup_version'));
    api.meetup.mockResolvedValue({ meetup: { ...board(), version: 3 } });
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('This plan has changed');
    expect(wrapper.get('[data-availability-start]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.text()).toContain('Unsaved changes');
  });
  it('clears private drafts when changing boards and ignores the previous board’s late routes', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [publicPlace] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await field(wrapper, 'Location label').setValue('Previous private origin');
    await field(wrapper, 'Place name').setValue('Previous proposed place');
    await wrapper.get('textarea').setValue('Previous discussion draft');
    api.meetup.mockResolvedValue({ meetup: { ...board(), id: 'meetup-2', title: 'Other plan' } });
    await wrapper.setProps({ id: 'meetup-2' }); await flushPromises();
    expect(field(wrapper, 'Location label').element.value).toBe('');
    expect(field(wrapper, 'Place name').element.value).toBe('');
    expect(wrapper.get('textarea').element.value).toBe('');
  });

  it('keeps each period’s existing origin when applying only the travel method', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), grid: [{ startsAt: start, availableCount: 1 }, { startsAt: start + 1800000, availableCount: 1 }],
      availability: [board().availability[0], { starts_at: start + 1800000, ends_at: start + 3600000, travel_mode: 'transit', latitude: 1.32, longitude: 103.88, label: 'Second origin' }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(field(wrapper, 'Latitude').element.value).toBe('');
    expect(field(wrapper, 'Longitude').element.value).toBe('');
    await field(wrapper, 'Travel method').setValue('drive');
    await button(wrapper, 'Apply to selected times').trigger('click');
    expect(wrapper.get('.meetup-journey [role="status"]').text()).toContain('2 selected times. Not saved yet.');
    expect(wrapper.text()).toContain('Unsaved changes');
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(api.meetupAvailability).toHaveBeenCalledWith('meetup-1', [
      expect.objectContaining({ travelMode: 'drive', latitude: 1.3, longitude: 103.85, label: 'City Hall' }),
      expect.objectContaining({ travelMode: 'drive', latitude: 1.32, longitude: 103.88, label: 'Second origin' }),
    ], 1);
  });

  it('saves a new selected period without inventing a starting location', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), availability: [], grid: [{ startsAt: start, availableCount: 0 }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(button(wrapper, 'Apply to selected times').element.disabled).toBe(true);
    expect(wrapper.text()).toContain('Pick your times first.');
    await wrapper.get('[data-availability-start]').trigger('click');
    await field(wrapper, 'Travel method').setValue('drive');
    await button(wrapper, 'Apply to selected times').trigger('click');
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(api.meetupAvailability).toHaveBeenCalledWith('meetup-1', [{ startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 1800000).toISOString(), travelMode: 'drive' }], 1);
  });

  it('rejects incomplete manual origins and saves a complete manual journey', async () => {
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await field(wrapper, 'Location label').setValue('My approximate station');
    await field(wrapper, 'Latitude').setValue('1.3');
    await button(wrapper, 'Apply to selected times').trigger('click');
    expect(wrapper.get('.meetup-journey [role="alert"]').text()).toContain('enter both valid coordinates');
    expect(api.meetupAvailability).not.toHaveBeenCalled();
    await field(wrapper, 'Longitude').setValue('103.85');
    await button(wrapper, 'Apply to selected times').trigger('click');
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(api.meetupAvailability).toHaveBeenCalledWith('meetup-1', [expect.objectContaining({
      label: 'My approximate station', latitude: 1.3, longitude: 103.85,
    })], 1);
  });

  it('shows saved confirmation beside availability and removes the unsaved marker after server refresh', async () => {
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await field(wrapper, 'Travel method').setValue('drive');
    await button(wrapper, 'Apply to selected times').trigger('click');
    expect(wrapper.text()).toContain('Unsaved changes');
    api.meetup.mockResolvedValue({ meetup: { ...board(), version: 2, availability: [{ ...board().availability[0], travel_mode: 'drive' }] } });
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(wrapper.get('#meetup-availability > [role="status"]').text()).toBe('Your availability has been saved.');
    expect(wrapper.get('.meetup-availability__summary').text()).toContain('Your saved availability');
    expect(wrapper.text()).not.toContain('Meetup updated.');
  });

  it('shows a newly saved place immediately even before the group overlaps and clears only its submitted draft', async () => {
    const empty = { ...board(), grid: [{ startsAt: start, availableCount: 0 }] };
    api.meetup.mockResolvedValue({ meetup: empty });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await wrapper.get('[data-planner-step="places"]').trigger('click');
    const form = wrapper.get('.meetup-place-editor');
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('No places yet');
    expect(wrapper.find('.meetup-option').exists()).toBe(false);
    const search = form.getComponent(MeetupLocationSearch);
    api.meetupLocations.mockResolvedValue({ result: { status: 'available', locations: [publicPlace] } });
    await search.get('input').setValue('City Hall');
    await button(search, 'Search OneMap').trigger('click'); await flushPromises();
    await search.get('.meetup-search-result').trigger('click');
    expect(search.text()).toContain('Selection is not saved.');
    api.meetup.mockResolvedValue({ meetup: { ...empty, version: 2, places: [publicPlace] } });
    await form.trigger('submit'); await flushPromises();
    expect(api.proposeMeetupPlace).toHaveBeenCalledExactlyOnceWith('meetup-1', expect.objectContaining({ label: 'City Hall MRT', latitude: 1.293, longitude: 103.852, sheltered: true }));
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('City Hall MRT');
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('Suggested by you');
    expect(form.get('[role="status"]').text()).toContain('City Hall MRT is saved in suggested places. Recommendations will appear once participants save their available times.');
    expect(wrapper.get('.meetup-empty-state').text()).toContain('Your suggested places are saved.');
    expect(wrapper.find('.meetup-option').exists()).toBe(false);
    expect(field(form, 'Place name').element.value).toBe('');
    expect(search.get('input').element.value).toBe('');
    expect(wrapper.get('#meetup-places').isVisible()).toBe(true);
  });

  it('preserves the place draft on failure, prevents pending duplicate submission and allows a retry', async () => {
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const form = wrapper.get('.meetup-place-editor');
    await field(form, 'Place name').setValue('City Hall MRT');
    await field(form, 'Latitude').setValue('1.293');
    await field(form, 'Longitude').setValue('103.852');
    let reject;
    api.proposeMeetupPlace.mockReturnValueOnce(new Promise((_, failure) => { reject = failure; }));
    await form.trigger('submit'); await form.trigger('submit');
    expect(api.proposeMeetupPlace).toHaveBeenCalledTimes(1);
    expect(button(wrapper, 'Saving place...').element.disabled).toBe(true);
    reject(new Error('invalid_place')); await flushPromises();
    expect(form.get('[role="alert"]').text()).toContain('Enter a place name and both valid');
    expect(form.find('[role="status"]').exists()).toBe(false);
    expect(field(form, 'Place name').element.value).toBe('City Hall MRT');
    expect(field(form, 'Latitude').element.value).toBe('1.293');
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [publicPlace] } });
    await form.trigger('submit'); await flushPromises();
    expect(api.proposeMeetupPlace).toHaveBeenCalledTimes(2);
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('City Hall MRT');
    expect(form.find('[role="alert"]').exists()).toBe(false);
  });

  it('rejects invalid manual meeting coordinates without submitting or clearing the place name', async () => {
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const form = wrapper.get('.meetup-place-editor');
    await field(form, 'Place name').setValue('Public foyer');
    await field(form, 'Latitude').setValue('1.3');
    await form.trigger('submit'); await flushPromises();
    expect(form.get('[role="alert"]').text()).toContain('both valid latitude and longitude');
    expect(api.proposeMeetupPlace).not.toHaveBeenCalled();
    expect(field(form, 'Place name').element.value).toBe('Public foyer');
  });

  it('shows recommendations only to the organizer and without travel comparison controls', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [publicPlace] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(wrapper.get('.meetup-empty-state').text()).toContain('No suitable time and place combinations yet.');
    expect(wrapper.text()).not.toContain('How recommendations work');
    expect(wrapper.text()).not.toContain('Only places marked sheltered');
    expect(wrapper.findAll('button').some(item => item.text() === 'Compare travel options')).toBe(false);
    api.meetup.mockResolvedValue({ meetup: { ...board(), capabilities: permissions('planning', false), places: [publicPlace] } });
    await wrapper.get('.meetup-page').exists();
    const member = (await mountPage(MeetupView, { props: { id: 'meetup-1' } })).wrapper;
    expect(member.find('.meetup-recommendations').exists()).toBe(false);
  });

  it('updates the detail card when the organizer picks another time or place', async () => {
    const later = start + 30 * 60000;
    const other = { id: 'place-2', label: 'Bugis MRT', latitude: 1.3, longitude: 103.85, sheltered: false, votes: 0 };
    const option = (placeId, label, startsAt, availableCount, totalDistanceKm) => ({ placeId, label, startsAt, availableCount, participantCount: 2,
      totalDistanceKm, locationRespondents: availableCount, basis: 'straight_line_distance', totalTravelMinutes: null });
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [publicPlace, other], suggestions: [
      option('place-1', 'City Hall MRT', start, 2, 3), option('place-1', 'City Hall MRT', later, 1, 5), option('place-2', 'Bugis MRT', start, 1, 9),
    ] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const card = () => wrapper.get('.meetup-recommendations .meetup-option').text();
    expect(card()).toContain('2 of 2 available'); expect(card()).toContain('About 3 km combined distance for 2 of 2 available participants');
    await wrapper.get('[data-planner-step="review"]').trigger('click');
    await button(wrapper, 'Compare other options').trigger('click');
    expect(wrapper.get('.meetup-picker').isVisible()).toBe(true);
    const [placeSelect, timeSelect] = wrapper.findAll('.meetup-picker select');
    await timeSelect.setValue(String(later));
    expect(card()).toContain('1 of 2 available'); expect(card()).toContain('About 5 km combined distance for 1 of 1 available participants');
    await placeSelect.setValue('place-2');
    expect(card()).toContain('Bugis MRT'); expect(card()).toContain('About 9 km combined distance for 1 of 1 available participants');
  });

  it('lets ordinary members contribute and discuss while keeping organizer decisions out of their controls', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), capabilities: permissions('planning', false), places: [publicPlace], suggestions: [suggestion] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(button(wrapper, 'Save my times').element.disabled).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Cancel meetup')).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Reopen planning')).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Propose this time & place')).toBe(false);
    await button(wrapper, 'Vote for place').trigger('click'); await flushPromises();
    expect(api.voteMeetupPlace).toHaveBeenCalledExactlyOnceWith('meetup-1', 'place-1', 1);
    expect(wrapper.get('.meetup-place-editor > [role="status"]').text()).toBe('Your vote has been saved. This records your preferred place; the final time and place still need organizer confirmation.');
    await wrapper.get('textarea').setValue('Can we meet by the sheltered entrance?');
    await wrapper.get('.meetup-discussion form').trigger('submit'); await flushPromises();
    expect(api.meetupComment).toHaveBeenCalledExactlyOnceWith('meetup-1', 'Can we meet by the sheltered entrance?');
    expect(wrapper.get('.meetup-discussion > [role="status"]').text()).toBe('Your message was posted.');
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
  });

  it.each(['proposed', 'confirmed'])('locks %s participant contributions while preserving discussion', async status => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), status, capabilities: permissions(status, false),
      selected_place_id: 'place-1', selected_start: start, places: [publicPlace], suggestions: [suggestion] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(button(wrapper, 'Save my times').element.disabled).toBe(true);
    expect(button(wrapper, 'Apply to selected times').element.disabled).toBe(true);
    expect(wrapper.get('[data-availability-start]').element.disabled).toBe(true);
    expect(wrapper.get('.meetup-suggested-places').findAll('button')).toHaveLength(0);
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('Voting locked');
    expect(wrapper.get('.meetup-place-editor fieldset').element.disabled).toBe(true);
    expect(wrapper.findAll('button').some(item => item.text() === 'Approve plan')).toBe(false);
    expect(wrapper.get('textarea').element.disabled).toBe(false);
    await wrapper.get('textarea').setValue('Could the host reopen the plan to change the venue?');
    await wrapper.get('.meetup-discussion form').trigger('submit'); await flushPromises();
    expect(api.meetupComment).toHaveBeenCalledTimes(1);
    expect(api.reopenMeetup).not.toHaveBeenCalled();
    expect(api.meetupAvailability).not.toHaveBeenCalled();
    expect(api.proposeMeetupPlace).not.toHaveBeenCalled();
  });

  it('proposes a ranked option and displays the approval response beside the chosen plan', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [publicPlace], suggestions: [suggestion] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    api.meetup.mockResolvedValue({ meetup: { ...board(), version: 2, status: 'proposed', capabilities: permissions('proposed'),
      places: [publicPlace], selected_place_id: 'place-1', selected_start: start, requiredApprovers: ['user-1', 'user-2'] } });
    await button(wrapper, 'Propose this time & place').trigger('click'); await flushPromises();
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]').textContent).toContain('City Hall MRT');
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.proposeMeetupPlan).toHaveBeenCalledExactlyOnceWith('meetup-1', { placeId: 'place-1', startsAt: new Date(start).toISOString(), version: 1 });
    expect(wrapper.get('#meetup-review').isVisible()).toBe(true);
    expect(wrapper.text()).toContain('Your plan has been submitted for approval.');
    await button(wrapper, 'Approve plan').trigger('click'); await flushPromises();
    expect(api.approveMeetup).toHaveBeenCalledExactlyOnceWith('meetup-1', 2);
    expect(wrapper.text()).toContain('Your approval has been recorded.');
  });

  it('requires explicit confirmation before reopening and keeps previous drafts for review', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), status: 'confirmed', version: 4, capabilities: permissions('confirmed'),
      places: [publicPlace], selected_place_id: 'place-1', selected_start: start, requiredApprovers: ['user-1', 'user-2'], approvals: ['user-1', 'user-2'] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await wrapper.get('textarea').setValue('Keep this discussion draft');
    await button(wrapper, 'Reopen planning').trigger('click'); await flushPromises();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('Previous approvals will no longer authorize the plan');
    expect(api.reopenMeetup).not.toHaveBeenCalled();
    dialog.querySelector('.confirm__actions button').click(); await flushPromises();
    expect(api.reopenMeetup).not.toHaveBeenCalled();
    await button(wrapper, 'Reopen planning').trigger('click'); await flushPromises();
    api.meetup.mockResolvedValue({ meetup: { ...board(), version: 5, places: [publicPlace] } });
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.reopenMeetup).toHaveBeenCalledExactlyOnceWith('meetup-1', 4);
    expect(wrapper.get('#meetup-availability').isVisible()).toBe(true);
    expect(wrapper.get('textarea').element.value).toBe('Keep this discussion draft');
    expect(wrapper.text()).toContain('A new proposal needs fresh approvals.');
    expect(document.querySelector('[role="dialog"]')).toBe(null);
  });

  it('shows cancelled plans read-only without organizer or discussion controls', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), status: 'cancelled', capabilities: permissions('cancelled') } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(button(wrapper, 'Save my times').element.disabled).toBe(true);
    expect(button(wrapper, 'Post').element.disabled).toBe(true);
    expect(wrapper.get('textarea').element.disabled).toBe(true);
    expect(wrapper.findAll('button').some(item => item.text() === 'Reopen planning')).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Cancel meetup')).toBe(false);
  });

  it('retains an unsaved heatmap draft when a live update confirms the plan and locks further changes', async () => {
    vi.useFakeTimers();
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await wrapper.get('[data-availability-start]').trigger('click');
    await wrapper.get('textarea').setValue('My pending change request');
    api.meetup.mockResolvedValue({ meetup: { ...board(), version: 2, status: 'confirmed', capabilities: permissions('confirmed', false),
      places: [publicPlace], selected_place_id: 'place-1', selected_start: start } });
    live.handler('meetup-updated', { meetupId: 'meetup-1', version: 2 });
    await vi.advanceTimersByTimeAsync(160); await flushPromises();
    expect(wrapper.get('[data-availability-start]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[data-availability-start]').element.disabled).toBe(true);
    expect(wrapper.text()).toContain('Your unsaved availability is kept');
    expect(wrapper.text()).toContain('Unsaved changes');
    expect(wrapper.get('textarea').element.value).toBe('My pending change request');
    expect(api.meetupAvailability).not.toHaveBeenCalled();
  });

  it('keeps the version shown when a reopen dialog opened and reports a stale confirmation without retrying it', async () => {
    vi.useFakeTimers();
    const confirmed = { ...board(), status: 'confirmed', version: 4, capabilities: permissions('confirmed'),
      places: [publicPlace], selected_place_id: 'place-1', selected_start: start };
    api.meetup.mockResolvedValue({ meetup: confirmed });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await button(wrapper, 'Reopen planning').trigger('click'); await flushPromises();
    api.meetup.mockResolvedValue({ meetup: { ...confirmed, version: 5 } });
    live.handler('meetup-updated', { meetupId: 'meetup-1', version: 5 });
    await vi.advanceTimersByTimeAsync(160); await flushPromises();
    api.reopenMeetup.mockRejectedValueOnce(new Error('stale_meetup_version'));
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.reopenMeetup).toHaveBeenCalledExactlyOnceWith('meetup-1', 4);
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    expect(wrapper.get('#meetup-review [role="alert"]').text()).toContain('This plan has changed.');
    expect(wrapper.text()).toContain('This plan is confirmed.');
    expect(button(wrapper, 'Save my times').element.disabled).toBe(true);
  });

  it('reports the final required approval as confirmation and preserves failed discussion drafts for retry', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), status: 'proposed', version: 2, capabilities: permissions('proposed'),
      places: [publicPlace], selected_place_id: 'place-1', selected_start: start, requiredApprovers: ['user-1', 'user-2'], approvals: ['user-2'] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    api.approveMeetup.mockResolvedValueOnce({ approval: { confirmed: true } });
    api.meetup.mockResolvedValue({ meetup: { ...board(), status: 'confirmed', version: 2, capabilities: permissions('confirmed'),
      places: [publicPlace], selected_place_id: 'place-1', selected_start: start, requiredApprovers: ['user-1', 'user-2'], approvals: ['user-1', 'user-2'] } });
    await button(wrapper, 'Approve plan').trigger('click'); await flushPromises();
    expect(wrapper.get('#meetup-review > [role="status"]').text()).toBe('The meetup is confirmed.');
    expect(wrapper.findAll('button').some(item => item.text() === 'Approve plan')).toBe(false);
    await wrapper.get('textarea').setValue('Could we consider a sheltered entrance?');
    api.meetupComment.mockRejectedValueOnce(new Error('invalid_comment'));
    await wrapper.get('.meetup-discussion form').trigger('submit'); await flushPromises();
    expect(wrapper.get('.meetup-discussion [role="alert"]').text()).toContain('up to 2,000 characters');
    expect(wrapper.get('textarea').element.value).toBe('Could we consider a sheltered entrance?');
    expect(wrapper.find('.meetup-discussion [role="status"]').exists()).toBe(false);
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(api.reopenMeetup).not.toHaveBeenCalled();
  });
});

describe('meetup decision interaction semantics', () => {
  it('keeps the server’s final approval count accurate when another approval was absent from the stale board', async () => {
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), status: 'proposed', capabilities: permissions('proposed'),
      requiredApprovers: ['user-1', 'user-2'], approvals: [], selected_place_id: publicPlace.id, selected_start: start, places: [publicPlace] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    api.approveMeetup.mockResolvedValueOnce({ approval: { confirmed: true, version: 1,
      approvals: ['user-2', 'user-1'], requiredApprovers: ['user-1', 'user-2'] } });
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Approve plan').trigger('click'); await flushPromises();
    expect(wrapper.get('.meetup-approval-progress').text()).toContain('Approvals: 2/2');
    expect(wrapper.text()).toContain('Meetup confirmed');
    expect(wrapper.findAll('button').some(item => item.text() === 'Approve plan')).toBe(false);
  });
  it('uses the acknowledged version to remove a newly saved vote after a failed follow-up read', async () => {
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), places: [publicPlace] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    api.voteMeetupPlace.mockResolvedValueOnce({ result: { voted: true, version: 2 } });
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Vote for place').trigger('click'); await flushPromises();
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('1 vote');
    api.removeMeetupVote.mockResolvedValueOnce({ result: { voted: false, version: 3 } });
    await button(wrapper, 'Remove vote').trigger('click'); await flushPromises();
    expect(api.removeMeetupVote).toHaveBeenCalledExactlyOnceWith('meetup-1', 2);
    expect(wrapper.get('[data-planner-step="review"]').attributes('aria-disabled')).toBe('false');
  });
  it('keeps acknowledged approval and hides its action when the following read fails', async () => {
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), status: 'proposed', capabilities: permissions('proposed'),
      requiredApprovers: ['user-1', 'user-2'], selected_place_id: publicPlace.id, selected_start: start, places: [publicPlace] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    api.approveMeetup.mockResolvedValueOnce({ approval: { confirmed: false, version: 1 } });
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Approve plan').trigger('click'); await flushPromises();
    expect(wrapper.findAll('button').some(item => item.text() === 'Approve plan')).toBe(false);
    expect(wrapper.get('.meetup-approval-progress').text()).toContain('Approvals: 1/2');
    expect(wrapper.text()).toContain('Your approval is saved.');
    expect(wrapper.text()).toContain('Your change was saved. Group details could not refresh');
  });
  it('keeps an acknowledged reopening usable when the following read fails and clears old approvals', async () => {
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), status: 'confirmed', capabilities: permissions('confirmed'),
      requiredApprovers: ['user-1', 'user-2'], approvals: ['user-1', 'user-2'], hasApproved: true,
      selected_place_id: publicPlace.id, selected_start: start, places: [publicPlace] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await button(wrapper, 'Reopen planning').trigger('click'); await flushPromises();
    api.reopenMeetup.mockResolvedValueOnce({ result: { reopened: true, version: 2 } });
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(wrapper.get('#meetup-availability').isVisible()).toBe(true);
    expect(button(wrapper, 'Save my times').element.disabled).toBe(false);
    expect(wrapper.text()).toContain('Collecting availability');
    expect(wrapper.text()).not.toContain('Approvals: 2/2');
    expect(wrapper.text()).toContain('Your change was saved. Group details could not refresh');
  });
  it('keeps an acknowledged cancellation read-only when the following read fails', async () => {
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await button(wrapper, 'Cancel meetup').trigger('click'); await flushPromises();
    api.cancelMeetup.mockResolvedValueOnce({ result: { cancelled: true } }); api.meetup.mockRejectedValueOnce(new Error('offline'));
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(wrapper.text()).toContain('Meetup cancelled');
    expect(button(wrapper, 'Save my times').element.disabled).toBe(true);
    expect(wrapper.get('textarea').element.disabled).toBe(true);
    expect(wrapper.findAll('button').some(item => item.text() === 'Cancel meetup')).toBe(false);
  });
  it('keeps voting exclusively in suggested places and removes the current vote', async () => {
    const plan = { ...board(), places: [{ ...publicPlace, votes: 1 }], currentVotePlaceId: publicPlace.id, suggestions: [suggestion] };
    api.meetup.mockResolvedValue({ meetup: plan });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(wrapper.get('.meetup-recommendations').text()).toContain('Your preferred place');
    expect(wrapper.get('.meetup-recommendations').findAll('button').some(item => /Vote for place|Remove vote/.test(item.text()))).toBe(false);
    api.meetup.mockResolvedValue({ meetup: { ...plan, version: 2, currentVotePlaceId: null, places: [publicPlace] } });
    await button(wrapper, 'Remove vote').trigger('click'); await flushPromises();
    expect(api.removeMeetupVote).toHaveBeenCalledExactlyOnceWith('meetup-1', 1);
    expect(api.voteMeetupPlace).not.toHaveBeenCalled();
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('0 votes');
    expect(wrapper.get('.meetup-recommendations').text()).not.toContain('Your preferred place');
    expect(wrapper.text()).toContain('Your vote has been removed.');
    expect(wrapper.get('[data-planner-step="review"]').attributes('aria-disabled')).toBe('false');
  });
  it('shows locked support as information instead of an enabled-looking vote action', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), status: 'confirmed', capabilities: permissions('confirmed', false),
      selected_place_id: publicPlace.id, selected_start: start, currentVotePlaceId: publicPlace.id, places: [{ ...publicPlace, votes: 1 }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('Your vote');
    expect(wrapper.get('.meetup-suggested-places').findAll('button')).toHaveLength(0);
    expect(api.removeMeetupVote).not.toHaveBeenCalled();
  });
  it('groups ranked time options into dropdowns and keeps a single selected recommendation action', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [publicPlace], suggestions: [suggestion,
      { ...suggestion, startsAt: start + 1800000, availableCount: 1 }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(wrapper.findAll('.meetup-option')).toHaveLength(1);
    expect(field(wrapper.get('.meetup-picker'), 'Time').findAll('option')).toHaveLength(2);
    expect(wrapper.get('.meetup-option h3').text()).toBe(publicPlace.label);
    expect(wrapper.get('.meetup-option').text()).toContain('Rank 1');
    expect(field(wrapper.get('.meetup-picker'), 'Time').text()).toContain('Rank 2');
    expect(wrapper.get('.meetup-option').findAll('button')).toHaveLength(1);
  });
  it('reviews incomplete attendance, votes and immediate confirmation before sending a proposal', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), participantCount: 3, requiredApprovers: ['user-1'], places: [{ ...publicPlace, votes: 2 }],
      suggestions: [{ ...suggestion, availableCount: 1, participantCount: 3, votes: 2 }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await button(wrapper, 'Confirm this time & place').trigger('click'); await flushPromises();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('Only 1 of 3 participants');
    expect(dialog.textContent).toContain('City Hall MRT');
    expect(dialog.textContent).toContain('2 place votes');
    expect(dialog.textContent).toContain('immediately confirms');
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    dialog.querySelector('.confirm__actions button').click(); await flushPromises();
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(api.voteMeetupPlace).not.toHaveBeenCalled();
  });
  it('blocks a known stale reviewed selection before posting and asks the organizer to review again', async () => {
    vi.useFakeTimers();
    const original = { ...board(), requiredApprovers: ['user-1', 'user-2'], places: [publicPlace], suggestions: [suggestion] };
    api.meetup.mockResolvedValueOnce({ meetup: original });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await button(wrapper, 'Propose this time & place').trigger('click'); await flushPromises();
    api.meetup.mockResolvedValue({ meetup: { ...original, version: 2 } });
    live.handler('meetup-updated', { meetupId: 'meetup-1', version: 2 });
    await vi.advanceTimersByTimeAsync(160); await flushPromises();
    api.proposeMeetupPlan.mockRejectedValueOnce(new Error('stale_meetup_version'));
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(wrapper.get('.meetup-recommendations').text()).toContain('This recommendation or plan has changed.');
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    expect(api.approveMeetup).not.toHaveBeenCalled();
  });
  it('requests sheltered baseline options from the server before limiting and never calls the travel provider implicitly', async () => {
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), places: [publicPlace], suggestions: [] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), places: [publicPlace], suggestionsShelteredOnly: true, suggestions: [suggestion] } });
    wrapper.vm.travelOptions.shelteredOnly = true;
    await wrapper.vm.changeShelterFilter(); await flushPromises();
    expect(api.meetup).toHaveBeenLastCalledWith('meetup-1', { shelteredOnly: true });
    expect(wrapper.get('.meetup-recommendations').text()).toContain('City Hall MRT');
    expect(api.meetupTravelSuggestions).not.toHaveBeenCalled();
  });
  it('does not leave stale unsheltered recommendations visible after a filter read fails', async () => {
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), places: [publicPlace], suggestions: [suggestion] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    wrapper.vm.travelOptions.shelteredOnly = true;
    await wrapper.vm.changeShelterFilter(); await flushPromises();
    expect(wrapper.find('.meetup-picker').exists()).toBe(false);
    expect(wrapper.get('.meetup-recommendations').text()).toContain('Could not refresh filtered recommendations');
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('City Hall MRT');
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), places: [publicPlace], suggestionsShelteredOnly: true, suggestions: [suggestion] } });
    await button(wrapper, 'Refresh planner').trigger('click'); await flushPromises();
    expect(wrapper.find('.meetup-picker').exists()).toBe(true);
    expect(wrapper.get('.meetup-recommendations').text()).not.toContain('Could not refresh filtered recommendations');
  });
  it.each([401, 403, 404])('clears the visible board when a filtered read reports access loss (%s)', async status => {
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), places: [publicPlace], suggestions: [suggestion] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    api.meetup.mockRejectedValueOnce(Object.assign(new Error('access denied'), { status }));
    wrapper.vm.travelOptions.shelteredOnly = true;
    await wrapper.vm.changeShelterFilter(); await flushPromises();
    expect(wrapper.find('#meetup-availability').exists()).toBe(false);
    expect(wrapper.find('.meetup-suggested-places').exists()).toBe(false);
    expect(wrapper.text()).toContain('This meetup is unavailable, or you are no longer a participant.');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
  it.each([401, 403, 404])('clears the visible board when a travel comparison reports access loss (%s)', async status => {
    api.meetup.mockResolvedValueOnce({ meetup: { ...board(), places: [publicPlace], suggestions: [suggestion] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    api.meetupTravelSuggestions.mockRejectedValueOnce(Object.assign(new Error('access denied'), { status }));
    await wrapper.vm.getTravelSuggestions(); await flushPromises();
    expect(wrapper.find('#meetup-availability').exists()).toBe(false);
    expect(wrapper.text()).toContain('This meetup is unavailable, or you are no longer a participant.');
  });
  it.each([[401, 'authentication_required'], [404, 'meetup_not_found'], [403, 'scope_membership_required']])(
    'clears the visible board when a mutation reports revoked authentication or scope (%s, %s)', async (status, code) => {
      api.meetup.mockResolvedValueOnce({ meetup: { ...board(), places: [publicPlace] } });
      const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
      api.voteMeetupPlace.mockRejectedValueOnce(Object.assign(new Error(code), { status }));
      await button(wrapper, 'Vote for place').trigger('click'); await flushPromises();
      expect(wrapper.find('#meetup-availability').exists()).toBe(false);
      expect(wrapper.text()).toContain('This meetup is unavailable, or you are no longer a participant.');
    });
  it.each([[403, 'place_owner_required'], [404, 'place_not_found']])(
    'retains the board and place draft for target-specific permission or missing-place errors (%s)', async (status, code) => {
      api.meetup.mockResolvedValueOnce({ meetup: { ...board(), places: [{ ...publicPlace, canEdit: true }] } });
      const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
      await button(wrapper, 'Correct place').trigger('click');
      const form = wrapper.get('.meetup-place-editor');
      await field(form, 'Place name').setValue('Corrected entrance');
      await field(form, 'Latitude').setValue('1.3'); await field(form, 'Longitude').setValue('103.8');
      api.updateMeetupPlace.mockRejectedValueOnce(Object.assign(new Error(code), { status }));
      await form.trigger('submit'); await flushPromises();
      expect(wrapper.find('#meetup-availability').exists()).toBe(true);
      expect(field(form, 'Place name').element.value).toBe('Corrected entrance');
      expect(form.find('[role="alert"]').exists()).toBe(true);
    });
  it('discloses partial origin coverage and does not claim transport methods affected straight-line ranking', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [publicPlace], suggestions: [{ ...suggestion, locationRespondents: 1,
      distanceCoverageComparable: false, basis: 'insufficient_journey_data' }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(wrapper.get('.meetup-recommendations').text()).toContain('1 of 2 available participants');
    expect(wrapper.get('.meetup-recommendations').text()).toContain('not used to rank');
    expect(wrapper.get('.meetup-recommendations').text()).toContain('Transport choices do not affect straight-line estimates');
  });
  it('lets the owner correct a planning suggestion and discloses that existing votes are cleared', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [{ ...publicPlace, votes: 2, canEdit: true, canRemove: true }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await button(wrapper, 'Correct place').trigger('click');
    const form = wrapper.get('.meetup-place-editor');
    expect(field(form, 'Place name').element.value).toBe(publicPlace.label);
    expect(button(form, 'Save place correction').element.disabled).toBe(true);
    expect(form.text()).toContain('Existing votes for this place will be cleared');
    await field(form, 'Place name').setValue('Corrected public lobby');
    await field(form, 'Latitude').setValue('1.294'); await field(form, 'Longitude').setValue('103.853');
    await form.trigger('submit'); await flushPromises();
    expect(api.updateMeetupPlace).toHaveBeenCalledExactlyOnceWith('meetup-1', 'place-1', expect.objectContaining({
      label: 'Corrected public lobby', latitude: 1.294, longitude: 103.853, version: 1,
    }));
    expect(api.proposeMeetupPlace).not.toHaveBeenCalled();
    expect(field(form, 'Place name').element.value).toBe('');
  });
  it('lets the owner rename a saved suggestion without re-entering its established coordinates', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [{ ...publicPlace, votes: 2, canEdit: true }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await button(wrapper, 'Correct place').trigger('click');
    const form = wrapper.get('.meetup-place-editor');
    expect(form.text()).toContain('Renaming keeps the saved coordinates.');
    await field(form, 'Place name').setValue('City Hall north entrance');
    expect(field(form, 'Latitude').element.value).toBe(String(publicPlace.latitude));
    expect(field(form, 'Longitude').element.value).toBe(String(publicPlace.longitude));
    await form.trigger('submit'); await flushPromises();
    expect(api.updateMeetupPlace).toHaveBeenCalledExactlyOnceWith('meetup-1', 'place-1', expect.objectContaining({
      label: 'City Hall north entrance', latitude: publicPlace.latitude, longitude: publicPlace.longitude, version: 1,
    }));
  });
  it('requires confirmation before removing an owned suggestion and preserves it after a failed removal', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [{ ...publicPlace, canEdit: true, canRemove: true }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await button(wrapper, 'Remove place').trigger('click'); await flushPromises();
    expect(api.removeMeetupPlace).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Votes for this place will also be removed');
    api.removeMeetupPlace.mockRejectedValueOnce(new Error('stale_meetup_version'));
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.removeMeetupPlace).toHaveBeenCalledExactlyOnceWith('meetup-1', 'place-1', 1);
    expect(wrapper.get('.meetup-suggested-places').text()).toContain('City Hall MRT');
    expect(wrapper.get('.meetup-place-editor').text()).toContain('This plan has changed');
  });
});

describe('teammate proposal recovery and explicit approval', () => {
  it('confirms a sole-organizer choice deliberately and records the returned approval without another request', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), requiredApprovers: ['user-1'], places: [publicPlace], suggestions: [suggestion] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await wrapper.get('#meetup-tab-places').trigger('click');
    expect(wrapper.text()).toContain('Confirming fixes the time and place.');
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    api.proposeMeetupPlan.mockResolvedValueOnce({ proposal: { version: 2, confirmed: true } });
    api.meetup.mockResolvedValue({ meetup: { ...board(), status: 'confirmed', version: 2, requiredApprovers: ['user-1'], approvals: ['user-1'], hasApproved: true,
      places: [publicPlace], selected_place_id: 'place-1', selected_start: start, capabilities: permissions('confirmed') } });
    await button(wrapper, 'Confirm this time & place').trigger('click'); await flushPromises();
    expect(api.proposeMeetupPlan).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]').textContent).toContain('immediately confirms');
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.proposeMeetupPlan).toHaveBeenCalledExactlyOnceWith('meetup-1', { placeId: 'place-1', startsAt: new Date(start).toISOString(), version: 1 });
    expect(api.approveMeetup).not.toHaveBeenCalled();
    expect(wrapper.get('#meetup-review').isVisible()).toBe(true);
    expect(wrapper.get('.meetup-approval-progress').text()).toContain('Approvals: 1/1');
    expect(wrapper.text()).toContain('Your organizer approval has been recorded.');
    expect(wrapper.findAll('button').some(item => item.text() === 'Approve plan')).toBe(false);
  });

  it.each(['proposed', 'confirmed'])('exposes recovery from %s editing stages while keeping changed contributions locked', async status => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), status, requiredApprovers: ['user-1', 'user-2'], places: [publicPlace],
      selected_place_id: 'place-1', selected_start: start, capabilities: permissions(status) } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await wrapper.get('#meetup-tab-places').trigger('click');
    const recovery = wrapper.get('[aria-label="Planning is locked"]');
    const reopen = recovery.findAll('button').find(control => /reopen planning/i.test(control.text()));
    expect(reopen.isVisible()).toBe(true);
    expect(wrapper.get('.meetup-place-editor fieldset').element.disabled).toBe(true);
    expect(wrapper.find('.meetup-plan-options').exists()).toBe(false);
    expect(button(wrapper, 'Cancel meetup').isVisible()).toBe(false);
    await reopen.trigger('click'); await flushPromises();
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Availability, places, votes and discussion are kept.');
    expect(api.reopenMeetup).not.toHaveBeenCalled();
  });

  it('separates cancellation from planning and requires confirmation at the end of Review', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), places: [publicPlace], currentVotePlaceId: 'place-1' } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(wrapper.find('nav .btn--danger').exists()).toBe(false);
    await wrapper.get('#meetup-tab-review').trigger('click');
    const management = wrapper.get('#meetup-review > .meetup-management');
    expect(management.text()).toContain('Manage this meetup');
    await button(wrapper, 'Cancel meetup').trigger('click'); await flushPromises();
    expect(api.cancelMeetup).not.toHaveBeenCalled();
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(api.cancelMeetup).toHaveBeenCalledExactlyOnceWith('meetup-1', 1);
  });

  it('shows an already-saved approval and waits for the other organizer without exposing IDs', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), status: 'proposed', hasApproved: true, requiredApprovers: ['user-1', 'private-other-id'], approvals: ['user-1'],
      selected_place_id: 'place-1', selected_start: start, places: [publicPlace], capabilities: { ...permissions('proposed'), canApprove: false } } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    expect(wrapper.get('.meetup-approval-progress').text()).toContain('Your approval is saved. Waiting for the other required organizer.');
    expect(wrapper.text()).not.toContain('private-other-id');
    expect(wrapper.findAll('button').some(item => item.text() === 'Approve plan')).toBe(false);
    expect(api.approveMeetup).not.toHaveBeenCalled();
  });

  it('reports a confirmed proposal even when its follow-up refresh fails', async () => {
    api.meetup.mockResolvedValue({ meetup: { ...board(), requiredApprovers: ['user-1'], places: [publicPlace], suggestions: [suggestion] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    api.proposeMeetupPlan.mockResolvedValueOnce({ proposal: { confirmed: true, version: 2 } });
    api.meetup.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Confirm this time & place').trigger('click'); await flushPromises();
    document.querySelector('.confirm__actions button:last-child').click(); await flushPromises();
    expect(wrapper.text()).toContain('The meetup is confirmed. Your organizer approval has been recorded.');
    expect(wrapper.text()).toContain('Your change was saved. Group details could not refresh');
    expect(api.proposeMeetupPlan).toHaveBeenCalledTimes(1);
    expect(api.approveMeetup).not.toHaveBeenCalled();
  });

  it.each(['groups', 'manage-group'])('preserves the %s origin when creating and switching planner stages', async from => {
    const { wrapper, router } = await mountPage(MeetupView, { path: `/meetups?partyId=party-1&from=${from}` });
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(router.currentRoute.value.query.from).toBe(from);
    expect(router.currentRoute.value.path).toBe('/meetups/new-meetup');
  });
});

describe('meetup creation concert-date guardrails', () => {
  const creationPath = '/meetups?partyId=party-1';
  const creationForm = wrapper => wrapper.get('form');
  it('uses authorized concert context and Singapore defaults, bounds and explicit UTC payloads', async () => {
    const { wrapper, router } = await mountPage(MeetupView, { path: creationPath });
    expect(api.meetupContext).toHaveBeenCalledExactlyOnceWith({ partyId: 'party-1' });
    const inputs = wrapper.findAll('input[type="datetime-local"]'), policy = meetupDatePolicy(concert);
    expect(inputs[0].element.value).toBe(singaporeInputValue(policy.defaultStartsAt));
    expect(inputs[1].element.value).toBe(singaporeInputValue(policy.defaultEndsAt));
    expect(inputs[0].attributes('min')).toBe(singaporeInputValue(policy.minimumStartsAt));
    expect(inputs[1].attributes('max')).toBe(singaporeInputValue(policy.maximumEndsAt));
    expect(wrapper.text()).toContain('Verified concert start:');
    expect(wrapper.text()).toContain('Test artist · 2030-01-01');
    await inputs[0].setValue('2030-01-01T16:00');
    await inputs[1].setValue('2030-01-01T18:00');
    await creationForm(wrapper).trigger('submit'); await flushPromises();
    expect(api.createMeetup).toHaveBeenCalledExactlyOnceWith({ title: 'Meet before the concert', partyId: 'party-1',
      creationRequestId: expect.any(String),
      startsAt: '2030-01-01T08:00:00.000Z', endsAt: '2030-01-01T10:00:00.000Z' });
    expect(router.currentRoute.value.path).toBe('/meetups/new-meetup');
  });

  it.each([
    ['2030-01-01T18:00', '2030-01-01T17:00', 'end after it starts'],
    ['2030-01-01T16:15', '2030-01-01T17:00', 'hour or half-hour'],
    ['2030-01-01T19:00', '2030-01-01T20:00', 'before the verified concert start'],
    ['2030-01-02T10:00', '2030-01-02T11:00', 'before the verified concert start'],
    ['2029-12-30T10:00', '2029-12-30T11:00', 'concert day or the preceding travel day'],
    ['2020-01-01T10:00', '2020-01-01T11:00', 'future meeting time'],
    ['', '2030-01-01T17:00', 'real calendar date and time'],
  ])('blocks invalid %s → %s inline before sending a request', async (startsAt, endsAt, expected) => {
    const { wrapper } = await mountPage(MeetupView, { path: creationPath });
    const inputs = wrapper.findAll('input[type="datetime-local"]');
    await inputs[0].setValue(startsAt); await inputs[1].setValue(endsAt);
    await creationForm(wrapper).trigger('submit'); await flushPromises();
    expect(wrapper.get('#meetup-creation-validation[role="alert"]').text()).toContain(expected);
    expect(inputs[0].attributes('aria-invalid')).toBe('true');
    expect(button(wrapper, 'Create planning board').element.disabled).toBe(true);
    expect(api.createMeetup).not.toHaveBeenCalled();
  });

  it('explains an unknown performance time honestly and still limits dates to the relevant concert days', async () => {
    const unknown = { ...concert, event_time: null };
    api.meetupContext.mockResolvedValue({ context: { concert: unknown, policy: meetupDatePolicy(unknown), capabilities: { canCreate: true } } });
    const { wrapper } = await mountPage(MeetupView, { path: creationPath });
    expect(wrapper.text()).toContain('performance start time is unavailable; check that your chosen time is before the performance');
    expect(wrapper.text()).not.toContain('Verified concert start:');
    const inputs = wrapper.findAll('input[type="datetime-local"]');
    await inputs[0].setValue('2030-01-02T09:00'); await inputs[1].setValue('2030-01-02T10:00');
    expect(wrapper.get('#meetup-creation-validation').text()).toContain('concert day or the preceding travel day');
    expect(api.createMeetup).not.toHaveBeenCalled();
  });

  it('shows member guidance instead of a creation form when the authorized scope denies creation', async () => {
    api.meetupContext.mockResolvedValue({ context: { concert, policy: meetupDatePolicy(concert), capabilities: { canCreate: false } } });
    const { wrapper } = await mountPage(MeetupView, { path: creationPath });
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.text()).toContain('Your group host creates the planning board.');
    expect(api.createMeetup).not.toHaveBeenCalled();
  });

  it('keeps a valid creation draft and shows a recognized backend validation failure beside the form', async () => {
    const { wrapper } = await mountPage(MeetupView, { path: creationPath });
    api.createMeetup.mockRejectedValueOnce(new Error('meetup_must_be_future'));
    const initial = wrapper.findAll('input[type="datetime-local"]').map(input => input.element.value);
    await creationForm(wrapper).trigger('submit'); await flushPromises();
    expect(creationForm(wrapper).get('.group-error[role="alert"]').text()).toBe('Choose a future meeting time.');
    expect(wrapper.findAll('input[type="datetime-local"]').map(input => input.element.value)).toEqual(initial);
    expect(wrapper.text()).not.toContain('Could not update this meetup.');
  });

  it('resumes an active scoped board and requires an explicit choice before creating another', async () => {
    const summary = { id: 'existing', title: 'Existing plan', status: 'planning', scope: { partyId: 'party-1' },
      concert, hasAvailability: false, participantCount: 2, availabilityParticipantCount: 1, isHistorical: false };
    api.meetupContext.mockResolvedValue({ context: { concert, policy: meetupDatePolicy(concert), capabilities: { canCreate: true }, meetups: [summary] } });
    const { wrapper } = await mountPage(MeetupView, { path: creationPath });
    expect(api.meetups).not.toHaveBeenCalled();
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.get('.meetup-overview-plan a').attributes('href')).toContain('/meetups/existing?from=conversation');
    await button(wrapper, 'Create a separate plan').trigger('click');
    expect(wrapper.get('form').text()).toContain('won’t change your existing plan');
    api.createMeetup.mockRejectedValueOnce(new Error('network_failure'));
    await wrapper.get('form').trigger('submit'); await flushPromises();
    const firstPayload = api.createMeetup.mock.calls[0][0];
    expect(firstPayload).toMatchObject({ createAnother: true, creationRequestId: expect.any(String) });
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.createMeetup.mock.calls[1][0].creationRequestId).toBe(firstPayload.creationRequestId);
  });

  it('keeps stage URLs and drafts synchronized without loading the board again', async () => {
    const { wrapper, router } = await mountPage(MeetupView, { path: '/meetups/meetup-1?from=overview', props: { id: 'meetup-1' } });
    expect(wrapper.get('.back-link').attributes('href')).toBe('/meetups');
    await wrapper.get('[data-availability-start]').trigger('click');
    expect(wrapper.text()).toContain('Unsaved changes');
    await wrapper.get('[data-planner-step="places"]').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.hash).toBe('#meetup-places');
    expect(router.currentRoute.value.query.from).toBe('overview');
    expect(api.meetup).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Unsaved changes');
  });
});

describe('planner draft, selection and persistence hardening', () => {
  const view = () => mountPage(MeetupView, { path: '/meetups/meetup-1', props: { id: 'meetup-1' } });
  const answerLeave = async discard => {
    const actions = document.querySelectorAll('.confirm__actions button');
    actions[discard ? 1 : 0].click(); await flushPromises();
  };
  it('opens a known created board without another POST when a route guard initially cancels navigation', async () => {
    const { wrapper, router } = await mountPage(MeetupView, { path: '/meetups?partyId=party-1' });
    const stop = router.beforeEach(to => to.path !== '/meetups/new-meetup');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(button(wrapper, 'Open created plan').exists()).toBe(true);
    expect(wrapper.text()).toContain('Your plan was created.');
    await field(wrapper, 'Title').setValue('Unsent field edit');
    stop();
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.createMeetup).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe('/meetups/new-meetup');
  });
  it.each(['availability', 'place', 'discussion', 'journey'])('warns before leaving a meaningful %s draft and keeps it on cancellation', async kind => {
    const { wrapper, router } = await view();
    if (kind === 'availability') await wrapper.get('[data-availability-start]').trigger('click');
    if (kind === 'place') await field(wrapper, 'Place name').setValue('Unsaved public place');
    if (kind === 'discussion') await wrapper.get('textarea').setValue('Unsaved discussion');
    if (kind === 'journey') await field(wrapper, 'Travel method').setValue('drive');
    const navigation = router.push('/messages'); await flushPromises();
    expect(document.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Leave with unsaved changes?');
    expect(document.activeElement.textContent.trim()).toBe('Keep editing');
    expect(router.currentRoute.value.path).toBe('/meetups/meetup-1');
    await answerLeave(false); await navigation;
    expect(router.currentRoute.value.path).toBe('/meetups/meetup-1');
    const secondNavigation = router.push('/meetups/another-board'); await flushPromises();
    await answerLeave(true); await secondNavigation;
    expect(router.currentRoute.value.path).toBe('/meetups/another-board');
  });
  it('warns on reload only while dirty, lets stages preserve drafts and removes guards on unmount', async () => {
    const { wrapper, router } = await view();
    let event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    await wrapper.get('[data-availability-start]').trigger('click');
    event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    await button(wrapper, 'Next: suggest places →').trigger('click'); await flushPromises();
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    expect(router.currentRoute.value.hash).toBe('#meetup-places');
    expect(wrapper.get('#meetup-places').text()).toContain('Recommendations use saved availability');
    expect(api.meetupAvailability).not.toHaveBeenCalled();
    wrapper.unmount();
    event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    await router.push('/messages'); expect(router.currentRoute.value.path).toBe('/messages');
  });
  it('does not warn for search text that cannot lose a saved contribution', async () => {
    const { wrapper, router } = await view();
    const search = wrapper.findAllComponents(MeetupLocationSearch)[0];
    await search.get('input').setValue('Only a search query');
    await router.push('/messages');
    expect(document.querySelector('[role="dialog"]')).toBe(null);
  });
  it('retains an unapplied Car-to-public-transport change after applying and saving Car', async () => {
    const { wrapper, router } = await view();
    await field(wrapper, 'Travel method').setValue('drive');
    await button(wrapper, 'Apply to selected times').trigger('click');
    api.meetup.mockResolvedValue({ meetup: { ...board(), availability: [{ ...board().availability[0], travel_mode: 'drive' }] } });
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    await field(wrapper, 'Travel method').setValue('transit');
    expect(wrapper.get('.meetup-journey').text()).toContain('Not applied yet');
    const navigation = router.push('/meetups'); await flushPromises();
    await answerLeave(false); await navigation;
    expect(router.currentRoute.value.path).toBe('/meetups/meetup-1');
  });
  it('clears stale lookup fields on query edits and name edits while preserving applied slots and manual overrides', async () => {
    api.meetupLocations.mockResolvedValue({ result: { status: 'available', locations: [{ label: 'Selected A', latitude: 1.31, longitude: 103.86 }] } });
    const { wrapper } = await view();
    const search = wrapper.findAllComponents(MeetupLocationSearch)[0];
    await search.get('input').setValue('Query A'); await button(search, 'Search OneMap').trigger('click'); await flushPromises();
    await search.get('.meetup-search-result').trigger('click');
    await button(wrapper, 'Apply to selected times').trigger('click');
    await search.get('input').setValue('Query B');
    expect(field(wrapper, 'Location label').element.value).toBe('');
    expect(field(wrapper, 'Latitude').element.value).toBe('');
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(api.meetupAvailability).toHaveBeenLastCalledWith('meetup-1', [expect.objectContaining({ label: 'Selected A', latitude: 1.31, longitude: 103.86 })], 1);
    const placeSearch = wrapper.findAllComponents(MeetupLocationSearch)[1];
    await placeSearch.get('input').setValue('Query A'); await button(placeSearch, 'Search OneMap').trigger('click'); await flushPromises();
    await placeSearch.get('.meetup-search-result').trigger('click');
    await field(wrapper, 'Place name').setValue('A different manual name');
    expect(placeSearch.text()).not.toContain('Selected: Selected A.');
    const form = wrapper.get('.meetup-place-editor');
    expect(field(form, 'Latitude').element.value).toBe('');
    await form.trigger('submit'); expect(api.proposeMeetupPlace).not.toHaveBeenCalled();
    await field(form, 'Latitude').setValue('1.32'); await field(form, 'Longitude').setValue('103.87');
    await placeSearch.get('input').setValue('Only query C');
    expect(field(form, 'Latitude').element.value).toBe('1.32');
    await form.trigger('submit'); await flushPromises();
    expect(api.proposeMeetupPlace).toHaveBeenCalledWith('meetup-1', expect.objectContaining({ label: 'A different manual name', latitude: 1.32, longitude: 103.87 }));
  });
  it('reports a committed availability save as saved even if the follow-up read fails', async () => {
    const { wrapper } = await view();
    await wrapper.get('[data-availability-start]').trigger('click');
    api.meetup.mockRejectedValueOnce(new Error('temporary_read_failure'));
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Your saved response has been cleared.');
    expect(wrapper.text()).toContain('Group details could not refresh');
    expect(wrapper.text()).not.toContain('Unsaved changes');
    expect(wrapper.find('#meetup-availability > [role="alert"]').exists()).toBe(false);
  });
  it('clears old success when editing again and preserves a failed save draft', async () => {
    const { wrapper } = await view();
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Your availability has been saved.');
    await wrapper.get('[data-availability-start]').trigger('click');
    expect(wrapper.text()).not.toContain('Your availability has been saved.');
    api.meetupAvailability.mockRejectedValueOnce(new Error('network_failure'));
    await button(wrapper, 'Save my times').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Availability was not saved. Your draft is kept.');
    expect(wrapper.get('[data-availability-start]').attributes('aria-pressed')).toBe('false');
  });
  it('does not let a late creation response navigate away from the newer scope', async () => {
    let finish;
    api.createMeetup.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { wrapper, router } = await mountPage(MeetupView, { path: '/meetups?partyId=party-1' });
    await wrapper.get('form').trigger('submit');
    await router.push('/meetups?partyId=party-2'); await flushPromises();
    finish({ meetup: { id: 'late-created-board' } }); await flushPromises();
    expect(router.currentRoute.value.query.partyId).toBe('party-2');
    expect(router.currentRoute.value.path).toBe('/meetups');
  });
  it('replays the original uncertain creation payload despite edits or malformed success', async () => {
    api.createMeetup.mockResolvedValueOnce({});
    const { wrapper, router } = await mountPage(MeetupView, { path: '/meetups?partyId=party-1' });
    await wrapper.get('form').trigger('submit'); await flushPromises();
    const original = api.createMeetup.mock.calls[0][0];
    expect(button(wrapper, 'Check previous attempt').exists()).toBe(true);
    await field(wrapper, 'Title').setValue('Edited but not a new attempt');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.createMeetup.mock.calls[1][0]).toEqual(original);
    expect(router.currentRoute.value.path).toBe('/meetups/new-meetup');
  });
});
