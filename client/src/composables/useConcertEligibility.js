import { computed, onMounted, onUnmounted, ref } from 'vue';
import { concertGroupCreationEligibility, concertParticipationEligibility } from '../../../shared/concertEligibility.mjs';
import { meetupDatePolicy } from '../../../shared/meetupDates.mjs';

// A minute/focus refresh keeps an open page honest across midnight. Every write
// still rechecks the authoritative stored concert on the server.
export function useConcertEligibility(source) {
  const now = ref(Date.now());
  const refreshEligibility = () => { now.value = Date.now(); };
  const concert = computed(() => {
    const value = source();
    return { ...value, event_date: value?.event_date ?? value?.eventDate,
      event_time: value?.event_time ?? value?.eventTime,
      event_timezone: value?.event_timezone ?? value?.eventTimezone };
  });
  const eligibility = computed(() => concertParticipationEligibility(concert.value, now.value));
  const canCoordinate = computed(() => eligibility.value.eligible);
  const isFinished = computed(() => eligibility.value.reason === 'concert_finished');
  const canCreateGroup = computed(() => concertGroupCreationEligibility(concert.value, now.value).eligible);
  const canPlanMeetup = computed(() => meetupDatePolicy(concert.value, now.value).canSchedule);
  let timer;
  onMounted(() => { timer = setInterval(refreshEligibility, 60000); window.addEventListener('focus', refreshEligibility); });
  onUnmounted(() => { clearInterval(timer); window.removeEventListener('focus', refreshEligibility); });
  return { canCoordinate, isFinished, canCreateGroup, canPlanMeetup, eligibility, refreshEligibility };
}
