/**
 * SearchSelect: a dropdown you can type into. The list narrows to the closest
 * matches, the best one is highlighted, and only listed options can be chosen.
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SearchSelect from '../../client/src/components/SearchSelect.vue';

const options = [
  { value: 'a', label: 'Bruno Mars, Tue, 13 Apr 2027, National Stadium' },
  { value: 'b', label: 'LANY, Wed, 4 Nov 2026, Singapore Indoor Stadium' },
  { value: 'c', label: 'Lany Tribute Night, Fri, 6 Nov 2026, Esplanade' },
];
const mountSelect = (modelValue = '') => mount(SearchSelect, {
  attachTo: document.body,
  props: { modelValue, options, 'onUpdate:modelValue': (value) => wrapper.setProps({ modelValue: value }) },
});
let wrapper;

describe('SearchSelect', () => {
  it('ranks the closest match first and Enter picks it', async () => {
    wrapper = mountSelect();
    const input = wrapper.get('input');
    await input.trigger('focus');
    await input.setValue('lany');
    const shown = wrapper.findAll('[role="option"]').map((option) => option.text());
    // Both contain "lany"; the label that starts with it ranks first.
    expect(shown).toEqual([options[1].label, options[2].label]);
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['b']);
  });

  it('matches every typed word, in any order', async () => {
    wrapper = mountSelect();
    const input = wrapper.get('input');
    await input.trigger('focus');
    await input.setValue('stadium bruno');
    expect(wrapper.findAll('[role="option"]').map((option) => option.text())).toEqual([options[0].label]);
  });

  it('puts the chosen label back when left without picking', async () => {
    wrapper = mountSelect('a');
    const input = wrapper.get('input');
    expect(input.element.value).toBe(options[0].label);
    await input.trigger('focus');
    await input.setValue('zzz');
    expect(wrapper.text()).toContain('No matches');
    await input.trigger('blur');
    expect(input.element.value).toBe(options[0].label);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
