import { Favorite, Order, Rating, UserPreference } from '../models/index.js';
import { SPICE_INDEX, SPICE_LEVELS } from '../domain/constants.js';
import { clamp } from '../utils/time.js';

const RECENT_WINDOW_DAYS = 10;

/** Mongoose Maps -> plain objects the matchers can read cheaply. */
const mapToObject = (map) => (map instanceof Map ? Object.fromEntries(map) : { ...(map ?? {}) });

export async function getOrCreatePreferences(userId) {
  let prefs = await UserPreference.findOne({ user: userId });
  if (!prefs) prefs = await UserPreference.create({ user: userId });
  return prefs;
}

/**
 * Everything the scorer needs to know about one user, in a single object.
 * Returns null for guests — recommendations still work, just without the
 * "your past choices" factor.
 */
export async function loadPersonalization(userId) {
  if (!userId) return null;

  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 3600 * 1000);

  const [prefs, favorites, recentOrders, ratings] = await Promise.all([
    getOrCreatePreferences(userId),
    Favorite.find({ user: userId }).lean(),
    Order.find({ user: userId }).sort({ createdAt: -1 }).limit(30).lean(),
    Rating.find({ user: userId }).lean(),
  ]);

  const favoriteFoodIds = new Set(favorites.filter((f) => f.food).map((f) => String(f.food)));
  const favoriteRestaurantIds = new Set(favorites.filter((f) => f.restaurant).map((f) => String(f.restaurant)));

  const orderedFoodIds = new Set();
  const recentFoodIds = new Set();
  for (const order of recentOrders) {
    for (const item of order.items ?? []) {
      orderedFoodIds.add(String(item.food));
      if (new Date(order.createdAt) >= since) recentFoodIds.add(String(item.food));
    }
  }
  for (const entry of prefs.recentFoods ?? []) {
    if (entry.food && new Date(entry.at) >= since) recentFoodIds.add(String(entry.food));
  }

  const lowRatedFoodIds = new Set(
    ratings.filter((r) => r.targetType === 'food' && r.value <= 2).map((r) => String(r.food))
  );

  return {
    preferences: prefs,
    cuisineAffinity: mapToObject(prefs.cuisineAffinity),
    tagAffinity: mapToObject(prefs.tagAffinity),
    priceSensitivity: prefs.priceSensitivity ?? 0,
    spiceDrift: prefs.spiceDrift ?? 0,
    portionDrift: prefs.portionDrift ?? 0,
    favoriteFoodIds,
    favoriteRestaurantIds,
    orderedFoodIds,
    recentFoodIds,
    dislikedFoodIds: new Set([
      ...(prefs.dislikedFoods ?? []).map(String),
      ...lowRatedFoodIds,
    ]),
    dislikedRestaurantIds: new Set((prefs.dislikedRestaurants ?? []).map(String)),
  };
}

/**
 * Turns "I don't like this recommendation" into concrete, bounded changes to
 * the taste profile. Every change is returned so the API can show the user
 * exactly what we learned — no silent black-box personalisation.
 */
