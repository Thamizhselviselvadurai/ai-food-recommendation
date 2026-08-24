import { env } from '../../config/env.js';
import { coarsenLocation } from '../../utils/geo.js';

/**
 * Optional contextual signal. Never decisive on its own — it can nudge a soup
 * above a salad on a wet evening, nothing more.
 *
 * Providers:
 *  - `open-meteo`  free, keyless, no account. Default.
 *  - `openweather` requires OPENWEATHER_API_KEY.
 *  - `off`         disables the signal.
 *
 * Failures are swallowed and return null — weather is never allowed to break a
 * recommendation request.
 */

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();

const classify = (temperatureC, isRaining) => {
  if (isRaining) return 'rainy';
  if (temperatureC >= 33) return 'hot';
  if (temperatureC >= 28) return 'warm';
  if (temperatureC >= 22) return 'mild';
  if (temperatureC >= 16) return 'cool';
  return 'cold';
};

// WMO weather codes that mean precipitation (Open-Meteo).
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

export async function getWeather({ lat, lng }) {
  if (env.WEATHER_PROVIDER === 'off') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Cache on a coarse grid: we never need street-level weather, and it keeps
  // precise coordinates out of any cache key.
  const coarse = coarsenLocation({ lat, lng }, 1);
  const key = `${env.WEATHER_PROVIDER}:${coarse.lat},${coarse.lng}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  try {
    const value =
      env.WEATHER_PROVIDER === 'openweather'
        ? await fetchOpenWeather(coarse)
        : await fetchOpenMeteo(coarse);

    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    console.warn(`[weather] lookup failed (${env.WEATHER_PROVIDER}): ${error.message}`);
    cache.set(key, { at: Date.now(), value: null });
    return null;
  }
}

async function withTimeout(url, ms = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenMeteo({ lat, lng }) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    '&current=temperature_2m,apparent_temperature,precipitation,weather_code&timezone=auto';

  const data = await withTimeout(url);
  const current = data?.current;
  if (!current) return null;

  const temperatureC = Number(current.temperature_2m);
  const isRaining = Number(current.precipitation) > 0.1 || RAIN_CODES.has(Number(current.weather_code));

  return {
    temperatureC: Math.round(temperatureC),
    feelsLikeC: Math.round(Number(current.apparent_temperature ?? temperatureC)),
    condition: classify(temperatureC, isRaining),
    isRaining,
    provider: 'open-meteo',
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchOpenWeather({ lat, lng }) {
  const url =
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}` +
    `&units=metric&appid=${encodeURIComponent(env.OPENWEATHER_API_KEY)}`;

  const data = await withTimeout(url);
  const temperatureC = Number(data?.main?.temp);
  if (!Number.isFinite(temperatureC)) return null;

  const isRaining = Boolean(data.rain) || ['Rain', 'Drizzle', 'Thunderstorm'].includes(data.weather?.[0]?.main);

  return {
    temperatureC: Math.round(temperatureC),
    feelsLikeC: Math.round(Number(data.main.feels_like ?? temperatureC)),
    condition: classify(temperatureC, isRaining),
    isRaining,
    description: data.weather?.[0]?.description,
    provider: 'openweather',
    fetchedAt: new Date().toISOString(),
  };
}

/** Human-readable suggestion shown on the dashboard context strip. */
export function weatherSuggestion(weather) {
  if (!weather) return null;
  switch (weather.condition) {
    case 'hot':
      return 'It is hot out — cold drinks, juices and lighter plates may suit better.';
    case 'rainy':
      return 'It is raining — soups, hot snacks and warm meals tend to feel better.';
    case 'cold':
    case 'cool':
      return 'It is cool out — warm and soupy options may suit better.';
    case 'warm':
      return 'Warm weather — something refreshing may suit better.';
    default:
      return 'Pleasant weather — anything goes.';
  }
}
