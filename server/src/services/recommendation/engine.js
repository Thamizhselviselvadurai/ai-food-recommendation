import { FoodItem, Restaurant } from '../../models/index.js';
import {
  DIET_COMPATIBILITY, FACTOR_LABELS, PLACE_WEIGHTS, PRICE_BANDS, SCORING_WEIGHTS,
} from '../../domain/constants.js';
import { haversineKm, kmToRadians, travelMinutes } from '../../utils/geo.js';
import { clamp, closingSoon, isOpenAt } from '../../utils/time.js';
import { estimateForRestaurants } from '../crowd/crowdEngine.js';
import {
  computeAdjustments, matchBudget, matchCrowd, matchDietary, matchDistance, matchDistanceTime,
  matchHistory, matchHunger, matchMood, matchNutrition, matchRating, matchSpice,
} from './matchers.js';

export const ENGINE_VERSION = '1.0.0';

/**
 * ---------------------------------------------------------------------------
 * Recommendation engine
 * ---------------------------------------------------------------------------
 * The LLM never decides *what* to recommend. This module does, deterministically:
 *
 *   hard filters  -> diet, allergies, avoided ingredients, availability, hard budget
 *   weighted score -> the eight factors in SCORING_WEIGHTS
 *   adjustments    -> bounded bonuses/penalties (craving, weather, timing, history)
 *   place layer    -> dish score blended with distance, crowd and rating
 *
 * Every factor is returned with its weight, score and a human-readable reason,
 * so "Why this recommendation?" is generated from the maths, not invented.
 * ---------------------------------------------------------------------------
 */

// ── Candidate selection ─────────────────────────────────────────────────────

export async function findNearbyRestaurants(ctx, { radiusKm, includeClosed = false, filters = {} } = {}) {
  const radius = radiusKm ?? (ctx.maxDistanceKm ? ctx.maxDistanceKm * 1.4 : 8);

  const query = { isActive: true };

  if (ctx.location) {
    query.location = {
      $geoWithin: { $centerSphere: [[ctx.location.lng, ctx.location.lat], kmToRadians(radius)] },
    };
  }
  if (filters.cuisines?.length) query.cuisines = { $in: filters.cuisines };
  if (filters.priceCategory) query.priceCategory = filters.priceCategory;
  if (filters.minRating) query.rating = { $gte: Number(filters.minRating) };
  if (filters.pureVeg) query.isPureVeg = true;
  if (filters.search) query.$text = { $search: filters.search };
  if (ctx.fulfilment === 'delivery') query.deliveryAvailable = true;
  if (ctx.fulfilment === 'dinein') query.dineInAvailable = true;

  const restaurants = await Restaurant.find(query).limit(120).lean();

  const withDistance = restaurants.map((restaurant) => {
    const [lng, lat] = restaurant.location?.coordinates ?? [];
    const distanceKm = ctx.location && lat != null ? haversineKm(ctx.location, { lat, lng }) : null;

    // A venue whose provider published no hours is "unknown", not "open".
    const hoursKnown = restaurant.hoursKnown !== false && Boolean(restaurant.openingHours?.length);
    return {
      restaurant,
      distanceKm,
      hoursKnown,
      isOpen: hoursKnown ? isOpenAt(restaurant.openingHours) : null,
      closingSoon: hoursKnown ? closingSoon(restaurant.openingHours) : false,
    };
  });

  // "Open now" hides confirmed-closed venues but keeps unknown-hours ones,
  // clearly flagged — otherwise most real-world listings would vanish.
  const open = includeClosed ? withDistance : withDistance.filter((p) => p.isOpen !== false);
  return open.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
}

