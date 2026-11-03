import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MeetupCreationForm from '../../client/src/components/MeetupCreationForm.vue';
import MeetupDiscussionPanel from '../../client/src/components/MeetupDiscussionPanel.vue';
import { meetupDatePolicy } from '../../shared/meetupDates.mjs';
import { button, field } from './helpers.js';

const concert = { id: 'concert-1', event_date: '2030-01-01', event_time: '20:00:00', event_timezone: 'Asia/Singapore', artist: 'Test artist', venue: 'Stadium' };
const context = (event = concert) => ({ concert: event, policy: meetupDatePolicy(event), capabilities: { canCreate: true } });

describe('extracted meetup creation form', () => {
  it('retains an edited draft across a refreshed context for the same concert and resets on a new concert', async () => {
    const wrapper = mount(MeetupCreationForm, { props: { context: context() } });
    await field(wrapper, 'Title').setValue('Our edited meetup');
    await wrapper.findAll('input[type="datetime-local"]')[0].setValue('2030-01-01T15:00');
    await wrapper.setProps({ context: { ...context(), concert: { ...concert, artist: 'Refreshed artist' } } });
    expect(field(wrapper, 'Title').element.value).toBe('Our edited meetup');
    expect(wrapper.findAll('input[type="datetime-local"]')[0].element.value).toBe('2030-01-01T15:00');
    const nextConcert = { ...concert, id: 'concert-2', event_date: '2030-02-01' };
    await wrapper.setProps({ context: context(nextConcert) });
    expect(field(wrapper, 'Title').element.value).toBe('Meet before the concert');
    expect(wrapper.findAll('input[type="datetime-local"]')[0].element.value).toMatch(/^2030-02-01T/);
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('emits validated ISO values for the coordinator without storing scope or calling an API', async () => {
    const wrapper = mount(MeetupCreationForm, { props: { context: context() } });
    const inputs = wrapper.findAll('input[type="datetime-local"]');
    await inputs[0].setValue('2030-01-01T16:00'); await inputs[1].setValue('2030-01-01T18:00');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toEqual([[{ title: 'Meet before the concert', creationRequestId: expect.any(String), startsAt: '2030-01-01T08:00:00.000Z', endsAt: '2030-01-01T10:00:00.000Z' }, expect.any(Function)]]);
    await wrapper.setProps({ busy: true });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toHaveLength(1);
    expect(button(wrapper, 'Creating planning board…').element.disabled).toBe(true);
  });

  it('preserves its creation draft and shows coordinator failures separately from local date validation', async () => {
    const wrapper = mount(MeetupCreationForm, { props: { context: context(), error: 'Only the group host can create this planner.' } });
    await field(wrapper, 'Title').setValue('Keep this title');
    expect(wrapper.get('.group-error[role="alert"]').text()).toContain('Only the group host');
    const inputs = wrapper.findAll('input[type="datetime-local"]');
    await inputs[1].setValue('2030-01-01T20:00');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('#meetup-creation-validation').text()).toContain('before the verified concert start');
    expect(field(wrapper, 'Title').element.value).toBe('Keep this title');
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('reuses an identical rejected submission and treats whitespace-only title edits like the server', async () => {
    const wrapper = mount(MeetupCreationForm, { props: { context: context() } });
    await wrapper.get('form').trigger('submit');
    const [first, settle] = wrapper.emitted('submit')[0];
    settle('rejected');
    await field(wrapper, 'Title').setValue('  Meet before the concert  ');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')[1][0]).toEqual(first);
    expect(wrapper.get('form').attributes('aria-busy')).toBe('true');
  });

  it.each(['title', 'window', 'separate plan'])('uses a new identity for an edited %s only after definite rejection', async change => {
    const wrapper = mount(MeetupCreationForm, { props: { context: context() } });
    await wrapper.get('form').trigger('submit');
    const [first, settle] = wrapper.emitted('submit')[0];
    if (change === 'title') await field(wrapper, 'Title').setValue('Pre-show dinner');
    else if (change === 'window') await wrapper.findAll('input[type="datetime-local"]')[0].setValue('2030-01-01T15:00');
    else await wrapper.setProps({ additionalPlan: true });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toHaveLength(1);
    expect(wrapper.get('button[type="submit"]').element.disabled).toBe(true);
    settle('rejected');
    await wrapper.vm.$nextTick();
    await wrapper.get('form').trigger('submit');
    const next = wrapper.emitted('submit')[1][0];
    expect(next.creationRequestId).not.toBe(first.creationRequestId);
    if (change === 'title') expect(next.title).toBe('Pre-show dinner');
    else if (change === 'window') expect(next.startsAt).toBe('2030-01-01T07:00:00.000Z');
    else expect(next.createAnother).toBe(true);
    // A duplicated settlement from the first request cannot unlock this one.
    settle('rejected');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toHaveLength(2);
  });

  it('replays the original additional-plan payload after a lost response instead of silently creating the edited plan', async () => {
    const wrapper = mount(MeetupCreationForm, { props: { context: context(), additionalPlan: true } });
    await wrapper.get('form').trigger('submit');
    const [first, settle] = wrapper.emitted('submit')[0];
    settle('uncertain');
    await field(wrapper, 'Title').setValue('A different intended meal');
    await wrapper.findAll('input[type="datetime-local"]')[0].setValue('2030-01-01T15:00');
    expect(button(wrapper, 'Check previous attempt').attributes('formnovalidate')).toBeDefined();
    expect(wrapper.get('#meetup-creation-attempt').text()).toContain('current field edits are not sent');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')[1][0]).toEqual(first);
    expect(first.createAnother).toBe(true);
    expect(field(wrapper, 'Title').element.value).toBe('A different intended meal');
    // A later rejected retry does not resolve the earlier ambiguous response.
    wrapper.emitted('submit')[1][1]('rejected');
    await wrapper.vm.$nextTick();
    expect(button(wrapper, 'Check previous attempt').element.disabled).toBe(false);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')[2][0]).toEqual(first);
  });

  it('can check an uncertain valid submission even when current edits are invalid', async () => {
    const wrapper = mount(MeetupCreationForm, { props: { context: context() } });
    await wrapper.get('form').trigger('submit');
    const [first, settle] = wrapper.emitted('submit')[0];
    settle('uncertain');
    await field(wrapper, 'Title').setValue('');
    await wrapper.findAll('input[type="datetime-local"]')[1].setValue('2030-01-01T20:00');
    expect(wrapper.get('#meetup-creation-validation').attributes('role')).toBe('alert');
    expect(button(wrapper, 'Check previous attempt').element.disabled).toBe(false);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')[1][0]).toEqual(first);
  });

  it('opens a known-created plan with its original identity if navigation failed, even after edits or another failed retry', async () => {
    const wrapper = mount(MeetupCreationForm, { props: { context: context(), additionalPlan: true } });
    await wrapper.get('form').trigger('submit');
    const [first, settle] = wrapper.emitted('submit')[0];
    settle('created');
    await field(wrapper, 'Title').setValue('Changed after creation');
    expect(wrapper.get('#meetup-creation-attempt').text()).toContain('Your planning board was created');
    expect(button(wrapper, 'Open created plan').element.disabled).toBe(false);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')[1][0]).toEqual(first);
    wrapper.emitted('submit')[1][1]('uncertain');
    await wrapper.vm.$nextTick();
    expect(button(wrapper, 'Open created plan').element.disabled).toBe(false);
  });

  it('keeps the same identity after repeated submissions in one tick and ignores settlements from a previous concert', async () => {
    const wrapper = mount(MeetupCreationForm, { props: { context: context() } });
    wrapper.get('form').element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    wrapper.get('form').element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(wrapper.emitted('submit')).toHaveLength(1);
    const [first, settle] = wrapper.emitted('submit')[0];
    await wrapper.setProps({ context: context({ ...concert, id: 'concert-2', event_date: '2030-02-01' }) });
    await wrapper.get('form').trigger('submit');
    const next = wrapper.emitted('submit')[1][0];
    expect(next.creationRequestId).not.toBe(first.creationRequestId);
    expect(next.startsAt).toMatch(/^2030-02-01T/);
    settle('rejected');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toHaveLength(2);
  });
});

describe('extracted meetup discussion panel', () => {
  it('displays UTC discussion timestamps in Singapore time and forwards the draft without interpreting it as a plan revision', async () => {
    const wrapper = mount(MeetupDiscussionPanel, { props: { canDiscuss: true, modelValue: 'Can we meet under shelter?',
      comments: [{ id: 'comment-1', name: 'Sam', body: 'Earlier suggestion', createdAt: '2030-01-01 04:00:00' }] } });
    const timestamp = wrapper.get('time');
    expect(Date.parse(timestamp.attributes('datetime'))).toBe(Date.parse('2030-01-01T04:00:00Z'));
    expect(timestamp.text()).toContain('12:00');
    expect(wrapper.text()).toContain("Messages don't change the confirmed plan.");
    await wrapper.get('textarea').setValue('My edited request');
    expect(wrapper.emitted('update:modelValue')).toEqual([['My edited request']]);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toEqual([[]]);
  });

  it('uses role-specific guards and renders local feedback without clearing the parent-owned draft', async () => {
    const wrapper = mount(MeetupDiscussionPanel, { props: { canDiscuss: false, modelValue: 'Keep my draft', error: 'This meetup has been cancelled.' } });
    expect(wrapper.get('textarea').element.disabled).toBe(true);
    expect(button(wrapper, 'Post').element.disabled).toBe(true);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toBe('This meetup has been cancelled.');
    expect(wrapper.get('textarea').element.value).toBe('Keep my draft');
    await wrapper.setProps({ canDiscuss: true, error: '', notice: 'Your message was posted.', modelValue: '' });
    expect(wrapper.get('[role="status"]').text()).toBe('Your message was posted.');
    expect(wrapper.text()).toContain('No discussion yet.');
    expect(button(wrapper, 'Post').element.disabled).toBe(true);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
