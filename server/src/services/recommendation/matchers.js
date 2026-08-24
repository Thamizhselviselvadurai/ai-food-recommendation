import {
  DIET_COMPATIBILITY, FACTOR_LABELS, MOOD_TAGS, SPICE_INDEX, WEATHER_TAG_AFFINITY,
} from '../../domain/constants.js';
import { clamp } from '../../utils/time.js';

/**
 * Each matcher returns { score: 0..1, detail: string, passed: boolean }.
 * `passed` drives the ✓ / ~ markers in the "Why this recommendation?" panel.
 */

const PASS_THRESHOLD = 0.6;
const result = (score, detail) => ({
  score: clamp(score, 0, 1),
  detail,
  passed: score >= PASS_THRESHOLD,
});

/** Bell curve around a target, tolerant within `spread`. */
const bell = (value, target, spread) => Math.exp(-((value - target) ** 2) / (2 * spread ** 2));

// ── Mood ────────────────────────────────────────────────────────────────────
export function matchMood(food, ctx) {
  if (!ctx.mood) return result(0.6, 'No mood selected — not used for ranking');

  if (food.moodTags?.includes(ctx.mood)) {
    return result(1, `Commonly picked when someone feels "${ctx.mood.replace(/_/g, ' ')}"`);
  }

  const wanted = MOOD_TAGS[ctx.mood] ?? [];
  if (!wanted.length) return result(0.55, 'No mood profile for this selection');

  const overlap = wanted.filter((tag) => food.tags?.includes(tag));
  if (!overlap.length) return result(0.3, 'Not a typical pick for this mood');

  return result(
    0.45 + 0.55 * (overlap.length / wanted.length),
    `Matches what usually works for this mood: ${overlap.join(', ')}`
  );
}

// ── Hunger ──────────────────────────────────────────────────────────────────
const HUNGER_TARGETS = {
  light: { calories: 300, spread: 190, wantTags: ['light', 'low_cal', 'snack'], avoidTags: ['heavy', 'high_cal'] },
  moderate: { calories: 520, spread: 230, wantTags: ['filling'], avoidTags: [] },
  very_hungry: { calories: 780, spread: 300, wantTags: ['heavy', 'filling', 'high_cal'], avoidTags: ['light', 'low_cal'] },
};

export function matchHunger(food, ctx) {
  const level = ctx.hungerLevel;
  if (!level) return result(0.65, 'Hunger level not specified');

  const target = HUNGER_TARGETS[level] ?? HUNGER_TARGETS.moderate;
  const calories = food.nutrition?.calories ?? 450;

  let score = bell(calories, target.calories, target.spread);
  const wanted = target.wantTags.filter((t) => food.tags?.includes(t));
  const unwanted = target.avoidTags.filter((t) => food.tags?.includes(t));
  score += wanted.length * 0.12 - unwanted.length * 0.2;

  // Learned portion drift: a user who keeps saying "not filling" gets bigger plates.
  if (ctx.portionDrift) score += clamp(ctx.portionDrift, -1, 1) * (calories > target.calories ? 0.1 : -0.1);

  const label =
    level === 'light' ? 'a lighter plate'
      : level === 'very_hungry' ? 'a properly filling plate'
        : 'a regular-sized meal';

  return result(score, `~${Math.round(calories)} kcal (estimated) — suits ${label}`);
}

// ── Budget ──────────────────────────────────────────────────────────────────
export function matchBudget(food, ctx) {
  const budget = ctx.budget;
  if (!budget) return result(0.7, 'No budget set');

  const price = food.price;
  if (price <= budget) {
    // Well inside budget is good; suspiciously cheap gets a mild trim so a ₹20
    // tea does not out-rank a proper meal for a hungry user.
    const usage = price / budget;
    const score = usage >= 0.35 ? 1 : 0.78 + 0.22 * (usage / 0.35);
    return result(score, `₹${price} fits your ₹${budget} budget`);
  }

  const overshoot = (price - budget) / budget;
  return result(1 - overshoot * 2.6, `₹${price} is ₹${price - budget} over your ₹${budget} budget`);
}