export async function applyRejectionFeedback({ userId, reasons = [], food, restaurant }) {
  const prefs = await getOrCreatePreferences(userId);
  const applied = [];

  const bumpMap = (field, key, delta) => {
    if (!key) return;
    const current = prefs[field].get(key) ?? 0;
    const next = clamp(current + delta, -1, 1);
    prefs[field].set(key, Number(next.toFixed(3)));
    applied.push({ field, key, delta: Number((next - current).toFixed(3)) });
  };

  const bumpScalar = (field, delta, min = -1, max = 1) => {
    const current = prefs[field] ?? 0;
    const next = clamp(current + delta, min, max);
    prefs[field] = Number(next.toFixed(3));
    applied.push({ field, delta: Number((next - current).toFixed(3)) });
  };

  for (const reason of reasons) {
    switch (reason) {
      case 'too_expensive': {
        bumpScalar('priceSensitivity', 0.2);
        if (food?.price) {
          const tighter = Math.max(80, Math.round((food.price * 0.85) / 10) * 10);
          if (tighter < (prefs.defaultBudget ?? 300)) {
            applied.push({ field: 'defaultBudget', delta: tighter - prefs.defaultBudget });
            prefs.defaultBudget = tighter;
          }
        }
        break;
      }
      case 'too_spicy': {
        bumpScalar('spiceDrift', -0.5, -2, 2);
        const currentMax = SPICE_INDEX[prefs.maxSpiceLevel] ?? 3;
        if (food && (SPICE_INDEX[food.spiceLevel] ?? 0) >= currentMax) {
          const next = SPICE_LEVELS[Math.max(0, currentMax - 1)];
          applied.push({ field: 'maxSpiceLevel', key: next, delta: -1 });
          prefs.maxSpiceLevel = next;
        }
        break;
      }
      case 'not_filling':
        bumpScalar('portionDrift', 0.25);
        for (const tag of ['light', 'low_cal', 'snack']) bumpMap('tagAffinity', tag, -0.12);
        break;
      case 'dislike_food':
        if (food?._id && !prefs.dislikedFoods.some((id) => String(id) === String(food._id))) {
          prefs.dislikedFoods.push(food._id);
          applied.push({ field: 'dislikedFoods', key: String(food._id), delta: 1 });
        }
        if (food?.cuisine) bumpMap('cuisineAffinity', food.cuisine, -0.15);
        for (const tag of food?.tags ?? []) bumpMap('tagAffinity', tag, -0.08);
        break;
      case 'dislike_restaurant':
        if (restaurant?._id && !prefs.dislikedRestaurants.some((id) => String(id) === String(restaurant._id))) {
          prefs.dislikedRestaurants.push(restaurant._id);
          applied.push({ field: 'dislikedRestaurants', key: String(restaurant._id), delta: 1 });
        }
        break;
      case 'ate_recently':
        if (food?._id) {
          prefs.recentFoods.push({ food: food._id, at: new Date() });
          applied.push({ field: 'recentFoods', key: String(food._id), delta: 1 });
        }
        break;
      case 'too_far':
        if (prefs.maxDistanceKm > 1.5) {
          const next = Number((prefs.maxDistanceKm * 0.8).toFixed(1));
          applied.push({ field: 'maxDistanceKm', delta: Number((next - prefs.maxDistanceKm).toFixed(1)) });
          prefs.maxDistanceKm = next;
        }
        break;
      case 'too_much_waiting':
        if (prefs.maxWaitMinutes > 10) {
          const next = Math.max(10, Math.round(prefs.maxWaitMinutes * 0.75));
          applied.push({ field: 'maxWaitMinutes', delta: next - prefs.maxWaitMinutes });
          prefs.maxWaitMinutes = next;
        }
        break;
      default:
        break;
    }
  }

  // Keep the "recently eaten" list bounded.
  if (prefs.recentFoods.length > 40) prefs.recentFoods = prefs.recentFoods.slice(-40);

  await prefs.save();
  return { preferences: prefs, applied };
}

/** Positive signal: an order was placed, or a dish was rated highly. */
export async function reinforcePositive({ userId, foods = [], restaurantId, strength = 0.08 }) {
  if (!userId) return null;
  const prefs = await getOrCreatePreferences(userId);

  for (const food of foods) {
    if (!food) continue;
    if (food.cuisine) {
      const current = prefs.cuisineAffinity.get(food.cuisine) ?? 0;
      prefs.cuisineAffinity.set(food.cuisine, Number(clamp(current + strength, -1, 1).toFixed(3)));
    }
    for (const tag of food.tags ?? []) {
      const current = prefs.tagAffinity.get(tag) ?? 0;
      prefs.tagAffinity.set(tag, Number(clamp(current + strength * 0.6, -1, 1).toFixed(3)));
    }
    if (food._id) prefs.recentFoods.push({ food: food._id, at: new Date() });
  }

  if (restaurantId) {
    prefs.dislikedRestaurants = prefs.dislikedRestaurants.filter((id) => String(id) !== String(restaurantId));
  }
  if (prefs.recentFoods.length > 40) prefs.recentFoods = prefs.recentFoods.slice(-40);

  await prefs.save();
  return prefs;
}
