import { describe, expect, it } from 'vitest';
import {
  MEETUP_SLOT_MS, MEETUP_TIMEZONE, formatMeetupClock, formatMeetupDateTime, formatMeetupDay,
  formatMeetupObservationTime, parseSingaporeInput, singaporeDayKey, singaporeInputValue,
  utcDiscussionTimestamp, validateMeetupWindow,
} from '../src/utils/meetupTime.js';

const concert = { event_date: '2030-01-01', event_time: '20:00:00', event_timezone: 'Asia/Singapore' };
const now = Date.parse('2029-12-01T00:00:00Z');

describe('shared meetup date and time utilities', () => {
  it('keeps Singapore day columns and clocks correct across midnight independently of the machine timezone', () => {
    const before = Date.parse('2029-12-31T15:30:00Z'), after = before + MEETUP_SLOT_MS;
    expect(MEETUP_TIMEZONE).toBe('Asia/Singapore');
    expect(singaporeDayKey(before)).toBe('2029-12-31');
    expect(singaporeDayKey(after)).toBe('2030-01-01');
    expect(formatMeetupClock(before)).toBe('23:30');
    expect(formatMeetupClock(after)).toBe('00:00');
    expect(formatMeetupDay(after)).toBe(new Intl.DateTimeFormat('en-SG', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Singapore',
    }).format(after));
  });

  it('retains the existing full date/time presentation and explicit datetime-local offset conversion', () => {
    const epoch = Date.parse('2029-12-31T16:00:00Z');
    expect(formatMeetupDateTime(epoch)).toBe(new Date(epoch).toLocaleString('en-SG', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore',
    }));
    expect(singaporeInputValue(epoch)).toBe('2030-01-01T00:00');
    expect(parseSingaporeInput('2030-01-01T00:00')).toBe(epoch);
    expect(singaporeInputValue(null)).toBe('');
  });

  it.each(['2030-02-30T16:00', '2030-13-01T16:00', '2030-01-01T24:00', 'not a date', ''])('rejects malformed or impossible local input %s without calendar rollover', value => {
    expect(Number.isNaN(parseSingaporeInput(value))).toBe(true);
    expect(validateMeetupWindow(`${value}+08:00`, '2030-01-01T18:00+08:00', concert, now).error).toBe('invalid_meetup_datetime');
  });

  it('shares half-hour and concert-window rules while accepting a valid window spanning Singapore midnight', () => {
    expect(validateMeetupWindow('2029-12-31T23:30+08:00', '2030-01-01T00:30+08:00', concert, now).error).toBe(null);
    expect(validateMeetupWindow('2030-01-01T16:15+08:00', '2030-01-01T17:00+08:00', concert, now).error).toBe('meetup_half_hour_required');
    expect(validateMeetupWindow('2030-01-01T19:00+08:00', '2030-01-01T20:00+08:00', concert, now).error).toBe('meetup_must_end_before_concert');
  });

  it('normalizes SQLite discussion times as UTC while preserving explicit UTC and offset timestamps', () => {
    expect(utcDiscussionTimestamp('2030-01-01 04:00:00')).toBe('2030-01-01T04:00:00Z');
    expect(utcDiscussionTimestamp('2030-01-01T04:00:00Z')).toBe('2030-01-01T04:00:00Z');
    expect(utcDiscussionTimestamp('2030-01-01T12:00:00+08:00')).toBe('2030-01-01T12:00:00+08:00');
  });

  it('preserves honest transport missing-time states and the exact Singapore observation formatter', () => {
    for (const value of [null, undefined, '', 'not a date']) expect(formatMeetupObservationTime(value)).toBe('Time not reported');
    const observed = '2030-01-01T09:50:00Z';
    expect(formatMeetupObservationTime(observed)).toBe(new Date(observed).toLocaleString('en-SG', {
      timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }));
  });
});