/** Hard filters live in the query so we never score food the user cannot eat. */
function buildFoodQuery(ctx, restaurantIds) {
  const query = { isAvailable: true };
  if (restaurantIds?.length) query.restaurant = { $in: restaurantIds };

  if (ctx.dietType) {
    query.dietType = { $in: DIET_COMPATIBILITY[ctx.dietType] ?? [ctx.dietType] };
  }
  if (ctx.allergies?.length) {
    query.allergens = { $nin: ctx.allergies };
  }
  if (ctx.budget) {
    // A little headroom so a ₹210 biryani still surfaces on a ₹200 budget —
    // it just loses points for it and the UI shows it as over budget.
    query.price = { $lte: Math.round(ctx.budget * 1.35) };
  }
  /**
   * An explicitly chosen price band is a hard filter on the dish price. It used
   * to only ever act as a fallback default for the budget, which meant picking
   * "₹ Low" alongside any budget did nothing at all.
   */
  if (ctx.priceCategory && PRICE_BANDS[ctx.priceCategory]) {
    const band = PRICE_BANDS[ctx.priceCategory];
    query.price = {
      ...(query.price ?? {}),
      $gte: band.min,
      ...(Number.isFinite(band.max) ? { $lte: Math.min(band.max, query.price?.$lte ?? Infinity) } : {}),
    };
  }
  if (ctx.cuisines?.length && ctx.strictCuisine) {
    query.cuisine = { $in: ctx.cuisines };
  }
  return query;
}

/** Free-text "avoid" terms ("no rice today") are matched in memory. */
function passesAvoidList(food, ctx) {
  if (!ctx.avoid?.length) return true;
  const haystack = `${food.name} ${food.description ?? ''} ${(food.tags ?? []).join(' ')} ${food.cuisine}`.toLowerCase();
  return !ctx.avoid.some((term) => term.length > 2 && haystack.includes(term));
}