// ── Dietary ─────────────────────────────────────────────────────────────────
const DIET_LABELS = { veg: 'vegetarian', vegan: 'vegan', egg: 'egg-friendly', nonveg: 'non-vegetarian' };

export function matchDietary(food, ctx) {
  if (!ctx.dietType) return result(0.7, 'No dietary preference set');

  const allowed = DIET_COMPATIBILITY[ctx.dietType] ?? [];
  if (!allowed.includes(food.dietType)) {
    return result(0, `${DIET_LABELS[food.dietType]} — outside your ${DIET_LABELS[ctx.dietType]} preference`);
  }
  if (food.dietType === ctx.dietType) {
    return result(1, `${DIET_LABELS[food.dietType]}, exactly what you asked for`);
  }
  return result(0.88, `${DIET_LABELS[food.dietType]} — safe for a ${DIET_LABELS[ctx.dietType]} preference`);
}

// ── Nutrition ───────────────────────────────────────────────────────────────
export function matchNutrition(food, ctx) {
  const { calories = 450, protein = 12 } = food.nutrition ?? {};
  const notes = [];
  let score = 0.6;

  if (ctx.highProtein) {
    const density = (protein / Math.max(calories, 1)) * 100; // g protein per 100 kcal
    const proteinScore = clamp(density / 5, 0, 1); // 5 g/100 kcal is excellent
    score = 0.25 + 0.75 * proteinScore;
    notes.push(`${Math.round(protein)} g protein (estimated)`);
  }

  if (ctx.caloriePreference && ctx.caloriePreference !== 'any') {
    const targets = { low: 320, moderate: 520, high: 800 };
    const calorieScore = bell(calories, targets[ctx.caloriePreference], 240);
    score = ctx.highProtein ? (score + calorieScore) / 2 : 0.2 + 0.8 * calorieScore;
    notes.push(`~${Math.round(calories)} kcal for a "${ctx.caloriePreference} calorie" preference`);
  }

  if (!notes.length) {
    // No explicit nutrition ask — gently favour balanced plates.
    const balance = clamp((protein / Math.max(calories, 1)) * 100 / 4, 0, 1);
    score = 0.5 + 0.3 * balance;
    notes.push(`~${Math.round(calories)} kcal, ${Math.round(protein)} g protein (estimated)`);
  }

  return result(score, notes.join(' · '));
}

// ── Spice ───────────────────────────────────────────────────────────────────
export function matchSpice(food, ctx) {
  const foodSpice = SPICE_INDEX[food.spiceLevel] ?? 1;

  if (ctx.maxSpiceLevel != null) {
    const max = SPICE_INDEX[ctx.maxSpiceLevel] ?? 3;
    if (foodSpice > max) return result(0.05, `${food.spiceLevel} spice is above your limit`);
  }

  if (!ctx.spiceLevel) return result(0.65, `${food.spiceLevel} spice`);

  let target = SPICE_INDEX[ctx.spiceLevel] ?? 2;
  if (ctx.spiceDrift) target = clamp(target + ctx.spiceDrift, 0, 3);

  const gap = Math.abs(foodSpice - target);
  const score = [1, 0.72, 0.34, 0.12][Math.min(3, Math.round(gap))];
  return result(score, gap === 0 ? `${food.spiceLevel} spice — exactly your level` : `${food.spiceLevel} spice vs. your ${ctx.spiceLevel} preference`);
}

