import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import MeetupLocationSearch from '../../client/src/components/MeetupLocationSearch.vue';
import { api } from '../../client/src/api.js';
import { button } from './helpers.js';

vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: { meetupLocations: vi.fn() } }));
const place = { label: 'City Hall MRT', address: '150 North Bridge Road', latitude: 1.293, longitude: 103.852 };
const render = (props = {}) => mount(MeetupLocationSearch, { props: { meetupId: 'meetup-1', ...props }, attachTo: document.body });
async function findPlaces(wrapper, query = 'City Hall') {
  await wrapper.get('input').setValue(query);
  await button(wrapper, 'Search OneMap').trigger('click');
  await flushPromises();
}
beforeEach(() => {
  vi.resetAllMocks();
  api.meetupLocations.mockResolvedValue({ result: { status: 'available', locations: [place] } });
});

describe('meetup address selection feedback', () => {
  it('announces loading and renders visible results before explicitly selecting an unsaved address', async () => {
    let finish;
    api.meetupLocations.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const wrapper = render();
    await wrapper.get('input').setValue('City Hall');
    await button(wrapper, 'Search OneMap').trigger('click');
    expect(wrapper.attributes('aria-busy')).toBe('true');
    expect(wrapper.get('[role="status"]').text()).toContain('Searching OneMap');
    expect(api.meetupLocations).toHaveBeenCalledExactlyOnceWith('meetup-1', 'City Hall');
    expect(wrapper.emitted('selected')).toBeUndefined();
    finish({ result: { status: 'available', locations: [place] } }); await flushPromises();
    expect(wrapper.attributes('aria-busy')).toBe('false');
    expect(wrapper.text()).toContain('1 place found. Select an address below.');
    const result = wrapper.get('.meetup-search-result');
    expect(result.text()).toContain(place.address);
    await result.trigger('click');
    expect(result.attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('Selected: City Hall MRT.');
    expect(wrapper.text()).toContain('Selection is not saved. Apply or save it using the form below.');
    expect(wrapper.emitted('selected')).toEqual([[place]]);
    expect(wrapper.findAll('.meetup-search-result')).toHaveLength(1);
  });

  it('supports keyboard navigation between results and back to the search field', async () => {
    const second = { ...place, label: 'City Hall building', latitude: 1.294 };
    api.meetupLocations.mockResolvedValue({ result: { status: 'available', locations: [place, second] } });
    const wrapper = render();
    await findPlaces(wrapper);
    const input = wrapper.get('input'), choices = wrapper.findAll('.meetup-search-result');
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'));
    input.element.focus();
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(choices[0].element);
    await choices[0].trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(choices[1].element);
    await choices[1].trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(choices[0].element);
    await choices[0].trigger('keydown', { key: 'Escape' });
    expect(document.activeElement).toBe(input.element);
  });

  it.each([
    [{ status: 'available', locations: [] }, 'No places found. Try a building name, MRT station or postal code.'],
    [{ status: 'unavailable', reason: 'onemap_not_configured' }, 'You can still enter a place and its coordinates below.'],
  ])('distinguishes no results from unavailable search without emitting a fabricated location', async (result, message) => {
    api.meetupLocations.mockResolvedValue({ result });
    const wrapper = render(); await findPlaces(wrapper);
    expect(wrapper.get('[role="status"]').text()).toContain(message);
    expect(wrapper.find('.meetup-search-results').exists()).toBe(false);
    expect(wrapper.emitted('selected')).toBeUndefined();
  });

  it('reports a failed request beside the field and preserves the typed query for retry', async () => {
    api.meetupLocations.mockRejectedValueOnce(new Error('network_error'));
    const wrapper = render(); await findPlaces(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain('Manual entry is still available below.');
    expect(wrapper.get('input').element.value).toBe('City Hall');
    await button(wrapper, 'Search OneMap').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('.meetup-search-result').exists()).toBe(true);
  });

  it('marks cached search results honestly and omits malformed or non-Singapore coordinates', async () => {
    api.meetupLocations.mockResolvedValue({ result: { status: 'available', stale: true, locations: [place,
      { ...place, latitude: null }, { ...place, latitude: 0, longitude: 0 }, { ...place, latitude: '1.3' },
    ] } });
    const wrapper = render(); await findPlaces(wrapper);
    expect(wrapper.text()).toContain('Showing a saved address lookup while OneMap is unavailable.');
    expect(wrapper.findAll('.meetup-search-result')).toHaveLength(1);
    expect(wrapper.emitted('selected')).toBeUndefined();
  });

  it('clears the search after a parent reset and ignores outstanding results from the old draft or board', async () => {
    const wrapper = render(); await findPlaces(wrapper);
    await wrapper.get('.meetup-search-result').trigger('click');
    await wrapper.setProps({ resetKey: 1 });
    expect(wrapper.get('input').element.value).toBe('');
    expect(wrapper.find('.meetup-search-results').exists()).toBe(false);
    expect(wrapper.find('.meetup-location-search__selection').exists()).toBe(false);
    let finish;
    api.meetupLocations.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await findPlaces(wrapper);
    await wrapper.setProps({ meetupId: 'meetup-2' });
    finish({ result: { status: 'available', locations: [place] } }); await flushPromises();
    expect(wrapper.find('.meetup-search-results').exists()).toBe(false);
    expect(wrapper.attributes('aria-busy')).toBe('false');
  });

  it('ignores a stale response when the query changes and gates actions when contributions are disabled', async () => {
    let finish;
    api.meetupLocations.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const wrapper = render(); await findPlaces(wrapper);
    await wrapper.get('input').setValue('Stadium');
    finish({ result: { status: 'available', locations: [place] } }); await flushPromises();
    expect(wrapper.find('.meetup-search-results').exists()).toBe(false);
    await wrapper.setProps({ disabled: true });
    expect(wrapper.get('input').element.disabled).toBe(true);
    expect(button(wrapper, 'Search OneMap').element.disabled).toBe(true);
    await wrapper.get('input').trigger('keydown', { key: 'Enter' });
    expect(api.meetupLocations).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('selected')).toBeUndefined();
  });

  it('uses the parent venue workflow guidance without claiming a manual-entry form exists', async () => {
    api.meetupLocations.mockResolvedValue({ result: { status: 'unavailable' } });
    const wrapper = render({ manualFallback: false, selectionHint: 'Press Check nearby transport to use this venue.' });
    await findPlaces(wrapper);
    expect(wrapper.text()).not.toContain('coordinates below');
    expect(wrapper.text()).toContain('use the concert venue already on the plan');
  });

  it('invalidates location A when its query changes and emits matching coordinates only after selecting B', async () => {
    const second = { label: 'Stadium MRT', address: '3 Stadium Walk', latitude: 1.302, longitude: 103.875 };
    const wrapper = render(); await findPlaces(wrapper);
    await wrapper.get('.meetup-search-result').trigger('click');
    await wrapper.get('input').setValue('Stadium');
    expect(wrapper.find('.meetup-location-search__selection').exists()).toBe(false);
    expect(wrapper.findAll('.meetup-search-result')).toHaveLength(0);
    expect(wrapper.text()).toContain('Selection changed. Select a result for the new search');
    expect(wrapper.emitted('selection-invalidated')).toEqual([[{ location: place, reason: 'query' }]]);
    expect(wrapper.emitted('selected')).toEqual([[place]]);
    api.meetupLocations.mockResolvedValueOnce({ result: { status: 'available', locations: [second] } });
    await button(wrapper, 'Search OneMap').trigger('click'); await flushPromises();
    await wrapper.get('.meetup-search-result').trigger('click');
    expect(wrapper.emitted('selected')).toEqual([[place], [second]]);
    expect(wrapper.text()).toContain('Selected: Stadium MRT.');
    expect(wrapper.text()).not.toContain('Selected: City Hall MRT.');
    expect(wrapper.get('.meetup-search-result').attributes('aria-pressed')).toBe('true');
  });

  it('does not restore an invalidated selection when the replacement search fails', async () => {
    const wrapper = render(); await findPlaces(wrapper);
    const oldResult = wrapper.get('.meetup-search-result');
    await oldResult.trigger('click');
    await wrapper.get('input').setValue('Stadium');
    api.meetupLocations.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Search OneMap').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not search places');
    expect(wrapper.find('.meetup-location-search__selection').exists()).toBe(false);
    expect(wrapper.get('input').element.value).toBe('Stadium');
    await oldResult.trigger('click');
    expect(wrapper.emitted('selected')).toHaveLength(1);
    expect(wrapper.emitted('selection-invalidated')).toHaveLength(1);
  });

  it('keeps the newer search pending when an older query finishes out of order', async () => {
    let finishFirst, finishSecond;
    const second = { ...place, label: 'Stadium MRT', latitude: 1.302, longitude: 103.875 };
    api.meetupLocations
      .mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { finishSecond = resolve; }));
    const wrapper = render(); await findPlaces(wrapper);
    await wrapper.get('input').setValue('Stadium');
    await button(wrapper, 'Search OneMap').trigger('click');
    expect(api.meetupLocations.mock.calls).toEqual([['meetup-1', 'City Hall'], ['meetup-1', 'Stadium']]);
    finishFirst({ result: { status: 'available', locations: [place] } }); await flushPromises();
    expect(wrapper.attributes('aria-busy')).toBe('true');
    expect(wrapper.findAll('.meetup-search-result')).toHaveLength(0);
    finishSecond({ result: { status: 'available', locations: [second] } }); await flushPromises();
    expect(wrapper.attributes('aria-busy')).toBe('false');
    expect(wrapper.get('.meetup-search-result').text()).toContain('Stadium MRT');
    expect(wrapper.text()).not.toContain('City Hall MRT');
  });

  it('silently resets selection UI for parent-managed manual edits and accepts a later deliberate replacement', async () => {
    const wrapper = render(); await findPlaces(wrapper);
    await wrapper.get('.meetup-search-result').trigger('click');
    await wrapper.setProps({ resetKey: 'manual-entry' });
    expect(wrapper.find('.meetup-location-search__selection').exists()).toBe(false);
    expect(wrapper.get('input').element.value).toBe('');
    expect(wrapper.emitted('selection-invalidated')).toBeUndefined();
    // The component does not clear the parent's manual draft through an event.
    expect(wrapper.emitted('selected')).toEqual([[place]]);
    await findPlaces(wrapper); await wrapper.get('.meetup-search-result').trigger('click');
    expect(wrapper.emitted('selected')).toEqual([[place], [place]]);
  });

  it('discards pending results after disabling or unmounting the search', async () => {
    let finishDisabled, finishUnmounted;
    api.meetupLocations
      .mockReturnValueOnce(new Promise(resolve => { finishDisabled = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { finishUnmounted = resolve; }));
    const wrapper = render(); await findPlaces(wrapper);
    await wrapper.setProps({ disabled: true });
    finishDisabled({ result: { status: 'available', locations: [place] } }); await flushPromises();
    expect(wrapper.find('.meetup-search-results').exists()).toBe(false);
    expect(wrapper.attributes('aria-busy')).toBe('false');
    await wrapper.setProps({ disabled: false });
    await button(wrapper, 'Search OneMap').trigger('click');
    wrapper.unmount();
    finishUnmounted({ result: { status: 'available', locations: [place] } }); await flushPromises();
    expect(wrapper.emitted('selected')).toBeUndefined();
    expect(wrapper.emitted('selection-invalidated')).toBeUndefined();
  });

  it('associates loading, errors and selected feedback with the search field', async () => {
    const wrapper = render(); await findPlaces(wrapper);
    const input = wrapper.get('input');
    expect(input.attributes('aria-controls')).toBe(wrapper.get('.meetup-search-results').attributes('id'));
    expect(input.attributes('aria-describedby').split(' ')).toContain(wrapper.get('[role="status"]').attributes('id'));
    await wrapper.get('.meetup-search-result').trigger('click');
    expect(input.attributes('aria-describedby').split(' ')).toContain(wrapper.get('.meetup-location-search__selection').attributes('id'));
    await input.setValue('Stadium');
    api.meetupLocations.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Search OneMap').trigger('click'); await flushPromises();
    expect(input.attributes('aria-controls')).toBeUndefined();
    expect(input.attributes('aria-describedby').split(' ')).toContain(wrapper.get('[role="alert"]').attributes('id'));
  });
});
