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
  created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

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
