/**
 * Loads the Google Maps JavaScript API once, on first use, with the Places
 * library. The key comes from VITE_GOOGLE_MAPS_API_KEY (client/.env.local,
 * which is not committed). Without a key, `googleMapsEnabled` is false and
 * callers keep their existing OneMap search.
 */
const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
export const googleMapsEnabled = Boolean(key);

let loading = null;
/** Any Maps library ('maps', 'marker', 'places'…) once the API script has loaded. */
export async function loadLibrary(name) {
  await loadPlaces();
  return window.google.maps.importLibrary(name);
}
export function loadPlaces() {
  if (!googleMapsEnabled) return Promise.reject(new Error('google_maps_not_configured'));
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      if (window.google?.maps?.importLibrary) { resolve(); return; }
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__encoreMapsReady`;
      script.async = true;
      window.__encoreMapsReady = () => resolve();
      script.onerror = () => reject(new Error('google_maps_unavailable'));
      document.head.append(script);
    }).then(() => window.google.maps.importLibrary('places'))
      .catch((error) => { loading = null; console.warn('Google Maps could not load:', error?.message ?? error); throw error; });
  }
  return loading;
}
