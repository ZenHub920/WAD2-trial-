import { describe, expect, it } from 'vitest';
import GroupNavigation from '../../client/src/components/GroupNavigation.vue';
import { mountPage } from './helpers.js';

describe('group workflow navigation', () => {
  it('offers Find a group and My groups, keeps the concert and marks the current tab', async () => {
    const { wrapper } = await mountPage(GroupNavigation, { path: '/groups/connect?concertId=concert-1' });
    const links = wrapper.findAll('nav[aria-label="Group workflows"] a');
    expect(links.map(link => link.text())).toEqual(['Find a group', 'My groups']);
    expect(links[0].attributes('href')).toBe('/groups?concertId=concert-1');
    expect(links[1].attributes('href')).toBe('/groups/connect?concertId=concert-1');
    expect(links[1].attributes('aria-current')).toBe('page');
    expect(links[0].attributes('aria-current')).toBeUndefined();
  });
});