function passesDislikes(food, ctx) {
  return !ctx.personalization?.dislikedFoodIds?.has(String(food._id));
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const FACTOR_FNS = {
  mood: matchMood,
  hunger: matchHunger,
  budget: matchBudget,
  dietary: matchDietary,
  nutrition: matchNutrition,
  spice: matchSpice,
  history: matchHistory,
};

export function scoreFood(food, ctx, place = null) {
  const factors = [];
  let total = 0;

  for (const [key, weight] of Object.entries(SCORING_WEIGHTS)) {
    const fn = key === 'distanceTime' ? null : FACTOR_FNS[key];
    const outcome = fn ? fn(food, ctx) : matchDistanceTime(food, ctx, place);
    total += outcome.score * weight;
    factors.push({
      key,
      label: FACTOR_LABELS[key] ?? key,
      weight,
      score: Number(outcome.score.toFixed(3)),
      passed: outcome.passed,
      detail: outcome.detail,
    });
  }

  const adjustments = computeAdjustments(food, ctx, place);
  const adjustmentTotal = adjustments.reduce((sum, a) => sum + a.delta, 0);
  const score = clamp(total + adjustmentTotal, 0, 1);

  return {
    score,
    baseScore: total,
    matchPercent: Math.round(score * 100),
    factors,
    adjustments,
  };
}

export function scorePlace({ food, place, ctx, dishOutcome }) {
  const dish = dishOutcome ?? scoreFood(food, ctx, place);

  const distance = matchDistance(place, ctx);
  const crowd = matchCrowd(place, ctx);
  const rating = matchRating(place);

  const score = clamp(
    dish.score * PLACE_WEIGHTS.dish +
      distance.score * PLACE_WEIGHTS.distance +
      crowd.score * PLACE_WEIGHTS.crowd +
      rating.score * PLACE_WEIGHTS.rating,
    0,
    1
  );

  const placeFactors = [
    { key: 'distance', label: FACTOR_LABELS.distance, weight: PLACE_WEIGHTS.distance, ...toFactor(distance) },
    { key: 'crowd', label: FACTOR_LABELS.crowd, weight: PLACE_WEIGHTS.crowd, ...toFactor(crowd) },
    { key: 'rating', label: FACTOR_LABELS.rating, weight: PLACE_WEIGHTS.rating, ...toFactor(rating) },
  ];

  return {
    score,
    matchPercent: Math.round(score * 100),
    factors: [...dish.factors, ...placeFactors],
    adjustments: dish.adjustments,
    dishScore: dish.score,
  };
}

const toFactor = (outcome) => ({
  score: Number(outcome.score.toFixed(3)),
  passed: outcome.passed,
  detail: outcome.detail,
});

// ── Timing ──────────────────────────────────────────────────────────────────

function computeEta({ restaurant, food, crowd, distanceKm, fulfilment }) {
  const crowdDelay = Math.round(((crowd?.score ?? 30) / 100) ** 1.6 * 18);
  const prep = food?.prepTimeMinutes ?? restaurant.avgPrepMinutes ?? 15;

  const deliveryEta = (restaurant.deliveryBaseMinutes ?? 20) + prep + crowdDelay;
  const travel = travelMinutes(distanceKm) ?? 0;
  const dineInEta = travel + (crowd?.waitMinutes?.min ?? 0) + Math.round(prep * 0.6);

  return {
    deliveryEta,
    dineInEta,
    travelMinutes: travel,
    etaMinutes: fulfilment === 'dinein' ? dineInEta : Math.min(deliveryEta, dineInEta + 5),
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Rank individual dishes. Used by the mood wizard, the chat and "alternatives".
 * `diversify` keeps one dish per restaurant in the top slice so the user is not
 * shown five variations from the same kitchen.
 */
export async function recommendFoods(ctx, { limit = 8, diversify = true, restaurantId = null } = {}) {
  const startedAt = Date.now();

  const places = restaurantId
    ? await findNearbyRestaurants(ctx, { radiusKm: 50, includeClosed: true })
      .then((rows) => rows.filter((p) => String(p.restaurant._id) === String(restaurantId)))
    : await findNearbyRestaurants(ctx, { includeClosed: !ctx.openNow });

  if (!places.length) {
    return { items: [], tookMs: Date.now() - startedAt, candidateCount: 0, reason: 'no_restaurants_in_range' };
  }

  const restaurants = places.map((p) => p.restaurant);
  const crowdMap = await estimateForRestaurants(restaurants, { weather: ctx.weather });

  const placeByRestaurant = new Map(
    places.map((p) => [String(p.restaurant._id), { ...p, crowd: crowdMap.get(String(p.restaurant._id)) }])
  );

  const foods = await FoodItem.find(buildFoodQuery(ctx, restaurants.map((r) => r._id)))
    .limit(600)
    .lean();

  const scored = [];
  for (const food of foods) {
    if (!passesAvoidList(food, ctx) || !passesDislikes(food, ctx)) continue;

    const place = placeByRestaurant.get(String(food.restaurant));
    if (!place) continue;

    const timing = computeEta({
      restaurant: place.restaurant,
      food,
      crowd: place.crowd,
      distanceKm: place.distanceKm,
      fulfilment: ctx.fulfilment,
    });

    const enrichedPlace = { ...place, ...timing };
    const outcome = scorePlace({ food, place: enrichedPlace, ctx });

    scored.push({
      food,
      restaurant: place.restaurant,
      distanceKm: place.distanceKm,
      crowd: place.crowd,
      ...timing,
      isOpen: place.isOpen,
      closingSoon: place.closingSoon,
      overBudget: ctx.budget ? food.price > ctx.budget : false,
      ...outcome,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const items = diversify ? diversifyByRestaurant(scored, limit) : scored.slice(0, limit);

  return {
    items,
    candidateCount: scored.length,
    tookMs: Date.now() - startedAt,
    reason: items.length ? null : 'no_matching_food',
  };
}

/**
 * Rank *places to eat*: one best dish per restaurant, ordered by the combined
 * dish + distance + crowd + rating score. This is what "I want biryani, ₹250,
 * near me, no waiting" hits.
 */
export async function recommendPlaces(ctx, { limit = 6 } = {}) {
  const { items, candidateCount, tookMs } = await recommendFoods(ctx, { limit: 200, diversify: false });

  const best = new Map();
  for (const item of items) {
    const key = String(item.restaurant._id);
    if (!best.has(key) || best.get(key).score < item.score) best.set(key, item);
  }

  const ranked = [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);

  // Attach up to three other dishes from the same place for the "also here" row.
  for (const entry of ranked) {
    entry.alsoAvailable = items
      .filter((i) => String(i.restaurant._id) === String(entry.restaurant._id) && String(i.food._id) !== String(entry.food._id))
      .slice(0, 3)
      .map((i) => ({ food: i.food, matchPercent: i.matchPercent, price: i.food.price }));
  }

  return { items: ranked, candidateCount, tookMs };
}

function diversifyByRestaurant(scored, limit) {
  const picked = [];
  const seen = new Map();
  const dishesSeen = new Set();
  const chosen = new Set();

  const take = (item, key) => {
    seen.set(key, (seen.get(key) ?? 0) + 1);
    dishesSeen.add(item.food.name);
    chosen.add(item);
    picked.push(item);
  };

  // First pass: one dish per restaurant, and no repeated dish. Venues discovered
  // live share one dish catalogue, so without the dish check the top results
  // were the same item listed against four different restaurants.
  for (const item of scored) {
    const key = String(item.restaurant._id);
    if (seen.get(key) || dishesSeen.has(item.food.name)) continue;
    take(item, key);
    if (picked.length >= limit) return picked;
  }
  // Second pass: one dish per restaurant, allowing a dish name to repeat.
  for (const item of scored) {
    if (chosen.has(item)) continue;
    const key = String(item.restaurant._id);
    if (seen.get(key)) continue;
    take(item, key);
    if (picked.length >= limit) return picked;
  }
  // Third pass: fill any remaining slots, max two per restaurant.
  for (const item of scored) {
    if (chosen.has(item)) continue;
    const key = String(item.restaurant._id);
    if ((seen.get(key) ?? 0) >= 2) continue;
    take(item, key);
    if (picked.length >= limit) break;
  }
  return picked;
}

/** Nearby discovery: places first, crowd-aware, no dish scoring required. */
export async function discoverNearby(ctx, { limit = 20, filters = {}, includeClosed = false, sort = 'best' } = {}) {
  const places = await findNearbyRestaurants(ctx, {
    radiusKm: ctx.maxDistanceKm ?? 6,
    includeClosed,
    filters,
  });

  const crowdMap = await estimateForRestaurants(places.map((p) => p.restaurant), { weather: ctx.weather });

  const enriched = places.map((place) => {
    const crowd = crowdMap.get(String(place.restaurant._id));
    const timing = computeEta({
      restaurant: place.restaurant,
      food: null,
      crowd,
      distanceKm: place.distanceKm,
      fulfilment: ctx.fulfilment,
    });
    const distance = matchDistance({ ...place, crowd }, ctx);
    const crowdMatch = matchCrowd({ ...place, crowd }, ctx);
    const rating = matchRating(place);

    const score = clamp(distance.score * 0.34 + crowdMatch.score * 0.36 + rating.score * 0.30, 0, 1);

    return {
      ...place,
      crowd,
      ...timing,
      matchPercent: Math.round(score * 100),
      score,
      factors: [
        { key: 'distance', label: FACTOR_LABELS.distance, weight: 0.34, ...toFactor(distance) },
        { key: 'crowd', label: FACTOR_LABELS.crowd, weight: 0.36, ...toFactor(crowdMatch) },
        { key: 'rating', label: FACTOR_LABELS.rating, weight: 0.30, ...toFactor(rating) },
      ],
    };
  });

  const filtered = filters.lowCrowdOnly ? enriched.filter((p) => p.crowd?.level === 'low') : enriched;

  const sorters = {
    best: (a, b) => b.score - a.score,
    distance: (a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999),
    rating: (a, b) => (b.restaurant.rating ?? 0) - (a.restaurant.rating ?? 0),
    crowd: (a, b) => (a.crowd?.score ?? 100) - (b.crowd?.score ?? 100),
    wait: (a, b) => (a.crowd?.waitMinutes?.min ?? 999) - (b.crowd?.waitMinutes?.min ?? 999),
    price: (a, b) => (a.restaurant.avgCostForOne ?? 0) - (b.restaurant.avgCostForOne ?? 0),
  };

  return filtered.sort(sorters[sort] ?? sorters.best).slice(0, limit);
}
