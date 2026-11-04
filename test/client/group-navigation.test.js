import { describe, expect, it } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import GroupNavigation from '../../client/src/components/GroupNavigation.vue';
import { mountPage } from './helpers.js';

describe('group workflow navigation', () => {
  it('makes connection management discoverable and marks its own page while preserving concert context', async () => {
    const { wrapper, router } = await mountPage(GroupNavigation, { path: '/groups/connect?view=connections&concertId=c' });
    const links = wrapper.findAll('a');
    expect(links.map(link => link.text())).toEqual(['Find a group', 'My groups', 'Group connections', 'Create group']);
    const selected = wrapper.get('a[aria-current="page"]');
    expect(selected.text()).toBe('Group connections');
    expect(selected.attributes('href')).toBe('/groups/connect?concertId=c&view=connections');
    await links[1].trigger('click'); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/groups/connect?concertId=c');
  });
});
