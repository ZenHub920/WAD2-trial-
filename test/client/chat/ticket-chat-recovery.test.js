import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ChatThreadView from '../../../client/src/views/ChatThreadView.vue';
import { api } from '../../../client/src/api.js';
import { currentUser } from '../../../client/src/auth.js';

vi.mock('../../../client/src/api.js', async original => ({ ...await original(), api: { conversation: vi.fn(), sendMessage: vi.fn() } }));
const message = (id, body = id, seq = 1) => ({ id, body, seq, senderId: 'me', createdAt: '2030-01-01 08:00:00' });
const conversation = id => ({ id, role: 'buyer', other: { displayName: `Seller ${id}` }, listing: { id: 'ticket', title: 'Concert ticket', priceCents: 1000, status: 'active' } });
async function open(id = 'a') {
  const empty = { template: '<div />' };
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/chat/:id', component: empty }, { path: '/messages', name: 'kaki-chat', component: empty },
    { path: '/tickets/:id', name: 'ticket-detail', component: empty }, { path: '/login', name: 'login', component: empty },
  ] });
  await router.push(`/chat/${id}`);
  const wrapper = mount(ChatThreadView, { props: { id }, global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}
beforeEach(() => {
  vi.resetAllMocks();
  // jsdom has no scrolling implementation; the real browser suite covers it.
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
  currentUser.value = { id: 'me' };
  api.conversation.mockImplementation(async id => ({ conversation: conversation(id), messages: [message(`${id}-first`)] }));
});

describe('ticket conversation mutation and scope recovery', () => {
  it('retries the failed pre-send cursor and restores an intervening reply in server order', async () => {
    vi.useFakeTimers();
    api.conversation.mockResolvedValue({ conversation: conversation('a'), messages: [message('m1', 'Earlier message', 1)] });
    const wrapper = await open();
    api.sendMessage.mockResolvedValue({ message: message('m3', 'My saved reply', 3) });
    api.conversation.mockRejectedValueOnce(new Error('refresh offline')).mockResolvedValue({
      messages: [message('m2', 'Previously missed reply', 2), message('m3', 'My saved reply', 3)],
    });
    await wrapper.get('textarea').setValue('My saved reply'); await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.findAll('.bubble__body').map(row => row.text())).toEqual(['Earlier message', 'My saved reply']);
    await vi.advanceTimersByTimeAsync(4000); await flushPromises();
    expect(api.conversation.mock.calls.at(-1)).toEqual(['a', null, { after: 'm1' }]);
    expect(wrapper.findAll('.bubble__body').map(row => row.text())).toEqual(['Earlier message', 'Previously missed reply', 'My saved reply']);
  });

  it('recovers a first-send gap from the latest page when no earlier cursor existed', async () => {
    vi.useFakeTimers();
    api.conversation.mockResolvedValue({ conversation: conversation('a'), messages: [] });
    const wrapper = await open();
    api.sendMessage.mockResolvedValue({ message: message('m2', 'My first message', 2) });
    api.conversation.mockRejectedValueOnce(new Error('refresh offline')).mockResolvedValue({
      messages: [message('m1', 'Their concurrent message', 1), message('m2', 'My first message', 2)],
    });
    await wrapper.get('textarea').setValue('My first message'); await wrapper.get('form').trigger('submit'); await flushPromises();
    await vi.advanceTimersByTimeAsync(4000); await flushPromises();
    expect(api.conversation.mock.calls.at(-1)).toEqual(['a']);
    expect(wrapper.findAll('.bubble__body').map(row => row.text())).toEqual(['Their concurrent message', 'My first message']);
  });
  it('shows a saved message when reply refresh fails and never claims the send failed', async () => {
    const wrapper = await open();
    api.sendMessage.mockResolvedValue({ message: message('saved', 'Message persisted by server') });
    api.conversation.mockRejectedValue(new Error('refresh offline'));
    await wrapper.get('textarea').setValue('Message persisted by server');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Message persisted by server');
    expect(wrapper.text()).toContain('Message sent. New replies could not refresh');
    expect(wrapper.text()).not.toContain('Message not sent');
    expect(wrapper.get('textarea').element.value).toBe('');
  });

  it('keeps the draft when sending fails and blocks duplicate requests in flight', async () => {
    const wrapper = await open();
    let rejectSend;
    api.sendMessage.mockImplementation(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
    await wrapper.get('textarea').setValue('Please keep this draft');
    await wrapper.get('form').trigger('submit');
    await wrapper.get('form').trigger('submit');
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    rejectSend(new Error('offline'));
    await flushPromises();
    expect(wrapper.get('textarea').element.value).toBe('Please keep this draft');
    expect(wrapper.text()).toContain('Message not sent');
  });

  it('ignores a late load for the previous route', async () => {
    let finishOld;
    api.conversation.mockImplementation(id => id === 'a'
      ? new Promise(resolve => { finishOld = resolve; })
      : Promise.resolve({ conversation: conversation(id), messages: [message('current-room')] }));
    const wrapper = await open('a');
    await wrapper.setProps({ id: 'b' });
    await flushPromises();
    finishOld({ conversation: conversation('a'), messages: [message('private-old-room')] });
    await flushPromises();
    expect(wrapper.text()).toContain('Seller b');
    expect(wrapper.text()).toContain('current-room');
    expect(wrapper.text()).not.toContain('private-old-room');
  });

  it('does not clear a new account draft or append the old account send response', async () => {
    const wrapper = await open();
    let finishSend;
    api.sendMessage.mockImplementation(() => new Promise(resolve => { finishSend = resolve; }));
    await wrapper.get('textarea').setValue('old account send');
    await wrapper.get('form').trigger('submit');
    currentUser.value = { id: 'new-viewer' };
    await flushPromises();
    await wrapper.get('textarea').setValue('new account draft');
    finishSend({ message: message('old-secret-message') });
    await flushPromises();
    expect(wrapper.get('textarea').element.value).toBe('new account draft');
    expect(wrapper.text()).not.toContain('old-secret-message');
  });
});
