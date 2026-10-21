/** Local comparison state. These choices never change server preference rankings. */
export function createComparison(groups) {
  const seen = new Set();
  const snapshot = groups.filter(group => {
    if (!group || group.id == null || seen.has(group.id)) return false;
    seen.add(group.id);
    return true;
  }).map(group => ({ ...group }));
  return {
    groups: snapshot,
    slots: [snapshot[0] ?? null, snapshot[1] ?? null],
    nextIndex: Math.min(2, snapshot.length),
    skippedIds: [],
    favoriteId: null,
  };
}

/** Replace only the dismissed position, so a retained card never changes sides. */
export function skipComparisonGroup(state, slot) {
  const group = state.slots[slot];
  if (!group || (slot !== 0 && slot !== 1)) return state;
  const slots = [...state.slots];
  slots[slot] = state.groups[state.nextIndex] ?? null;
  return {
    ...state,
    slots,
    nextIndex: Math.min(state.groups.length, state.nextIndex + 1),
    skippedIds: [...state.skippedIds, group.id],
    favoriteId: state.favoriteId === group.id ? null : state.favoriteId,
  };
}

export function preferComparisonGroup(state, slot) {
  const group = state.slots[slot];
  if (!group || (slot !== 0 && slot !== 1)) return state;
  const next = skipComparisonGroup(state, 1 - slot);
  return { ...next, favoriteId: group.id };
}

/** Refresh current card details without changing the session's candidates or order. */
export function refreshComparisonGroups(state, groups) {
  const latest = new Map(groups.filter(Boolean).map(group => [group.id, group]));
  const snapshot = state.groups.filter(group => latest.has(group.id)).map(group => ({ ...group, ...latest.get(group.id) }));
  const byId = new Map(snapshot.map(group => [group.id, group]));
  let nextIndex = state.groups.slice(0, state.nextIndex).filter(group => latest.has(group.id)).length;
  const slots = state.slots.map(group => group ? byId.get(group.id) ?? null : null);
  for (let slot = 0; slot < slots.length; slot++) {
    if (!slots[slot] && snapshot[nextIndex]) slots[slot] = snapshot[nextIndex++];
  }
  return {
    ...state,
    groups: snapshot,
    slots,
    nextIndex,
    skippedIds: state.skippedIds.filter(id => byId.has(id)),
    favoriteId: slots.some(group => group?.id === state.favoriteId) ? state.favoriteId : null,
  };
}
