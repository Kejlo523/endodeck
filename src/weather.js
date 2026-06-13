let cache = { key: "", expires: 0, data: null };

export async function getWeather(settings = {}) {
  const latitude = Number(settings.latitude ?? 52.2297);
  const longitude = Number(settings.longitude ?? 21.0122);
  const city = String(settings.city ?? "Warszawa");
  const key = `${latitude},${longitude}`;
  if (cache.key === key && cache.data && cache.expires > Date.now()) return cache.data;

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    timezone: "auto",
    forecast_days: "7"
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Pogoda HTTP ${response.status}`);
  const raw = await response.json();
  const daily = raw.daily.time.map((date, index) => ({
    date,
    code: raw.daily.weather_code[index],
    max: Math.round(raw.daily.temperature_2m_max[index]),
    min: Math.round(raw.daily.temperature_2m_min[index]),
    rain: raw.daily.precipitation_probability_max[index] ?? 0,
    sunrise: raw.daily.sunrise[index],
    sunset: raw.daily.sunset[index]
  }));
  const data = {
    city,
    latitude,
    longitude,
    timezone: raw.timezone,
    utcOffsetSeconds: raw.utc_offset_seconds ?? 0,
    current: {
      temperature: Math.round(raw.current.temperature_2m),
      apparent: Math.round(raw.current.apparent_temperature),
      code: raw.current.weather_code,
      wind: Math.round(raw.current.wind_speed_10m)
    },
    daily
  };
  cache = { key, expires: Date.now() + 15 * 60_000, data };
  return data;
}
