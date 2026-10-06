# Encore — Matching Algorithm Specification

This document defines the matching problem, the algorithm used to solve it, and the
correctness properties we claim. It is written to be read *before* the code.

---

## 1. The problem

Concert-goers frequently end up not attending events they want to attend, because the
people in their social circle do not share the artist. The secondary market solves ticket
*supply* but does nothing about companionship, and generic "find a buddy" forums produce
first-come-first-served chaos: the fastest responder wins, not the best fit.

**Encore matches concert-goers into parties for a specific event.**

### 1.1 Why this is bipartite (and why that matters)

Gale-Shapley solves the **Stable Marriage Problem**, which requires two *disjoint* sets of
agents. A naive "match any concert-goer with any other concert-goer" formulation is **not**
bipartite — it is the **Stable Roommates Problem**, which Gale-Shapley cannot solve and
which is not even guaranteed to *have* a stable matching.

We therefore model the domain with a genuine two-sided structure that exists in the real
scenario:

| Side | Who they are | Capacity |
|------|--------------|----------|
| **Party** (the "hospital") | A user who holds tickets — often because a friend dropped out — or who is forming a group and has `q` open slots | `q >= 1` |
| **Seeker** (the "resident") | A user looking to join exactly one party for that concert | `1` |

This is the **Hospital/Residents problem** (HR), the many-to-one generalisation of stable
marriage. It retains every guarantee of Gale-Shapley:

- A stable matching **always exists**.
- Deferred acceptance **finds one** in time linear in the number of acceptable pairs.
- The seeker-proposing version is **seeker-optimal**: every seeker gets the best partner
  they could have in *any* stable matching.

A peer-to-peer mode (no host/seeker split) is also implemented via **Irving's algorithm**
for stable roommates — see §7.

---

## 2. Agents and data

### 2.1 User profile

```
id, display_name, age_band ∈ {18-20, 21-24, 25-29, 30-34, 35+}
home_region                        -- coarse geography, for transport sharing
languages[]
gender, companion_gender_pref ∈ {any, same_only}
vibe: {singalong, photography, dancing, quiet, queue_early, merch} each ∈ [0,5]
reliability ∈ [0,1]                -- derived from completed / no-show history
verified ∈ {0,1}
```

### 2.2 Party listing

```
id, host_user_id, concert_id, capacity q
section ∈ {pit, ga_standing, lower_bowl, upper_bowl, seated_any}
spend_band ∈ {1,2,3,4}             -- expected total spend incl. extras
arrival_plan ∈ {early_queue, mid, doors}
plans: {pre_meetup, post_supper, merch_run, transport_share}
min_age_band, strict_age_policy
```

### 2.3 Seeker request

```
id, user_id, concert_id
section_pref, spend_band_max, arrival_pref
plans_wanted: {...}
```

---

## 3. Hard constraints (feasibility gate)

A pair `(s, p)` is **mutually acceptable** only if *all* of the following hold. A pair
failing any of these appears on **neither** preference list — the lists are *incomplete*,
which HR handles natively.

1. `s.concert_id == p.concert_id`
2. `s.user_id != p.host_user_id` (no self-match)
3. **Affordability**: `s.spend_band_max >= p.spend_band`
4. **Gender preference**, checked in both directions: if either side set `same_only`, the
   genders must agree.
5. **Age policy**: if either side set `strict_age_policy`, the other's age band must fall
   within the stated tolerance.
6. Neither user appears on the other's blocklist.

Constraints 4–6 are not decoration. A companion-matching product without them is unsafe,
and they are what make the preference lists *incomplete* rather than complete permutations —
which is precisely the case the HR variant is designed for.

---

## 4. Deriving preference lists

Users do not rank hundreds of strangers by hand. The system **computes** each side's
ordering from a weighted compatibility score. This is the part of the backend that turns a
textbook algorithm into a product.

For a feasible pair `(s, p)` we compute seven normalised components in `[0,1]`:

| Component | Definition |
|-----------|-----------|
| `section` | exact section match = 1.0; adjacent tier = 0.6; otherwise 0.2 |
| `vibe` | cosine similarity of the two 6-dimensional vibe vectors |
| `arrival` | 1.0 same plan, 0.5 adjacent, 0.0 opposite ends |
| `plans` | Jaccard index of the desired-activity sets |
| `language` | 1.0 if any shared language, else 0.0 |
| `region` | 1.0 same region, 0.5 adjacent, 0.2 otherwise |
| `reliability` | counterpart's reliability score, `+0.1` if verified (capped at 1) |
| `budget_fit` | `1 - (s.spend_band_max - p.spend_band) / 3`, rewarding a close fit |

### 4.1 Directional weights

The two sides care about different things, so the weight vectors differ:

