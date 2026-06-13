const cache = new Map();
let lastNominatimRequest = 0;

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Geokodowanie HTTP ${response.status}`);
  return response.json();
}

export async function searchPlaces(query) {
  const clean = String(query ?? "").trim();
  if (clean.length < 2) return [];
  const key = `search:${clean.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  const params = new URLSearchParams({ name: clean, count: "8", language: "pl", format: "json" });
  const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  const results = (data.results ?? []).map((place) => ({
    city: place.name,
    label: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    latitude: place.latitude,
    longitude: place.longitude
  }));
  cache.set(key, results);
  return results;
}

export async function reversePlace(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Nieprawidłowe współrzędne");
  const key = `reverse:${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key);
  const wait = Math.max(0, 1050 - (Date.now() - lastNominatimRequest));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimRequest = Date.now();
  const params = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lon), zoom: "10", addressdetails: "1", "accept-language": "pl" });
  const data = await fetchJson(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    "User-Agent": "EndoDeck/1.1 (+https://github.com/Kejlo523/endodeck)",
    "Accept-Language": "pl"
  });
  const address = data.address ?? {};
  const city = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? "Wybrana lokalizacja";
  const result = { city, label: data.display_name ?? city, latitude: lat, longitude: lon };
  cache.set(key, result);
  return result;
}
