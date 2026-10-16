-- Encore — schema
--
-- Design notes:
--   * Match results are IMMUTABLE and versioned by round. A round snapshots the
--     preference lists it was computed from, so any historical matching can be
--     re-verified for stability long after the underlying profiles have changed.
--   * The stability verdict is stored WITH the round. A matching that cannot prove
--     itself stable is a bug, and the record should say so rather than hiding it.
--   * Seeker requests and party listings are separate tables even though both
--     reference users, because they are the two sides of the bipartite instance.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  display_name           TEXT    NOT NULL,
  email                  TEXT    UNIQUE,
  password_hash          TEXT,
  age_band               TEXT    NOT NULL CHECK (age_band IN ('18-20','21-24','25-29','30-34','35+')),
  home_region            TEXT    NOT NULL,
  gender                 TEXT    NOT NULL,
  companion_gender_pref  TEXT    NOT NULL DEFAULT 'any' CHECK (companion_gender_pref IN ('any','same_only')),
  languages_json         TEXT    NOT NULL DEFAULT '["en"]',
  vibe_json              TEXT    NOT NULL,
  reliability            REAL    NOT NULL DEFAULT 0.75 CHECK (reliability BETWEEN 0 AND 1),
  verified               INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  is_operator            INTEGER NOT NULL DEFAULT 0 CHECK (is_operator IN (0,1)),
  created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Only hashes of opaque login cookies are stored, so a database read alone