```
SEEKER→PARTY   section .22  vibe .24  arrival .12  plans .14
               language .08  region .06  reliability .10  budget_fit .04

PARTY→SEEKER   section .12  vibe .22  arrival .10  plans .12
               language .08  region .06  reliability .26  budget_fit .04
```

A party is exposing tickets and bears the no-show risk, so `reliability` dominates its
ranking; a seeker is buying an experience, so `section` and `vibe` dominate theirs.

**This asymmetry is essential.** If both sides ranked by the same symmetric score, every
agent would agree on the ordering, the instance would be trivial, and there would be exactly
one stable matching reachable by greedy assignment. The asymmetry is what makes the
instance a genuine stable-matching problem with the possibility of preference cycles and
blocking pairs.

### 4.2 Tie-breaking

Scores are rounded to 6 decimal places and ties broken by ascending entity id. Ordering is
therefore **total and deterministic**, which keeps runs reproducible and keeps us in the
strict-preference regime where HR's guarantees apply without the weak/strong/super-stability
complications that ties introduce.

---

## 5. The algorithm — seeker-proposing deferred acceptance

```
for each seeker s:  pref[s] = feasible parties, descending score
for each party  p:  rank[p][s] = position of s in p's ordering    -- O(1) lookup

free ← queue of all seekers with a non-empty preference list
while free is not empty:
    s ← free.pop()
    if s has exhausted pref[s]:  s is unmatched; continue
    p ← pref[s][ s.next++ ]

    if |assigned[p]| < capacity[p]:
        assign s to p
    else:
        w ← the member of assigned[p] with the WORST rank under p
        if rank[p][s] < rank[p][w]:          -- p prefers s to w
            unassign w;  free.push(w)
            assign s to p
        else:
            free.push(s)                      -- s tries the next party
```

### 5.1 Implementation notes

- `rank[p]` is a `Map` from seeker id to position, built once. Without it, each
  "does p prefer s to w" test is a linear scan and the algorithm degrades to O(n²q).
- `assigned[p]` is a **max-heap keyed by rank**, so retrieving the worst member and
  evicting it are both `O(log q)`.
- Every seeker proposes to any given party at most once, so the loop runs at most once per
  acceptable pair. Total cost: **O(E log q)** where `E` is the number of acceptable pairs —
  effectively linear.

### 5.2 Termination

Each iteration advances exactly one seeker's pointer through their finite preference list,
and pointers never move backwards. The total work is bounded by `Σ|pref[s]| = E`, so the
loop terminates.

---

## 6. Stability — the correctness claim

A pair `(s, p)` **blocks** a matching `M` if all three hold:

1. `s` and `p` are mutually acceptable, and `(s,p) ∉ M`
2. `s` is unmatched, **or** `s` strictly prefers `p` to `M(s)`
3. `p` has a free slot, **or** `p` strictly prefers `s` to its worst current member

`M` is **stable** iff no blocking pair exists.

The verifier enumerates every acceptable pair and tests the three conditions, in `O(E)`.
It runs as an assertion after every match round and its result is stored with the round, so
every matching in the database carries a proof of its own stability.

Blocking pairs are the metric that separates this from a naive implementation: a greedy
assignment produces a matching with *higher total score* but with blocking pairs — real
pairs of users who would both rather abandon the system's suggestion and pair up privately.
That is a product failure, not just a theoretical one.

---

## 7. Peer-to-peer mode — Irving's stable roommates

When every participant is symmetric (no one holds tickets; everyone wants a partner), the
instance is no longer bipartite and Gale-Shapley does not apply. We implement **Irving's
algorithm**:

- **Phase 1** — a proposal sequence resembling Gale-Shapley, producing a reduced preference
  table.
- **Phase 2** — elimination of *rotations*, cyclic structures that must be resolved for
  stability.

Unlike HR, **a stable matching may not exist**; the algorithm detects this and reports it.
This is a genuine, demonstrable result rather than a failure, and the comparison between HR
(always solvable) and stable roommates (sometimes not) is a substantive finding for the
evaluation write-up.

---

## 8. Baselines for evaluation

| Baseline | Method | Expected behaviour |
|----------|--------|--------------------|
| **Greedy global** | Sort all feasible pairs by combined score, assign top-down while capacity remains | Highest total score, **non-zero blocking pairs** |
| **Random feasible** | Shuffle and assign arbitrarily among feasible pairs | Low score, many blocking pairs |
| **Gale-Shapley (HR)** | §5 | **Zero blocking pairs**, best achievable seeker ranks |

The headline result of the evaluation is that greedy wins on raw aggregate score and *loses*
on stability — which is exactly the argument for using deferred acceptance instead.

## 9. Metrics reported

- blocking pair count (the correctness metric)
- match rate — fraction of seekers placed
- mean/median rank achieved, per side
- fraction of seekers receiving their 1st / top-3 choice
- aggregate and mean compatibility score
- capacity utilisation
- wall-clock runtime at n ∈ {100, 500, 1000, 5000}