// ── Learned preferences ─────────────────────────────────────────────────────
export function matchHistory(food, ctx) {
  const prefs = ctx.personalization;
  if (!prefs) return result(0.55, 'No history yet — sign in and order to personalise this');

  let score = 0.55;
  const notes = [];

  const cuisineAffinity = prefs.cuisineAffinity?.[food.cuisine] ?? 0;
  if (cuisineAffinity) {
    score += cuisineAffinity * 0.25;
    notes.push(cuisineAffinity > 0 ? `you order ${food.cuisine.replace(/_/g, ' ')} often` : `you rarely pick ${food.cuisine.replace(/_/g, ' ')}`);
  }

  const tagScores = (food.tags ?? []).map((tag) => prefs.tagAffinity?.[tag] ?? 0).filter(Boolean);
  if (tagScores.length) {
    const avg = tagScores.reduce((a, b) => a + b, 0) / tagScores.length;
    score += avg * 0.2;
    if (avg > 0.15) notes.push('matches flavours you keep choosing');
    if (avg < -0.15) notes.push('similar to things you passed on before');
  }

  if (prefs.favoriteFoodIds?.has(String(food._id))) {
    score += 0.3;
    notes.push('one of your favourites');
  }
  if (prefs.recentFoodIds?.has(String(food._id))) {
    score -= 0.35;
    notes.push('you had this recently');
  }
  if (prefs.orderedFoodIds?.has(String(food._id))) {
    score += 0.12;
    notes.push('you have ordered this before');
  }

  return result(score, notes.length ? notes.join(' · ') : 'Neutral against your history');
}

// ── Distance & waiting time ─────────────────────────────────────────────────
export function matchDistanceTime(food, ctx, place) {
  const prep = food.prepTimeMinutes ?? 15;
  const totalWait = place?.etaMinutes ?? prep;

  if (ctx.maxWaitMinutes) {
    if (totalWait <= ctx.maxWaitMinutes) {
      return result(
        0.75 + 0.25 * (1 - totalWait / ctx.maxWaitMinutes),
        `About ${totalWait} min — inside your ${ctx.maxWaitMinutes} min limit`
      );
    }
    const over = (totalWait - ctx.maxWaitMinutes) / ctx.maxWaitMinutes;
    return result(1 - over * 2, `About ${totalWait} min — over your ${ctx.maxWaitMinutes} min limit`);
  }

  if (place?.distanceKm != null && ctx.maxDistanceKm) {
    const ratio = place.distanceKm / ctx.maxDistanceKm;
    return result(1 - ratio * 0.9, `${place.distanceKm.toFixed(1)} km away, roughly ${totalWait} min`);
  }

  return result(clamp(1 - (totalWait - 8) / 45, 0.2, 1), `Roughly ${totalWait} min to be ready`);
}

// ── Place-level matchers ────────────────────────────────────────────────────
export function matchDistance(place, ctx) {
  if (place.distanceKm == null) return result(0.6, 'Distance unknown — share your location for better ranking');
  const max = ctx.maxDistanceKm || 6;
  const score = clamp(1 - place.distanceKm / (max * 1.25), 0, 1);
  return result(score, `${place.distanceKm < 1 ? `${Math.round(place.distanceKm * 1000)} m` : `${place.distanceKm.toFixed(1)} km`} away`);
}

export function matchCrowd(place, ctx) {
  const crowd = place.crowd;
  if (!crowd) return result(0.6, 'No crowd estimate available');
  if (!crowd.isOpen) return result(0, 'Currently closed');

  let score = clamp(1 - crowd.score / 100, 0, 1);

  // Someone who said "I don't want to wait" cares about this a lot more.
  if (ctx.avoidWaiting) score = clamp(score ** 0.65, 0, 1);

  if (ctx.maxWaitMinutes && crowd.waitMinutes.min > ctx.maxWaitMinutes) {
    score = Math.min(score, 0.25);
  }

  return result(score, `${crowd.levelLabel.toLowerCase()} right now, about ${crowd.waitMinutes.label} wait`);
}

export function matchRating(place) {
  const rating = place.restaurant?.rating;
  const count = place.restaurant?.ratingCount ?? 0;

  // Live sources such as OpenStreetMap publish no ratings. Scoring a missing
  // rating as "4 stars" would be inventing data, so it scores neutral instead
  // and the UI says where the gap comes from.
  if (typeof rating !== 'number') {
    return result(0.5, 'No rating published for this venue by the data source');
  }

  // Ratings from 20 reviews mean less than ratings from 2000.
  const credibility = clamp(count / 400, 0.35, 1);
  const raw = clamp((rating - 3) / 1.8, 0, 1);
  return result(0.35 + (raw - 0.35) * credibility + 0.35 * credibility * raw, `★ ${rating.toFixed(1)} from ${count} ratings`);
}

