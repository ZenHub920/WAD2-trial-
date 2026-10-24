import { providerJson } from './providerCache.js';
const DISCOVERY_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

/** Return concert fields understood by encore, not a provider-specific response body. */
export function normalizeTicketmasterEvent(event) {
  const id = event?.id;
  const date = event?.dates?.start?.localDate;
  const venue = event?._embedded?.venues?.[0];
  if (typeof id !== 'string' || !id || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    || typeof venue?.name !== 'string' || !venue.name.trim()
    || typeof venue?.city?.name !== 'string' || !venue.city.name.trim()) {
    return null;
  }
  if (venue.country?.countryCode && venue.country.countryCode !== 'SG') return null;

  const images = Array.isArray(event.images) ? event.images : [];
  // Ticketmaster lists several sizes of each image; take the widest so cards stay sharp.
  const usable = images.filter((item) => item && !item.fallback && item.url)
    .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
  const image = usable.find((item) => item.ratio === '16_9') ?? usable[0];
  const attraction = event._embedded?.attractions?.[0];
  const artist = attraction?.name || event.name;
  if (typeof artist !== 'string' || !artist.trim()) return null;

  return {
    id: `tm_${id}`,
    source: 'ticketmaster',
    source_event_id: id,
    artist,
    tour_name: event.name && event.name !== artist ? event.name : null,
    blurb: [event.description, event.info, event.additionalInfo, attraction?.description, attraction?.additionalInfo]
      .find((text) => typeof text === 'string' && text.trim())?.trim() ?? null,
    venue: venue.name,
    city: venue.city.name,
    event_date: date,
    event_time: typeof event?.dates?.start?.localTime === 'string' ? event.dates.start.localTime : null,
    event_timezone: typeof event?.dates?.timezone === 'string' ? event.dates.timezone : venue.timezone ?? 'Asia/Singapore',
    provider_status: event?.dates?.status?.code ?? 'onsale',
    venue_latitude: Number.isFinite(Number(venue?.location?.latitude)) ? Number(venue.location.latitude) : null,
    venue_longitude: Number.isFinite(Number(venue?.location?.longitude)) ? Number(venue.location.longitude) : null,
    hero_image_url: httpsUrl(image?.url),
    image_attribution: image?.attribution || null,
    official_url: httpsUrl(event.url),
    seatmap_url: httpsUrl(event.seatmap?.staticUrl),
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
  maxPages = 3,
} = {}) {
  if (!apiKey) throw new Error('TICKETMASTER_API_KEY is required');
  if (url !== DISCOVERY_URL) throw new Error('invalid_concert_provider_url');
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

  const events = new Map();
  for (let page = 0; page < Math.min(10, Math.max(1, maxPages)); page++) {
    requestUrl.searchParams.set('page', String(page));
    const data = await providerJson((target, options) => fetchImpl(new URL(target), options), requestUrl);
    for (const raw of data?._embedded?.events ?? []) {
      const event = normalizeTicketmasterEvent(raw);
      if (event) events.set(event.id, event);
    }
    if (page + 1 >= (data?.page?.totalPages ?? 1)) break;
  }
  return [...events.values()];
}
