/**
 * A stand-in for the Google Maps JavaScript API, served in place of
 * maps.googleapis.com during e2e runs (see `fakeGoogleMaps` in support.js).
 *
 * It covers only what GooglePlaceSearch uses. Typing returns one suggestion per
 * matching catalog place, or a suggestion named exactly what was typed, so a
 * test can type a landmark and pick it. `window.__fakeMapClick(lat, lng)` acts
 * like clicking an empty spot on the map.
 */
(() => {
  const catalog = [
    { name: 'City Hall MRT', address: '150 North Bridge Road', lat: 1.293, lng: 103.852 },
    { name: 'Stadium MRT Exit A', address: 'Stadium Walk', lat: 1.3029, lng: 103.8752 },
    { name: 'Singapore Indoor Stadium', address: '2 Stadium Walk', lat: 1.3003, lng: 103.8746 },
  ];
  const latLng = (lat, lng) => ({ lat: () => lat, lng: () => lng });
  function locate(name) {
    // A test can pin an exact spot for a name first (see pickPlace in support.js).
    const pinned = window.__fakeMapsPlaces?.[name];
    if (pinned) return { name, address: `${name}, Singapore`, ...pinned };
    const known = catalog.find(place => place.name.toLowerCase() === name.toLowerCase());
    if (known) return known;
    // Anything else gets a stable spot in Singapore derived from its name.
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return { name, address: `${name}, Singapore`, lat: 1.28 + (hash % 900) / 10000, lng: 103.8 + ((hash >>> 10) % 900) / 10000 };
  }
  class Place {
    constructor({ id }) { this.id = id; }
    async fetchFields() {
      const place = locate(this.id);
      Object.assign(this, { displayName: place.name, formattedAddress: place.address, location: latLng(place.lat, place.lng) });
    }
    static async searchNearby() { return { places: [{ displayName: 'Test landmark', formattedAddress: 'Singapore' }] }; }
  }
  const places = {
    AutocompleteSessionToken: class {},
    Place,
    AutocompleteSuggestion: {
      async fetchAutocompleteSuggestions({ input }) {
        const text = input.trim();
        const matches = catalog.filter(place => place.name.toLowerCase().includes(text.toLowerCase())).map(place => place.name);
        const names = matches.length ? matches : [text];
        return { suggestions: names.map(name => ({ placePrediction: {
          text: { text: name }, mainText: { text: name }, secondaryText: { text: locate(name).address },
          toPlace: () => new Place({ id: name }),
        } })) };
      },
    },
  };
  class Map {
    constructor(element) { this.zoom = 11; element.dataset.fakeMap = 'true'; }
    addListener(type, listener) {
      if (type === 'click') window.__fakeMapClick = (lat, lng) => listener({ latLng: latLng(lat, lng), stop() {} });
      return { remove() {} };
    }
    panTo() {}
    getZoom() { return this.zoom; }
    setZoom(zoom) { this.zoom = zoom; }
  }
  class Marker {
    setPosition(position) { this.position = position; }
    setVisible(visible) { this.visible = visible; }
  }
  const libraries = { places, maps: { Map }, marker: { Marker } };
  window.google = { maps: { importLibrary: async name => libraries[name] } };
  const callback = new URL(document.currentScript?.src ?? location.href).searchParams.get('callback') ?? '__encoreMapsReady';
  window[callback]?.();
})();