// ── Bonuses & penalties (applied after the weighted sum) ────────────────────
export function computeAdjustments(food, ctx, place) {
  const adjustments = [];

  // Explicit craving: "I want biryani"
  if (ctx.keywords?.length) {
    const haystack = `${food.name} ${food.tags?.join(' ')} ${food.description ?? ''}`.toLowerCase();
    const hit = ctx.keywords.find((k) => haystack.includes(k.toLowerCase()));
    if (hit) adjustments.push({ key: 'craving', delta: 0.12, detail: `You asked for "${hit}"` });
  }

  if (ctx.cuisines?.length && ctx.cuisines.includes(food.cuisine)) {
    adjustments.push({ key: 'cuisine', delta: 0.06, detail: `${food.cuisine.replace(/_/g, ' ')} is one of your preferred cuisines` });
  }

  if (ctx.mealSlot && food.mealSlots?.includes(ctx.mealSlot)) {
    adjustments.push({ key: 'timing', delta: 0.05, detail: `Typical ${ctx.mealSlot.replace(/_/g, ' ')} choice` });
  }

  // Course fit: someone asking for a meal should not be handed a ₹25 drink just
  // because it scores well on "healthy". Only applies when they clearly want a
  // meal, and never when they explicitly asked for a drink or dessert.
  const wantsMeal =
    ['breakfast', 'lunch', 'dinner'].includes(ctx.mealSlot) ||
    (ctx.hungerLevel && ctx.hungerLevel !== 'light');

  const askedForSideCourse =
    ctx.cuisines?.some((c) => ['beverages', 'desserts'].includes(c)) ||
    ctx.keywords?.length > 0;

  if (wantsMeal && !askedForSideCourse) {
    const penalties = { beverage: -0.2, dessert: -0.14, side: -0.07 };
    const penalty = penalties[food.category];
    if (penalty) {
      adjustments.push({
        key: 'course',
        delta: penalty,
        detail: `A ${food.category} on its own is not really a ${(ctx.mealSlot ?? 'meal').replace(/_/g, ' ')}`,
      });
    }
  }

  if (ctx.weather?.condition) {
    const affinity = WEATHER_TAG_AFFINITY[ctx.weather.condition] ?? {};
    let weatherDelta = 0;
    const matched = [];
    for (const tag of food.tags ?? []) {
      if (affinity[tag]) {
        weatherDelta += affinity[tag] * 0.035;
        if (affinity[tag] > 0) matched.push(tag);
      }
    }
    if (Math.abs(weatherDelta) > 0.005) {
      adjustments.push({
        key: 'weather',
        delta: clamp(weatherDelta, -0.08, 0.08),
        detail: weatherDelta > 0
          ? `Works well in ${ctx.weather.condition} weather${matched.length ? ` (${matched.join(', ')})` : ''}`
          : `Heavier than ideal for ${ctx.weather.condition} weather`,
      });
    }
  }

  const rating = food.rating ?? 4;
  if (rating >= 4.2) adjustments.push({ key: 'popular', delta: 0.04, detail: `Well rated (★ ${rating.toFixed(1)})` });

  if (place?.restaurant && ctx.personalization?.dislikedRestaurantIds?.has(String(place.restaurant._id))) {
    adjustments.push({ key: 'disliked_place', delta: -0.2, detail: 'You marked this restaurant as not for you' });
  }

  if (ctx.personalization?.favoriteRestaurantIds?.has(String(place?.restaurant?._id))) {
    adjustments.push({ key: 'favorite_place', delta: 0.06, detail: 'One of your saved restaurants' });
  }

  return adjustments;
}

export const factorLabel = (key) => FACTOR_LABELS[key] ?? key;
