import { env } from '../../config/env.js';
import { HUNGER_LEVELS, MOOD_IDS, PRICE_BANDS, SPICE_LEVELS } from '../../domain/constants.js';
import { isValidCoordinate } from '../../utils/geo.js';
import { mealSlot } from '../../utils/time.js';
import { loadPersonalization } from '../personalization.js';
import { getWeather } from '../weather/weatherService.js';

/**
 * Precedence, highest first:
 *   1. what the user asked for in THIS request (form fields or parsed sentence)
 *   2. their saved preferences
 *   3. sensible defaults
 *
 * A saved "vegetarian" preference is never overridden by silence, but an
 * explicit "I want chicken today" in the request wins.
 */
export async function buildContext(input = {}, { userId = null, includeWeather = true } = {}) {
  const personalization = await loadPersonalization(userId);
  const saved = personalization?.preferences;

  const location = resolveLocation(input.location);
  const weather = includeWeather && location ? await getWeather(location) : null;

  const pick = (value, fallback) => (value === undefined || value === null || value === '' ? fallback : value);

  const budget = normaliseBudget(input.budget, input.priceCategory, saved?.defaultBudget);

  const ctx = {
    mood: MOOD_IDS.includes(input.mood) ? input.mood : null,
    hungerLevel: HUNGER_LEVELS.includes(input.hungerLevel) ? input.hungerLevel : null,

    budget,
    priceCategory: PRICE_BANDS[input.priceCategory] ? input.priceCategory : null,

    dietType: pick(input.dietType, saved?.dietType ?? null),
    spiceLevel: SPICE_LEVELS.includes(input.spiceLevel) ? input.spiceLevel : (saved?.preferredSpiceLevel ?? null),
    maxSpiceLevel: SPICE_LEVELS.includes(input.maxSpiceLevel) ? input.maxSpiceLevel : (saved?.maxSpiceLevel ?? null),

    highProtein: pick(input.highProtein, saved?.highProtein ?? false),
    caloriePreference: pick(input.caloriePreference, saved?.caloriePreference ?? 'any'),

    cuisines: toArray(input.cuisines ?? saved?.preferredCuisines),
    keywords: toArray(input.keywords),
    avoid: toArray(input.avoid ?? saved?.avoidIngredients).map((v) => String(v).toLowerCase()),
    allergies: toArray(input.allergies ?? saved?.allergies),

    maxWaitMinutes: toNumber(input.maxWaitMinutes) ?? saved?.maxWaitMinutes ?? null,
    maxDistanceKm: toNumber(input.maxDistanceKm) ?? saved?.maxDistanceKm ?? 6,
    avoidWaiting: Boolean(input.avoidWaiting),

    fulfilment: ['delivery', 'dinein', 'any'].includes(input.fulfilment) ? input.fulfilment : 'any',
    openNow: input.openNow !== false,

    mealSlot: input.mealSlot ?? mealSlot(),
    location,
    weather,

    personalization,
    spiceDrift: personalization?.spiceDrift ?? 0,
    portionDrift: personalization?.portionDrift ?? 0,
  };

  // A price-sensitive user gets a quietly tighter budget when they did not set one.
  if (!input.budget && personalization?.priceSensitivity > 0.3 && ctx.budget) {
    ctx.budget = Math.round(ctx.budget * (1 - personalization.priceSensitivity * 0.2));
  }

  if (ctx.avoidWaiting && !ctx.maxWaitMinutes) ctx.maxWaitMinutes = 20;

  return ctx;
}

function resolveLocation(location) {
  if (location && isValidCoordinate(Number(location.lat), Number(location.lng))) {
    return { lat: Number(location.lat), lng: Number(location.lng), source: location.source ?? 'device' };
  }
  return { lat: env.DEFAULT_LAT, lng: env.DEFAULT_LNG, source: 'default_city' };
}

function normaliseBudget(budget, priceCategory, savedBudget) {
  const explicit = toNumber(budget);
  if (explicit) return explicit;
  if (priceCategory && PRICE_BANDS[priceCategory]) {
    const band = PRICE_BANDS[priceCategory];
    return Number.isFinite(band.max) ? band.max : 900;
  }
  return savedBudget ?? null;
}

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const toArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value).split(',').map((v) => v.trim()).filter(Boolean);
};

/** Shape stored on RecommendationHistory — no precise coordinates, no PII. */
export function serialiseContext(ctx) {
  return {
    mood: ctx.mood,
    hungerLevel: ctx.hungerLevel,
    budget: ctx.budget,
    dietType: ctx.dietType,
    spiceLevel: ctx.spiceLevel,
    cuisines: ctx.cuisines,
    maxWaitMinutes: ctx.maxWaitMinutes,
    maxDistanceKm: ctx.maxDistanceKm,
    avoid: ctx.avoid,
    allergies: ctx.allergies,
    mealSlot: ctx.mealSlot,
    weather: ctx.weather ? { condition: ctx.weather.condition, temperatureC: ctx.weather.temperatureC } : undefined,
  };
}
