const DISCOVERY_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

/** Return concert fields understood by Encore, not a provider-specific response body. */
export function normalizeTicketmasterEvent(event) {
  const id = event?.id;
  const date = event?.dates?.start?.localDate;
  const venue = event?._embedded?.venues?.[0];
  if (typeof id !== 'string' || !id || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !venue?.name || !venue?.city?.name) {
    return null;
  }
  if (venue.country?.countryCode && venue.country.countryCode !== 'SG') return null;

  const image = event.images?.find((item) => item.ratio === '16_9' && !item.fallback)
    ?? event.images?.find((item) => !item.fallback);
  const artist = event._embedded?.attractions?.[0]?.name || event.name;
  if (!artist) return null;

  return {
    id: `tm_${id}`,
    source: 'ticketmaster',
    source_event_id: id,
    artist,
    tour_name: event.name && event.name !== artist ? event.name : null,
    venue: venue.name,
    city: venue.city.name,
    event_date: date,
    hero_image_url: httpsUrl(image?.url),
    image_attribution: image?.attribution || null,
    official_url: httpsUrl(event.url),
  };
}

function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Search upcoming Singapore music events; the API key never leaves the server. */
export async function searchTicketmaster({
  apiKey = process.env.TICKETMASTER_API_KEY,
  keyword,
  fetchImpl = fetch,
  url = DISCOVERY_URL,
  now = new Date(),
} = {}) {
  if (!apiKey) throw new Error('TICKETMASTER_API_KEY is required');
  const requestUrl = new URL(url);
  requestUrl.search = new URLSearchParams({
    apikey: apiKey,
    countryCode: 'SG',
    classificationName: 'music',
    startDateTime: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    sort: 'date,asc',
    size: '50',
    ...(keyword ? { keyword } : {}),
  });

  const response = await fetchImpl(requestUrl, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Ticketmaster returned HTTP ${response.status}`);
  const data = await response.json();
  return (data?._embedded?.events ?? [])
    .map(normalizeTicketmasterEvent)
    .filter((event) => event !== null);
}
