import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import GroupComparisonDeck from '../src/components/GroupComparisonDeck.vue';
import MatchProposalCard from '../src/components/MatchProposalCard.vue';
import GroupApplicationCard from '../src/components/GroupApplicationCard.vue';
import { api } from '../src/api.js';
import { button, group } from './helpers.js';

vi.mock('../src/api.js', async original => ({ ...await original(), api: {
  acceptProposal: vi.fn(), declineProposal: vi.fn(), proposalExplanation: vi.fn(),
} }));
const proposal = overrides => ({
  id: 'offer-1', role: 'seeker', status: 'proposed', groupName: 'Front Row Crew',
  hostName: 'Host', seekerName: 'Seeker', section: 'ga_standing', artist: 'Test artist',
  expiresAt: '2030-01-01T12:00:00Z', queueStatus: 'held', queuePosition: 1,
  seatReserved: true, hostApproved: false, seekerApproved: false,
  reasons: [{ label: 'Similar concert energy' }], ...overrides,
});
beforeEach(() => vi.resetAllMocks());

describe('direct comparison with real listing cards', () => {
  it('explains comparison, replaces the other card, then sends one explicit application', async () => {
    const applyGroup = vi.fn().mockResolvedValue(true);
    const groups = [group('a', 'Alpha'), group('b', 'Beta'), group('c', 'Gamma')];
    const wrapper = mount(GroupComparisonDeck, { props: { groups, sessionKey: 'concert-1', canApply: true, applyGroup } });
    await flushPromises();
    expect(wrapper.text()).toContain('Comparing sends no application.');
    expect(wrapper.findAll('article')).toHaveLength(0);
    await button(wrapper, 'Start comparing').trigger('click');
    expect(wrapper.findAll('article').map(card => card.find('h3').text())).toEqual(['Alpha', 'Beta']);
    await button(wrapper, 'Prefer this group').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('article').map(card => card.find('h3').text())).toEqual(['Alpha', 'Gamma']);
    expect(applyGroup).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('No application has been sent.');
    await button(wrapper, 'Request to join').trigger('click');
    await flushPromises();
    expect(applyGroup).toHaveBeenCalledExactlyOnceWith(groups[0]);
    expect(wrapper.text()).toContain('Request sent to Alpha');
    expect(button(wrapper, 'Request sent').element.disabled).toBe(true);
    expect(button(wrapper, 'Request to join').element.disabled).toBe(true);
  });
  it('keeps a failed application card available for retry', async () => {
    const applyGroup = vi.fn().mockRejectedValue(new Error('offline'));
    const wrapper = mount(GroupComparisonDeck, { props: {
      groups: [group('a', 'Alpha')], sessionKey: 'concert-1', instructionsSeen: true, canApply: true, applyGroup,
    } });
    await flushPromises();
    await button(wrapper, 'Request to join').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Your group card has been kept. Please try again.');
    expect(wrapper.find('article h3').text()).toBe('Alpha');
    expect(button(wrapper, 'Request to join').element.disabled).toBe(false);
  });
  it('allows comparison while an unresolved application prevents applying', async () => {
    const applyGroup = vi.fn();
    const wrapper = mount(GroupComparisonDeck, { props: {
      groups: [group('a', 'Alpha'), group('b', 'Beta')], sessionKey: 'concert-1', instructionsSeen: true, applyGroup,
    } });
    await flushPromises();
    expect(button(wrapper, 'Request to join').element.disabled).toBe(true);
    await button(wrapper, 'Prefer this group').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Your comparison favorite');
    expect(applyGroup).not.toHaveBeenCalled();
  });
});
describe('automatic approvals and arrival queue', () => {
  it('saves seeker approval while still requiring host approval', async () => {
    api.acceptProposal.mockResolvedValue({});
    const wrapper = mount(MatchProposalCard, { props: { proposal: proposal() } });
    expect(wrapper.text()).toContain('Both approvals confirm the group place.');
    await button(wrapper, 'Accept group offer').trigger('click');
    await flushPromises();
    expect(api.acceptProposal).toHaveBeenCalledExactlyOnceWith('offer-1');
    expect(wrapper.emitted('updated')).toHaveLength(1);
    await wrapper.setProps({ proposal: proposal({ seekerApproved: true }) });
    expect(wrapper.text()).toContain('Waiting for host');
    expect(wrapper.text()).toContain('The host still needs to approve.');
    expect(wrapper.findAll('button').some(item => item.text() === 'Accept group offer')).toBe(false);
    await wrapper.setProps({ proposal: proposal({ seekerApproved: true, hostApproved: true, status: 'confirmed', eventDate: '2099-01-01' }) });
    expect(wrapper.text()).toContain('Your group place is confirmed.');
  });
  it('blocks accepting a queued offer but lets its seeker decline', async () => {
    api.declineProposal.mockResolvedValue({});
    const wrapper = mount(MatchProposalCard, { props: { proposal: proposal({
      queueStatus: 'waiting', canHostRespond: false, seatReserved: false, queuePosition: 2,
    }) } });
    expect(wrapper.text()).toContain('Waiting in queue');
    expect(wrapper.text()).toContain('Waiting for a place');
    expect(button(wrapper, 'Accept group offer').element.disabled).toBe(true);
    await button(wrapper, 'Decline proposal').trigger('click');
    await flushPromises();
    expect(api.declineProposal).toHaveBeenCalledExactlyOnceWith('offer-1');
  });
  it('reports a stale queue without reporting successful approval', async () => {
    api.acceptProposal.mockRejectedValue(Object.assign(new Error('changed'), { status: 409 }));
    const wrapper = mount(MatchProposalCard, { props: { proposal: proposal({ role: 'host' }) } });
    await button(wrapper, 'Approve companion').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Refresh the queue before replying.');
    expect(wrapper.emitted('updated')).toBeUndefined();
  });
  it('allows host approval of a direct request only when it reaches the front', async () => {
    const application = { ...proposal(), status: 'pending', queueStatus: 'waiting', queuePosition: 2, seatReserved: false, canHostRespond: false };
    const wrapper = mount(GroupApplicationCard, { props: { application } });
    expect(wrapper.text()).toContain('Waiting · position 2');
    expect(button(wrapper, 'Approve group place').element.disabled).toBe(true);
    await wrapper.setProps({ application: { ...application, queueStatus: 'held', seatReserved: true, canHostRespond: true } });
    expect(wrapper.text()).toContain('One place is held');
    await button(wrapper, 'Approve group place').trigger('click');
    expect(wrapper.emitted('respond')).toEqual([['accept']]);
  });
});