-- cannot replay an active session.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Mutual exclusions. Stored one row per direction so a one-sided block still works.
CREATE TABLE IF NOT EXISTS blocks (
  blocker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS concerts (
  id            TEXT PRIMARY KEY,
  artist        TEXT NOT NULL,
  tour_name     TEXT,
  venue         TEXT NOT NULL,
  city          TEXT NOT NULL,
  event_date    TEXT NOT NULL,
  doors_time    TEXT,
  hero_image_url TEXT,
  blurb         TEXT,
  source        TEXT,
  source_event_id TEXT,
  official_url  TEXT,
  image_attribution TEXT,
  -- Matching for an event closes at this point; rounds run on or after it.
  matching_closes_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_concerts_date ON concerts(event_date);

-- ---------------------------------------------------------------------------
-- The two sides of the instance
-- ---------------------------------------------------------------------------

-- A party is a host with q open slots. q > 1 is what makes this Hospital/Residents
-- rather than plain stable marriage.
CREATE TABLE IF NOT EXISTS parties (
  id                TEXT    PRIMARY KEY,
  host_user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concert_id        TEXT    NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
  capacity          INTEGER NOT NULL CHECK (capacity >= 1),
  section           TEXT    NOT NULL CHECK (section IN ('pit','ga_standing','lower_bowl','upper_bowl','seated_any')),
  spend_band        INTEGER NOT NULL CHECK (spend_band BETWEEN 1 AND 4),
  arrival_plan      TEXT    NOT NULL CHECK (arrival_plan IN ('early_queue','mid','doors')),
  plans_json        TEXT    NOT NULL DEFAULT '{}',
  strict_age_policy INTEGER NOT NULL DEFAULT 0 CHECK (strict_age_policy IN (0,1)),
  min_age_band      TEXT,
  -- Lower quota: the group only goes ahead if it reaches this many members.
  -- NULL or <= 1 is no constraint. Its presence turns the instance into
  -- Hospital/Residents with Lower Quotas, which the classifier detects and
  -- which no registered solver can yet model exactly.
  min_size          INTEGER CHECK (min_size IS NULL OR min_size >= 1),
  notes             TEXT,
  status            TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','cancelled')),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (host_user_id, concert_id),
  CHECK (min_size IS NULL OR min_size <= capacity)
);

CREATE INDEX IF NOT EXISTS idx_parties_concert ON parties(concert_id, status);

-- Ticket inventory is independent from the matchmaking party/host instance.
CREATE TABLE IF NOT EXISTS tickets (
  id             TEXT PRIMARY KEY,
  seller_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concert_id     TEXT NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
  price_cents    INTEGER NOT NULL CHECK (price_cents >= 0),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  section        TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  image_path     TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','cancelled','deleted')),
  source_party_id TEXT UNIQUE REFERENCES parties(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_status_created ON tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_seller ON tickets(seller_user_id, created_at DESC);

-- Ticket verification lives on tickets as additive columns (see connection.js
-- ADDED_COLUMNS): verified, verification_status ('pending'|'approved'|'rejected'),
-- verification_method ('ticket_number'|'proof'), proof_data, review_note,
-- reviewed_by, reviewed_at. `verified` is only ever set by the server.

-- The official ticket numbers issued for a concert, imported by an operator. A ticket
-- whose numbers are all on this list is verified without human review.
CREATE TABLE IF NOT EXISTS issued_tickets (
  concert_id     TEXT NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
  ticket_number  TEXT NOT NULL,              -- normalised: trimmed, upper-case, spaces/dashes as one dash
  category       TEXT,                       -- when given, the listing's section must match
  imported_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (concert_id, ticket_number)
);

-- The ticket numbers a seller put on a listing. Never shown publicly (anyone could
-- copy them); the seller sees them, and the buyer receives them after paying.
-- A number may be on only one ACTIVE listing at a time (checked in the create
-- transaction), so a sold ticket can be resold by its new owner.
CREATE TABLE IF NOT EXISTS ticket_numbers (
  ticket_id      TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  concert_id     TEXT NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
  ticket_number  TEXT NOT NULL,
  PRIMARY KEY (ticket_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_ticket_numbers_number ON ticket_numbers(concert_id, ticket_number);

-- Amounts are copied onto the order at purchase time, so a later price edit on the
-- listing can never change what the buyer was charged. Money is in integer cents.
CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT    PRIMARY KEY,
  ticket_id          TEXT    NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  buyer_user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subtotal_cents     INTEGER NOT NULL,
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  total_cents        INTEGER NOT NULL,
  currency           TEXT    NOT NULL DEFAULT 'SGD',
  payment_method     TEXT    NOT NULL CHECK (payment_method IN ('visa','mastercard','paypal','apple_pay')),
  status             TEXT    NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','refunded')),
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_user_id, created_at DESC);

-- A conversation is one buyer asking one seller about one ticket listing, so a
-- second tap on Chat reopens the same thread instead of starting another.
CREATE TABLE IF NOT EXISTS ticket_conversations (
  id              TEXT PRIMARY KEY,
  ticket_id       TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  buyer_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ticket_id, buyer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_conversations_buyer ON ticket_conversations(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_conversations_seller ON ticket_conversations(seller_user_id);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES ticket_conversations(id) ON DELETE CASCADE,
  sender_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body             TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_conversation ON ticket_messages(conversation_id, created_at);

-- Kaki participation does not enroll a user in group matching.
-- Keep withdrawn rows so a legacy open seeker/host cannot reappear in Kaki.
CREATE TABLE IF NOT EXISTS concert_participants (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concert_id   TEXT NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
  section_pref TEXT NOT NULL CHECK (section_pref IN ('pit','ga_standing','lower_bowl','upper_bowl','seated_any')),
  arrival_pref TEXT NOT NULL CHECK (arrival_pref IN ('early_queue','mid','doors')),
  status       TEXT NOT NULL DEFAULT 'joined' CHECK (status IN ('joined','withdrawn')),
  joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, concert_id)
);
CREATE INDEX IF NOT EXISTS idx_participants_concert ON concert_participants(concert_id, status);

CREATE TABLE IF NOT EXISTS seeker_requests (
  id                TEXT    PRIMARY KEY,
  user_id           TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concert_id        TEXT    NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
  section_pref      TEXT    NOT NULL CHECK (section_pref IN ('pit','ga_standing','lower_bowl','upper_bowl','seated_any')),
  spend_band_max    INTEGER NOT NULL CHECK (spend_band_max BETWEEN 1 AND 4),
  arrival_pref      TEXT    NOT NULL CHECK (arrival_pref IN ('early_queue','mid','doors')),
  plans_wanted_json TEXT    NOT NULL DEFAULT '{}',
  strict_age_policy INTEGER NOT NULL DEFAULT 0 CHECK (strict_age_policy IN (0,1)),
  age_tolerance     INTEGER NOT NULL DEFAULT 1,
  -- All-or-nothing link: two friends who join the same group or neither goes.
  -- The classifier only counts a pair when the link is RECIPROCATED, so a
  -- dangling reference is treated as a single rather than silently changing
  -- the problem. Its presence makes the instance Hospital/Residents with
  -- Couples, which is NP-hard and may admit no stable matching at all.
  linked_request_id TEXT    REFERENCES seeker_requests(id) ON DELETE SET NULL,
  notes             TEXT,
  status            TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','withdrawn')),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, concert_id),
  CHECK (linked_request_id IS NULL OR linked_request_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_seekers_concert ON seeker_requests(concert_id, status);

-- Kaki decisions are keyed by concert and person, not by a request's lifecycle.
CREATE TABLE IF NOT EXISTS kaki_decisions (
  concert_id    TEXT NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision      TEXT NOT NULL CHECK (decision IN ('like','skip')),
  decided_at    INTEGER NOT NULL,
  PRIMARY KEY (concert_id, actor_user_id, target_user_id),
  CHECK (actor_user_id <> target_user_id)
);
CREATE INDEX IF NOT EXISTS idx_kaki_decisions_target
  ON kaki_decisions (concert_id, target_user_id, actor_user_id);

-- ---------------------------------------------------------------------------
-- Match rounds — immutable results with their own stability proof
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS match_rounds (
  id                  TEXT    PRIMARY KEY,
  concert_id          TEXT    NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
  algorithm           TEXT    NOT NULL DEFAULT 'gale_shapley_hr',
  ran_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  -- the stability proof, stored alongside the result it certifies
  is_stable           INTEGER NOT NULL CHECK (is_stable IN (0,1)),
  blocking_pair_count INTEGER NOT NULL DEFAULT 0,
  seeker_count        INTEGER NOT NULL,
  party_count         INTEGER NOT NULL,
  total_capacity      INTEGER NOT NULL,
  feasible_pairs      INTEGER NOT NULL,
  matched_count       INTEGER NOT NULL,
  metrics_json        TEXT    NOT NULL,
  timings_json        TEXT    NOT NULL,
  -- the exact preference lists the result was computed from, for later re-verification
  preference_snapshot_json TEXT,
  -- The guarantee ledger. `is_stable` above records what was MEASURED; these
  -- record which solver ran, on what kind of instance, and what it was
  -- entitled to claim before it ran. Two rounds can now carry genuinely
  -- different promises, and the interface can say so truthfully.
  solver_id           TEXT,
  instance_class      TEXT,
  stability_promise   TEXT,   -- guaranteed | best_effort | not_guaranteed
  relaxations_json    TEXT,   -- constraints the solver could not represent
  ledger_json         TEXT
);

CREATE INDEX IF NOT EXISTS idx_rounds_concert ON match_rounds(concert_id, ran_at DESC);

CREATE TABLE IF NOT EXISTS match_results (
  id                TEXT    PRIMARY KEY,
  round_id          TEXT    NOT NULL REFERENCES match_rounds(id) ON DELETE CASCADE,
  seeker_request_id TEXT    NOT NULL REFERENCES seeker_requests(id) ON DELETE CASCADE,
  party_id          TEXT    REFERENCES parties(id) ON DELETE CASCADE,
  seeker_rank       INTEGER,          -- 1-indexed position of the party on the seeker's list
  party_rank        INTEGER,          -- 1-indexed position of the seeker on the party's list
  seeker_score      REAL,
  party_score       REAL,
  outcome           TEXT    NOT NULL CHECK (outcome IN ('matched','unmatched')),
  UNIQUE (round_id, seeker_request_id)
);

CREATE INDEX IF NOT EXISTS idx_results_round ON match_results(round_id);
CREATE INDEX IF NOT EXISTS idx_results_party ON match_results(party_id);

-- Proposal-by-proposal record of a round, for the algorithm visualisation.
CREATE TABLE IF NOT EXISTS match_trace (
  round_id          TEXT    NOT NULL REFERENCES match_rounds(id) ON DELETE CASCADE,
  step              INTEGER NOT NULL,
  event_type        TEXT    NOT NULL CHECK (event_type IN ('accept','reject','evict')),
  seeker_request_id TEXT    NOT NULL,
  party_id          TEXT    NOT NULL,
  rank              INTEGER,
  evicted_seeker_id TEXT,
  PRIMARY KEY (round_id, step)
);

-- ---------------------------------------------------------------------------
-- Post-event feedback, which feeds reliability back into future preference lists
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_feedback (
  id             TEXT    PRIMARY KEY,
  round_id       TEXT    NOT NULL REFERENCES match_rounds(id) ON DELETE CASCADE,
  rater_user_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rated_user_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  showed_up      INTEGER NOT NULL CHECK (showed_up IN (0,1)),
  rating         INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (round_id, rater_user_id, rated_user_id)
);

-- Reliability is DERIVED, never edited by hand. This view is the single source of
-- truth; users.reliability is a cached projection refreshed after each event.
CREATE VIEW IF NOT EXISTS user_reliability AS
SELECT
  u.id AS user_id,
  COUNT(f.id)                                   AS ratings_count,
  COALESCE(AVG(f.showed_up), 1.0)               AS show_rate,
  COALESCE(AVG(f.rating) / 5.0, 0.75)           AS mean_rating,
  -- Shrink toward the 0.75 prior when there is little history, so a single
  -- rating cannot swing a new user's standing.
  ROUND(
    (COUNT(f.id) * COALESCE(AVG(f.showed_up) * 0.5 + (AVG(f.rating) / 5.0) * 0.5, 0.75)
     + 3 * 0.75)
    / (COUNT(f.id) + 3.0)
  , 4)                                          AS derived_reliability
FROM users u
LEFT JOIN attendance_feedback f ON f.rated_user_id = u.id
GROUP BY u.id;

CREATE TABLE IF NOT EXISTS match_proposals (
    id TEXT PRIMARY KEY,

    round_id TEXT NOT NULL,
    match_result_id TEXT NOT NULL UNIQUE,

    seeker_request_id TEXT NOT NULL,
    party_id TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (
            status IN (
                'proposed',
                'confirmed',
                'declined',
                'expired',
                'cancelled'
            )
        ),

    expires_at INTEGER NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (round_id)
        REFERENCES match_rounds(id),

    FOREIGN KEY (match_result_id)
        REFERENCES match_results(id),

    FOREIGN KEY (seeker_request_id)
        REFERENCES seeker_requests(id),

    FOREIGN KEY (party_id)
        REFERENCES parties(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_seeker_proposal
ON match_proposals(seeker_request_id)
WHERE status IN ('proposed', 'confirmed');

-- This index prevents a seeker request from having multiple active proposals simultaneously.

-- For example, suppose a seeker has already been offered a place in Group A.

-- Until they accept, decline, or their proposal expires, the system should not reserve a second place for the same request in Group B.


-- ============================================================
-- INDEX: LOOK UP RESERVED SPACES BY PARTY
-- Improvements #5 and #6
-- ============================================================
--
-- PURPOSE:
-- Speeds up queries that count a party's active proposals.
--
-- WHY:
-- Every time Gale-Shapley runs, Encore must determine how
-- many spaces remain in each party.
--
-- Only proposed and confirmed assignments occupy capacity.
--
-- NOTE:
-- This is a normal (non-unique) index because one party
-- can have multiple seekers occupying different slots.

CREATE INDEX IF NOT EXISTS idx_proposals_party_status
ON match_proposals(party_id, status);



-- ============================================================
-- TABLE: MATCH DECLINES
-- Improvement #6 - Match acceptance and rejection
-- ============================================================
--
-- PURPOSE:
-- Remembers that a particular seeker declined a particular
-- concert group.
--
-- EXAMPLE:
-- Alex is offered Party A and declines.
--
-- A future Gale-Shapley round should not offer Alex the same
-- party again unless your product explicitly allows resetting
-- declined preferences.
--
-- WHY A SEPARATE TABLE?
-- match_proposals stores the status of each historical offer.
-- match_declines stores pairs that are no longer acceptable.
--
-- COMPOSITE PRIMARY KEY:
-- The combination (seeker_request_id, party_id) is unique.
-- Alex cannot record the same decline multiple times.

CREATE TABLE IF NOT EXISTS match_declines (

    seeker_request_id TEXT NOT NULL
        REFERENCES seeker_requests(id)
        ON DELETE CASCADE,

    party_id TEXT NOT NULL
        REFERENCES parties(id)
        ON DELETE CASCADE,

    declined_at TEXT NOT NULL
        DEFAULT (datetime('now')),

    PRIMARY KEY (seeker_request_id, party_id)

);



-- ============================================================
-- TABLE: CONVERSATIONS
-- Improvement #7 - Kaki Finder messaging
-- ============================================================
--
-- PURPOSE:
-- Represents a private conversation between two people
-- who have mutually liked each other for the same concert.
--
-- EXAMPLE:
-- Alex likes Jamie.
-- Jamie likes Alex.
-- Encore creates one conversation for that concert.
--
-- user_a_id and user_b_id are stored in sorted order
-- (lexicographically smaller ID first).
--
-- This prevents Alex-Jamie and Jamie-Alex from becoming
-- two separate conversations for the same concert.
--
-- IMPORTANT SECURITY RULE:
-- Creating a conversation requires verifying mutual likes
-- in the backend. The frontend cannot bypass this check.

CREATE TABLE IF NOT EXISTS conversations (

    id TEXT PRIMARY KEY,

    concert_id TEXT NOT NULL
        REFERENCES concerts(id)
        ON DELETE CASCADE,

    user_a_id TEXT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    user_b_id TEXT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    created_at TEXT NOT NULL
        DEFAULT (datetime('now')),

    UNIQUE (concert_id, user_a_id, user_b_id),

    CHECK (user_a_id < user_b_id)

);



-- ============================================================
-- TABLE: MESSAGES
-- Improvement #7 - Kaki Finder messaging
-- ============================================================
--
-- PURPOSE:
-- Stores messages sent inside a Kaki conversation.
--
-- RELATIONSHIPS:
-- Each message belongs to one conversation.
-- Each message has one sending user.
--
-- SECURITY RULE:
-- The backend must check that the sender belongs to the
-- conversation before allowing a new message.
--
-- LIMIT:
-- Each message must contain between 1 and 2000 characters.
-- Additional input validation is still required in Express.

CREATE TABLE IF NOT EXISTS messages (

    id TEXT PRIMARY KEY,

    conversation_id TEXT NOT NULL
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    sender_user_id TEXT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    body TEXT NOT NULL
        CHECK (length(body) BETWEEN 1 AND 2000),

    created_at TEXT NOT NULL
        DEFAULT (datetime('now')),

    -- Quoted reply. ON DELETE SET NULL rather than CASCADE: deleting the
    -- quoted message must not take the reply with it, or one person could
    -- erase another person's messages by deleting their own.
    reply_to_message_id TEXT
        REFERENCES messages(id)
        ON DELETE SET NULL,

    -- Set the first time the sender edits. Its presence is what the interface
    -- shows as "edited"; the original text is deliberately not kept, matching
    -- what mainstream chat apps do.
    edited_at TEXT,

    -- SOFT delete. The row and its body stay, but the API returns a tombstone
    -- instead of the text. Two reasons it is not a real DELETE:
    --   1. A harassing message must survive the sender deleting it, or
    --      "send abuse, delete, deny" defeats the report system entirely.
    --   2. Replies that quote it keep something to point at.
    -- Only operators reviewing a report ever see the retained body.
    deleted_at TEXT

);


-- ============================================================
-- TABLE: CONVERSATION SETTINGS
-- Per-viewer chat appearance
-- ============================================================
--
-- Deliberately keyed by (conversation, user) rather than stored on the
-- conversation itself: a chat background is a personal preference, so one
-- person restyling the thread must not change what the other person sees.

CREATE TABLE IF NOT EXISTS conversation_settings (

    conversation_id TEXT NOT NULL
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    user_id TEXT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    background TEXT NOT NULL DEFAULT 'default',

    updated_at TEXT NOT NULL
        DEFAULT (datetime('now')),

    PRIMARY KEY (conversation_id, user_id)

);



-- Speeds up retrieving messages from one conversation.
-- The timestamp helps when displaying them chronologically.

CREATE INDEX IF NOT EXISTS idx_messages_conversation
ON messages(conversation_id, created_at);



-- ============================================================
-- TABLE: SAVED TICKETS
-- Improvement #10 - Account-backed saved listings
-- ============================================================
--
-- PURPOSE:
-- Allows a logged-in user to save ticket listings.
--
-- CURRENT LIMITATION:
-- Browser localStorage does not synchronize saved tickets
-- across different devices.
--
-- IMPROVEMENT:
-- Saved tickets are now associated with a database user ID.
--
-- COMPOSITE PRIMARY KEY:
-- Prevents saving the same ticket twice for one user.
--
-- RELATIONSHIPS:
-- One user can save many tickets.
-- One ticket can be saved by many users.
--
-- This is a many-to-many relationship implemented
-- using a junction table.

CREATE TABLE IF NOT EXISTS saved_tickets (

    user_id TEXT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    ticket_id TEXT NOT NULL
        REFERENCES tickets(id)
        ON DELETE CASCADE,

    saved_at TEXT NOT NULL
        DEFAULT (datetime('now')),

    PRIMARY KEY (user_id, ticket_id)

);



-- ============================================================
-- TABLE: TICKET INQUIRIES
-- Improvement #10 - Ticket Marketplace
-- ============================================================
--
-- PURPOSE:
-- Lets buyers contact sellers about ticket listings
-- without implementing payment processing.
--
-- EXAMPLE:
-- Alex sees Jamie's ticket listing.
-- Alex submits an inquiry.
-- Jamie sees the inquiry in their seller dashboard.
--
-- RULE:
-- One buyer may have one inquiry record per listing.
-- This can later be extended into a full conversation.
--
-- SECURITY:
-- The buyer's identity must come from the authenticated
-- session, not from a user ID submitted by the browser.

CREATE TABLE IF NOT EXISTS ticket_inquiries (

    id TEXT PRIMARY KEY,

    ticket_id TEXT NOT NULL
        REFERENCES tickets(id)
        ON DELETE CASCADE,

    buyer_user_id TEXT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    body TEXT NOT NULL
        CHECK (length(body) BETWEEN 1 AND 1000),

    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'closed')),

    created_at TEXT NOT NULL
        DEFAULT (datetime('now')),

    UNIQUE (ticket_id, buyer_user_id)

);



-- Helps the seller retrieve inquiries for a listing.

CREATE INDEX IF NOT EXISTS idx_ticket_inquiries_ticket
ON ticket_inquiries(ticket_id, created_at);



-- ============================================================
-- TABLE: REPORTS
-- Improvement #15 - User reporting
-- ============================================================
--
-- PURPOSE:
-- Records concerns about user behaviour for operator review.
--
-- EXAMPLE:
-- A user reports a misleading profile or inappropriate
-- communication.
--
-- PRIVACY:
-- Only the reporter and authorized operators should be able
-- to access information permitted by the reporting workflow.
--
-- STATUS:
-- open     = waiting for review
-- reviewed = operator has examined the report
-- closed   = review process has concluded
--
-- Reporting must not automatically be interpreted as proof
-- that a user did anything wrong.

CREATE TABLE IF NOT EXISTS reports (

    id TEXT PRIMARY KEY,

    reporter_user_id TEXT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    reported_user_id TEXT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    reason_category TEXT NOT NULL
        CHECK (
            reason_category IN (
                'harassment',
                'misleading_profile',
                'spam',
                'other'
            )
        ),

    details TEXT NOT NULL
        CHECK (length(details) BETWEEN 1 AND 1000),

    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN (
            'open',
            'reviewed',
            'closed'
        )),

    created_at TEXT NOT NULL
        DEFAULT (datetime('now')),

    -- What the report is about, when it came from a chat. Both nullable so a
    -- profile can still be reported from outside a conversation. ON DELETE
    -- SET NULL keeps the report alive even if the thread is removed — losing
    -- the report along with the evidence would be the wrong way round.
    conversation_id TEXT
        REFERENCES conversations(id)
        ON DELETE SET NULL,

    message_id TEXT
        REFERENCES messages(id)
        ON DELETE SET NULL,

    CHECK (reporter_user_id <> reported_user_id)

);



-- Helps operators retrieve outstanding reports efficiently.

CREATE INDEX IF NOT EXISTS idx_reports_status
ON reports(status, created_at);
