/**
 * Irving's algorithm for the Stable Roommates problem.
 *
 * Used for PEER-TO-PEER mode, where every participant is symmetric — nobody holds
 * tickets, everyone simply wants one companion. That instance is NOT bipartite, so
 * Gale-Shapley does not apply, and unlike Hospital/Residents a stable matching is
 * NOT guaranteed to exist.
 *
 * Phase 1 — a proposal sequence that reduces each preference table.
 * Phase 2 — repeated elimination of "rotations", cyclic structures that must be
 *           unwound before a stable matching can be read off.
 *
 * Reference: Irving, R.W. (1985), "An efficient algorithm for the stable roommates
 * problem", Journal of Algorithms 6(4).
 *
 * See docs/ALGORITHM.md §7.
 */

/**
 * @param {Map<string, string[]>} preferences  participantId -> ordered participantIds
 * @returns {{
 *   stable: boolean,
 *   pairs: Array<[string,string]>,
 *   unmatched: string[],
 *   reason?: string,
 *   phases: object
 * }}
 */
export function stableRoommates(preferences) {
  const ids = [...preferences.keys()].sort();

  // rank[a].get(b) = position of b in a's list; absent means mutually unacceptable.
  const rank = new Map();
  for (const id of ids) {
    const map = new Map();
    (preferences.get(id) ?? []).forEach((other, index) => map.set(other, index));
    rank.set(id, map);
  }

  // Working copy of the tables, reduced as the algorithm proceeds.
  const table = new Map();
  for (const id of ids) {
    table.set(id, [...(preferences.get(id) ?? [])].filter((other) => rank.get(other)?.has(id)));
  }

  const phase1 = runPhase1(ids, table, rank);
  if (!phase1.ok) {
    return {
      stable: false,
      pairs: [],
      unmatched: ids,
      reason: phase1.reason,
      phases: { phase1: phase1.stats },
    };
  }

  const phase2 = runPhase2(ids, table, rank);
  if (!phase2.ok) {
    return {
      stable: false,
      pairs: [],
      unmatched: ids,
      reason: phase2.reason,
      phases: { phase1: phase1.stats, phase2: phase2.stats },
    };
  }

  // Every surviving table should hold exactly one entry, and pairings must be mutual.
  const pairs = [];
  const seen = new Set();
  const unmatched = [];

  for (const id of ids) {
    const list = table.get(id);
    if (list.length === 0) {
      unmatched.push(id);
      continue;
    }
    if (list.length !== 1) {
      return {
        stable: false,
        pairs: [],
        unmatched: ids,
        reason: `table_not_reduced_to_singleton:${id}`,
        phases: { phase1: phase1.stats, phase2: phase2.stats },
      };
    }
    const partner = list[0];
    if (table.get(partner)?.[0] !== id) {
      return {
        stable: false,
        pairs: [],
        unmatched: ids,
        reason: `asymmetric_pairing:${id}<>${partner}`,
        phases: { phase1: phase1.stats, phase2: phase2.stats },
      };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    seen.add(partner);
    pairs.push([id, partner].sort());
  }

  return {
    stable: true,
    pairs: pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    unmatched,
    phases: { phase1: phase1.stats, phase2: phase2.stats },
  };
}

// ---------------------------------------------------------------------------
// Phase 1 — proposal and reduction
// ---------------------------------------------------------------------------

function runPhase1(ids, table, rank) {
  /** proposedTo.get(a) = whoever currently holds a's proposal */
  const holder = new Map(); // b -> a, meaning b holds a proposal from a
  const proposedBy = new Map(); // a -> b, meaning a's proposal sits with b

  const free = [...ids];
  let proposals = 0;

  while (free.length > 0) {
    const proposer = free.shift();
    if (proposedBy.has(proposer)) continue;

    const list = table.get(proposer);
    if (list.length === 0) {
      return { ok: false, reason: `phase1_empty_table:${proposer}`, stats: { proposals } };
    }

    let placed = false;
    for (const target of list) {
      proposals += 1;
      const current = holder.get(target);

      if (current === undefined) {
        holder.set(target, proposer);
        proposedBy.set(proposer, target);
        placed = true;
        break;
      }

      // The target keeps whichever proposal it prefers.
      if (rank.get(target).get(proposer) < rank.get(target).get(current)) {
        holder.set(target, proposer);
        proposedBy.set(proposer, target);
        proposedBy.delete(current);
        free.push(current);
        placed = true;
        break;
      }
    }

    if (!placed) {
      return { ok: false, reason: `phase1_all_rejected:${proposer}`, stats: { proposals } };
    }

    // Reduction: once `target` holds a proposal from `proposer`, everyone that
    // `target` ranks BELOW `proposer` can never pair with it. Remove those edges.
    const target = proposedBy.get(proposer);
    const targetList = table.get(target);
    const cutoff = rank.get(target).get(proposer);
    const doomed = targetList.filter((other) => rank.get(target).get(other) > cutoff);

    for (const other of doomed) {
      removeEdge(table, target, other);
      // If that eviction leaves `other` holding nothing, it must propose again.
      if (proposedBy.get(other) === target) {
        proposedBy.delete(other);
        if (holder.get(target) === other) holder.delete(target);
        free.push(other);
      }
    }
  }

  for (const id of ids) {
    if (table.get(id).length === 0) {
      return { ok: false, reason: `phase1_reduced_to_empty:${id}`, stats: { proposals } };
    }
  }

  return { ok: true, stats: { proposals } };
}

// ---------------------------------------------------------------------------
// Phase 2 — rotation elimination
// ---------------------------------------------------------------------------

/**
 * A rotation is a sequence (a0,b0), (a1,b1), ... where b_i is a_i's FIRST remaining
 * choice and a_{i+1} is b_i's LAST remaining choice. Eliminating it removes the
 * pairs (b_i, a_{i+1}), which is the only way to break the cyclic stalemate that
 * survives phase 1.
 */
function runPhase2(ids, table, rank) {
  let eliminated = 0;
  const guard = ids.length * ids.length + 10; // loop bound; each elimination shrinks tables

  for (let iteration = 0; iteration < guard; iteration += 1) {
    const pivot = ids.find((id) => table.get(id).length > 1);
    if (pivot === undefined) {
      return { ok: true, stats: { rotationsEliminated: eliminated } };
    }

    const rotation = findRotation(pivot, table);
    if (!rotation) {
      return {
        ok: false,
        reason: 'phase2_no_rotation_found',
        stats: { rotationsEliminated: eliminated },
      };
    }

    for (let i = 0; i < rotation.length; i += 1) {
      const b = rotation[i].b;
      const nextA = rotation[(i + 1) % rotation.length].a;
      removeEdge(table, b, nextA);
    }
    eliminated += 1;

    for (const id of ids) {
      if (table.get(id).length === 0) {
        return {
          ok: false,
          reason: `phase2_table_emptied:${id}`,
          stats: { rotationsEliminated: eliminated },
        };
      }
    }
  }

  return { ok: false, reason: 'phase2_iteration_limit', stats: { rotationsEliminated: eliminated } };
}

function findRotation(start, table) {
  const sequence = [];
  const seenIndex = new Map();
  let a = start;

  for (let steps = 0; steps < table.size * 2 + 5; steps += 1) {
    if (seenIndex.has(a)) {
      // Found the cycle: discard the tail leading into it.
      return sequence.slice(seenIndex.get(a));
    }
    seenIndex.set(a, sequence.length);

    const listA = table.get(a);
    if (!listA || listA.length === 0) return null;
    const b = listA[0]; // a's first remaining choice

    const listB = table.get(b);
    if (!listB || listB.length === 0) return null;
    const nextA = listB[listB.length - 1]; // b's last remaining choice

    sequence.push({ a, b });
    a = nextA;
  }
  return null;
}

function removeEdge(table, x, y) {
  const listX = table.get(x);
  const ix = listX.indexOf(y);
  if (ix !== -1) listX.splice(ix, 1);

  const listY = table.get(y);
  const iy = listY.indexOf(x);
  if (iy !== -1) listY.splice(iy, 1);
}

/**
 * Independent verification: does any pair of participants both prefer each other
 * to their assigned partners?
 */
export function findRoommateBlockingPairs(preferences, pairs, unmatched = []) {
  const partner = new Map();
  for (const [a, b] of pairs) {
    partner.set(a, b);
    partner.set(b, a);
  }
  for (const id of unmatched) partner.set(id, null);

  const rank = new Map();
  for (const [id, list] of preferences) {
    const map = new Map();
    list.forEach((other, index) => map.set(other, index));
    rank.set(id, map);
  }

  const blocking = [];
  const ids = [...preferences.keys()];

  for (const a of ids) {
    const listA = preferences.get(a) ?? [];
    const currentA = partner.get(a);
    const rankOfCurrentA = currentA == null ? Infinity : rank.get(a).get(currentA);

    for (const b of listA) {
      if (b === currentA) continue;
      const rankOfB = rank.get(a).get(b);
      if (rankOfB >= rankOfCurrentA) break; // list is ordered; nothing better remains

      const currentB = partner.get(b);
      const rankOfCurrentB = currentB == null ? Infinity : rank.get(b).get(currentB);
      const rankOfA = rank.get(b)?.get(a);
      if (rankOfA === undefined) continue; // a is unacceptable to b

      if (rankOfA < rankOfCurrentB) {
        const key = [a, b].sort().join('|');
        if (!blocking.some((p) => p.key === key)) blocking.push({ key, a, b });
      }
    }
  }

  return { stable: blocking.length === 0, blockingPairs: blocking };
}
