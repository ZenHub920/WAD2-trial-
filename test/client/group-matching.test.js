import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import GroupComparisonDeck from '../../client/src/components/GroupComparisonDeck.vue';
import MatchProposalCard from '../../client/src/components/MatchProposalCard.vue';
import GroupApplicationCard from '../../client/src/components/GroupApplicationCard.vue';
import GroupListingCard from '../../client/src/components/GroupListingCard.vue';
import GroupPrioritiesSummary from '../../client/src/components/GroupPrioritiesSummary.vue';
import { api } from '../../client/src/api.js';
import { button, group } from './helpers.js';

vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: {
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
    expect(wrapper.text()).toContain('Nothing is sent until you ask to join.');
    expect(wrapper.findAll('article')).toHaveLength(0);
    await button(wrapper, 'Start comparing').trigger('click');
    expect(wrapper.findAll('article').map(card => card.find('h3').text())).toEqual(['Alpha', 'Beta']);
    await button(wrapper, 'Keep this group').trigger('click');
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
    await button(wrapper, 'Keep this group').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Your pick so far');
    expect(applyGroup).not.toHaveBeenCalled();
  });
  it('keeps a cancelled review local and allows the same group to be reviewed again', async () => {
    const applyGroup = vi.fn().mockResolvedValueOnce('cancelled').mockResolvedValueOnce(true);
    const candidate = group('a', 'Alpha');
    const wrapper = mount(GroupComparisonDeck, { props: {
      groups: [candidate], sessionKey: 'concert-1', instructionsSeen: true, canApply: true, applyGroup,
    } });
    await flushPromises();
    await button(wrapper, 'Request to join').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('No request sent to Alpha.');
    expect(wrapper.text()).not.toContain('Request sent to Alpha');
    expect(wrapper.find('article h3').text()).toBe('Alpha');
    expect(button(wrapper, 'Request to join').element.disabled).toBe(false);
    await button(wrapper, 'Request to join').trigger('click'); await flushPromises();
    expect(applyGroup.mock.calls).toEqual([[candidate], [candidate]]);
    expect(wrapper.text()).toContain('Request sent to Alpha');
  });
  it('locks a pending request review against duplicate submissions without reporting an application', async () => {
    let finishReview;
    const applyGroup = vi.fn(() => new Promise(resolve => { finishReview = resolve; }));
    const wrapper = mount(GroupComparisonDeck, { props: {
      groups: [group('a', 'Alpha')], sessionKey: 'concert-1', instructionsSeen: true, canApply: true, applyGroup,
    } });
    await flushPromises();
    await button(wrapper, 'Request to join').trigger('click');
    expect(button(wrapper, 'Request to join').element.disabled).toBe(true);
    await button(wrapper, 'Request to join').trigger('click');
    expect(applyGroup).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain('Request sent to Alpha');
    finishReview('cancelled'); await flushPromises();
    expect(button(wrapper, 'Request to join').element.disabled).toBe(false);
    expect(wrapper.text()).toContain('No request sent to Alpha.');
  });
});
describe('automatic approvals and arrival queue', () => {
  it('applies the saved approval response immediately if the parent cannot refresh the proposal', async () => {
    api.acceptProposal.mockResolvedValue({ proposal: { status: 'proposed', seekerApproved: true, hostApproved: false } });
    const wrapper = mount(MatchProposalCard, { props: { proposal: proposal() } });
    await button(wrapper, 'Accept group offer').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Your approval is saved');
    expect(wrapper.findAll('button').some(item => item.text() === 'Accept group offer')).toBe(false);
    expect(wrapper.text()).toContain('Waiting for host');
    expect(wrapper.emitted('updated')[0][0]).toMatchObject({ id: 'offer-1', role: 'seeker', status: 'proposed', seekerApproved: true, hostApproved: false });
    expect(api.acceptProposal).toHaveBeenCalledTimes(1);
  });
  it('keeps historical automatic and direct requests readable, disables acceptance and leaves decline available', async () => {
    const past = { eventDate: '2000-01-01', eventTimezone: 'America/Los_Angeles' };
    const offer = mount(MatchProposalCard, { props: { proposal: proposal(past) } });
    expect(offer.text()).toContain('This concert has finished');
    expect(button(offer, 'Accept group offer').element.disabled).toBe(true);
    expect(button(offer, 'Decline proposal').element.disabled).toBe(false);
    const direct = mount(GroupApplicationCard, { props: { application: { ...proposal(past), status: 'pending' } } });
    expect(direct.text()).toContain('This concert has finished');
    expect(button(direct, 'Approve group place').element.disabled).toBe(true);
    expect(button(direct, 'Decline request').element.disabled).toBe(false);
    expect(api.acceptProposal).not.toHaveBeenCalled();
  });
  it('saves seeker approval while still requiring host approval', async () => {
    api.acceptProposal.mockResolvedValue({});
    const wrapper = mount(MatchProposalCard, { props: { proposal: proposal() } });
    expect(wrapper.get('[aria-label="Match approval progress"]').text()).toContain('Awaiting approval');
    await button(wrapper, 'Accept group offer').trigger('click');
    await flushPromises();
    expect(api.acceptProposal).toHaveBeenCalledExactlyOnceWith('offer-1');
    expect(wrapper.emitted('updated')).toHaveLength(1);
    await wrapper.setProps({ proposal: proposal({ seekerApproved: true }) });
    expect(wrapper.text()).toContain('Waiting for host');
    expect(wrapper.text()).toContain('The host still needs to approve.');
    expect(wrapper.findAll('button').some(item => item.text() === 'Accept group offer')).toBe(false);
    await wrapper.setProps({ proposal: proposal({ seekerApproved: true, hostApproved: true, status: 'confirmed', eventDate: '2099-01-01' }) });
    expect(wrapper.text()).toContain('Your group membership is confirmed.');
  });
  it('blocks accepting a queued offer but lets its seeker decline', async () => {
    api.declineProposal.mockResolvedValue({});
    const wrapper = mount(MatchProposalCard, { props: { proposal: proposal({
      queueStatus: 'waiting', canHostRespond: false, seatReserved: false, queuePosition: 2,
    }) } });
    expect(wrapper.text()).toContain('Waiting in queue');
    expect(wrapper.text()).toContain('Waiting for a spot');
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

describe('private questionnaires and shared group preferences', () => {
  it('shows safe applicant match reasons and a public vibe link without rendering their questionnaire', () => {
    const wrapper = mount(GroupApplicationCard, {
      props: { application: {
        ...proposal(), status: 'pending', remainingCapacity: 1,
        seeker: { id: 'person/1', ageBand: '18–24', languages: ['English'], vibe: {} },
        preferences: { about: [{ text: 'private about answer' }], wants: [{ text: 'private companion answer' }], avoid: [{ text: 'private avoid answer' }] },
      } },
      global: { stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    expect(wrapper.text()).toContain('Similar concert energy');
    expect(wrapper.text()).toContain('Their questionnaire stays private');
    expect(wrapper.get('a').attributes('href')).toBe('/people/person%2F1');
    expect(wrapper.text()).not.toContain('private about answer');
    expect(wrapper.text()).not.toContain('private companion answer');
    expect(wrapper.text()).not.toContain('private avoid answer');
  });
  it('shows at most three aggregate preferences with honest incomplete profile coverage', () => {
    const wrapper = mount(GroupListingCard, { props: { group: { ...group('a', 'Alpha'), profile: {
      coverage: { answered: 2, total: 3, ratio: 2 / 3, complete: false },
      representativeWants: ['Similar concert energy', 'Sing together', 'Arrive early', 'Fourth preference'].map((label, key) => ({ key, label, support: 2 / 3, weight: 2 / 3 })),
      wants: { private_individual_wording: 1 },
    } } } });
    expect(wrapper.text()).toContain('2 of 3 profiles represented');
    expect(wrapper.text()).toContain('Still forming');
    expect(wrapper.get('.group-priorities__list').findAll('li')).toHaveLength(3);
    expect(wrapper.text()).not.toContain('Fourth preference');
    expect(wrapper.text()).not.toContain('private_individual_wording');
  });
  it('does not invent consensus when everyone answered but no majority preference exists', () => {
    const wrapper = mount(GroupPrioritiesSummary, { props: { profile: {
      coverage: { answered: 4, total: 4, ratio: 1, complete: true }, representativeWants: [],
    } } });
    expect(wrapper.text()).toContain('4 of 4 profiles represented');
    expect(wrapper.text()).toContain('No shared preference yet');
    expect(wrapper.text()).not.toContain('Still forming');
  });
});

describe('offer card match reasons', () => {
  it('colours a concert-vibe reason by its vibe and leaves other reasons plain', () => {
    const wrapper = mount(MatchProposalCard, { props: { proposal: { id: 'offer-2', role: 'seeker', status: 'confirmed', groupName: 'Crew', hostName: 'Host',
      artist: 'Artist', section: 'ga_standing', reasons: [{ concept: 'singalong', label: 'Sing along' }, { concept: 'pre_food', label: 'Food before the concert' }] } } });
    const [vibe, plain] = wrapper.findAll('[aria-label="Saved match reasons"] li');
    expect(vibe.classes()).toContain('proposal__reason--vibe');
    expect(vibe.attributes('style')).toContain('--vibe-colour: var(--vibe-singalong)');
    expect(plain.classes()).not.toContain('proposal__reason--vibe');
    expect(wrapper.text()).not.toContain('A group spot means membership');
  });
});

describe('offer approval marks', () => {
  const offer = overrides => ({ id: 'offer-3', role: 'seeker', groupName: 'Crew', hostName: 'Host', artist: 'Artist', section: 'ga_standing',
    expiresAt: '2030-01-01T10:00:00Z', ...overrides });
  it('shows an approval as a green tick and a pending one in amber', () => {
    const wrapper = mount(MatchProposalCard, { props: { proposal: offer({ status: 'proposed', hostApproved: true, seekerApproved: false }) } });
    const [host, seeker] = wrapper.findAll('[aria-label="Match approval progress"] li');
    expect(host.classes()).toContain('is-approved'); expect(host.get('.proposal__check').text()).toBe('✓');
    expect(seeker.classes()).toContain('is-pending'); expect(seeker.text()).toContain('Awaiting approval');
  });
  it('marks whoever had not approved a declined offer with a red cross', () => {
    const wrapper = mount(MatchProposalCard, { props: { proposal: offer({ status: 'declined', hostApproved: true, seekerApproved: false }) } });
    const [host, seeker] = wrapper.findAll('[aria-label="Match approval progress"] li');
    expect(host.classes()).toContain('is-approved');
    expect(seeker.classes()).toContain('is-declined'); expect(seeker.get('.proposal__check').text()).toBe('✕');
    expect(seeker.text()).toContain('Declined');
  });
});
