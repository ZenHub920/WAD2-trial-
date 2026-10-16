/** Shared, pure filtering keeps the two discovery screens consistent. */
export function filterGroups(groups, filters = {}) {
  const query = (filters.query ?? '').trim().toLowerCase();
  const result = groups.filter(g =>
    (!query || [g.artist, g.tourName, g.hostName, g.notes].filter(Boolean).join(' ').toLowerCase().includes(query))
    && (!filters.section || g.section === filters.section)
    && (!filters.minCapacity || g.remainingCapacity >= Number(filters.minCapacity))
    && (!filters.spendBand || g.spendBand === Number(filters.spendBand))
    && (!filters.arrival || g.arrivalPlan === filters.arrival)
    && (!filters.activity || g.plans?.[filters.activity])
    && (!filters.vibe || Number(g.vibe?.[filters.vibe]) > 0)
    && (!filters.preferredOnly || g.preferred));
  return result.sort((a, b) => {
    const difference = filters.sort === 'capacity' ? b.remainingCapacity - a.remainingCapacity
      : filters.sort === 'host' ? a.hostName.localeCompare(b.hostName)
        : (b.compatibility ?? -1) - (a.compatibility ?? -1);
    return difference || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
