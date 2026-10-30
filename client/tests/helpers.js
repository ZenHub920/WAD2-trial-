import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';

export async function mountPage(component, { path = '/', props = {} } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: '/:pathMatch(.*)*', component: { template: '<div />' },
  }] });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(component, { props, attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}
export function button(wrapper, text) {
  const found = wrapper.findAll('button').find(item => item.text().trim() === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
export function field(wrapper, text) {
  const label = wrapper.findAll('label').find(item => item.text().trim().startsWith(text));
  if (!label) throw new Error(`Label not found: ${text}`);
  return label.find('input, select, textarea');
}
export const group = (id, name) => ({
  id, name, hostName: `${name} host`, artist: 'Test artist', eventDate: '2030-01-01',
  section: 'ga_standing', remainingCapacity: 1, memberCount: 2, spendBand: 2,
  arrivalPlan: 'mid', compatibility: 0.8, reasons: [{ label: 'Similar concert energy' }],
  settings: { published: true, connect_open: true }, status: 'open', concertId: 'concert-1',
});
