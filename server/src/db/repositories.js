/** Compose data access while preserving the existing repository interface. */

import { createUserRepo, createSessionRepo } from './userRepository.js';
import { createConcertRepo, createParticipationRepo } from './concertRepository.js';
import { createPartyRepo } from './partyRepository.js';
import { createTicketRepo, createOrderRepo, createIssuedTicketRepo } from './ticketRepository.js';
import { createSeekerRepo } from './seekerRepository.js';
import { createRoundRepo } from './roundRepository.js';
import { createKakiRepo } from './kakiRepository.js';
import { createConversationRepo } from './marketplaceConversationRepository.js';
import { createProposalRepo } from './proposalRepository.js';
import { createGroupDiscoveryRepo } from './groupDiscoveryRepository.js';
import { createMembershipRepo } from './membershipRepository.js';
import { createRecommendationRepo } from './recommendationRepository.js';
import { createNotificationRepo } from './notificationRepository.js';
import { createMeetupRepo } from './meetupRepository.js';
import { createFeedbackRepo } from './feedbackRepository.js';
import { createKakiChatRepo } from './kakiChatRepository.js';
import { createGroupChannelRepo } from './groupChannelRepository.js';
import { createConnectionChannelRepo } from './connectionChannelRepository.js';

// Keep named imports from this original entry point compatible.
export {
  createUserRepo,
  createConcertRepo,
  createParticipationRepo,
  createPartyRepo,
  createTicketRepo,
  createSeekerRepo,
  createRoundRepo,
  createSessionRepo,
  createKakiRepo,
  createOrderRepo,
  createIssuedTicketRepo,
  createConversationRepo,
};
export { normalizeTicketNumber } from './ticketRepository.js';

export function createRepositories(db) {
  const repos = {
    users: createUserRepo(db),
    concerts: createConcertRepo(db),
    participation: createParticipationRepo(db),
    parties: createPartyRepo(db),
    tickets: createTicketRepo(db),
    orders: createOrderRepo(db),
    issuedTickets: createIssuedTicketRepo(db),
    conversations: createConversationRepo(db),
    seekers: createSeekerRepo(db),
    rounds: createRoundRepo(db),
    sessions: createSessionRepo(db),
    kaki: createKakiRepo(db),
    // Kaki Finder messaging. Separate from `conversations` above, which is the
    // buyer–seller chat on a ticket listing.
    kakiChat: createKakiChatRepo(db),
  };
  repos.proposals = createProposalRepo(db, repos);
  repos.groups = createGroupDiscoveryRepo(db, repos);
  repos.membership = createMembershipRepo(db, repos);
  repos.recommendations = createRecommendationRepo(db, repos);
  repos.notifications = createNotificationRepo(db);
  repos.meetups = createMeetupRepo(db, repos);
  repos.feedback = createFeedbackRepo(db, repos);
  // The group's shared room. Needs `repos` for concert lookup, so it is built
  // here rather than in the literal above.
  repos.groupChannels = createGroupChannelRepo(db, repos);
  repos.connectionChannels = createConnectionChannelRepo(db, repos);
  return repos;
}
