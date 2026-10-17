import { distanceKm } from "./meetupPlanning.js";
export function createMeetupWeather({
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  let cached = null,
    expires = 0,
    pending = null;
  const retrieve = async () => {
    if (cached && expires > now()) return cached;
    if (!pending)
      pending = (async () => {
        const res = await fetchImpl(
          "https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast",
          {
            signal: AbortSignal.timeout(5000),
            headers: process.env.DATA_GOV_SG_API_KEY
              ? { "x-api-key": process.env.DATA_GOV_SG_API_KEY }
              : {},
          },
        );
        if (!res.ok) throw new Error("weather_provider_unavailable");
        const data = await res.json();
        if (
          data.code !== 0 ||
          !Array.isArray(data.data?.area_metadata) ||
          !Array.isArray(data.data?.items)
        )
          throw new Error("invalid_weather_response");
        cached = data.data;
        expires = now() + 5 * 60000;
        return cached;
      })().finally(() => {
        pending = null;
      });
    return pending;
  };
  return {
    async forecast({ latitude, longitude, startsAt }) {
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < 1.1 ||
        latitude > 1.5 ||
        longitude < 103.5 ||
        longitude > 104.1
      )
        return {
          status: "unavailable",
          reason: "outside_singapore_forecast_area",
        };
      if (
        !Number.isFinite(startsAt) ||
        startsAt < now() - 30 * 60000 ||
        startsAt > now() + 2 * 3600000
      )
        return {
          status: "unavailable",
          reason: "outside_short_range_forecast_window",
        };
      try {
        const data = await retrieve();
        const item = data.items
          .filter(
            (i) =>
              Date.parse(i.valid_period?.start) <= startsAt &&
              Date.parse(i.valid_period?.end) >= startsAt + 30 * 60000,
          )
          .sort(
            (a, b) =>
              Date.parse(b.update_timestamp) - Date.parse(a.update_timestamp),
          )[0];
        if (!item)
          return {
            status: "unavailable",
            reason: "meeting_not_covered_by_forecast",
          };
        const area = [...data.area_metadata].sort(
          (a, b) =>
            distanceKm({ latitude, longitude }, a.label_location) -
            distanceKm({ latitude, longitude }, b.label_location),
        )[0];
        const forecast = item.forecasts.find(
          (f) => f.area === area?.name,
        )?.forecast;
        if (typeof forecast !== "string")
          return { status: "unavailable", reason: "area_forecast_missing" };
        const rainWarning = /rain|shower|thunder/i.test(forecast);
        return {
          status: "available",
          provider: "NEA via data.gov.sg",
          area: area.name,
          forecast,
          rainWarning,
          validPeriod: item.valid_period,
          updatedAt: item.update_timestamp,
          message: rainWarning
            ? "Rain or thunderstorms are forecast; discuss a sheltered meeting place."
            : "No rain indicated in this short-range forecast; conditions can change.",
        };
      } catch {
        return {
          status: "unavailable",
          reason: "weather_provider_unavailable",
        };
      }
    },
  };
}
