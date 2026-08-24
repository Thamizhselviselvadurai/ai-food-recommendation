import { z } from 'zod';
import { RecommendationHistory } from '../../models/index.js';
import {
  ALLERGENS, CUISINES, DIET_TYPES, FACTOR_LABELS, HUNGER_LEVELS, MEAL_SLOTS, MOODS,
  PLACE_WEIGHTS, PRICE_CATEGORIES, REJECTION_REASONS, SCORING_WEIGHTS, SPICE_LEVELS,
} from '../../domain/constants.js';
import { buildContext, serialiseContext } from '../../services/recommendation/context.js';
import { ENGINE_VERSION, recommendFoods, recommendPlaces } from '../../services/recommendation/engine.js';
import { explainAll } from '../../services/ai/explain.js';
import { extractIntent, intentToContextInput } from '../../services/ai/intent.js';
import { ingestNearbyPlaces as ensureLiveCoverage } from '../../services/places/index.js';
import { coarsenLocation } from '../../utils/geo.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { serializeRecommendation } from '../serializers.js';

const locationSchema = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), source: z.string().optional() })
  .nullable()
  .optional();

export const preferenceInputSchema = z.object({
  mood: z.string().nullable().optional(),
  hungerLevel: z.enum(HUNGER_LEVELS).nullable().optional(),
  budget: z.number().positive().max(100000).nullable().optional(),
  priceCategory: z.enum(PRICE_CATEGORIES).nullable().optional(),
  dietType: z.enum(DIET_TYPES).nullable().optional(),
  spiceLevel: z.enum(SPICE_LEVELS).nullable().optional(),
  maxSpiceLevel: z.enum(SPICE_LEVELS).nullable().optional(),
  highProtein: z.boolean().optional(),
  caloriePreference: z.enum(['any', 'low', 'moderate', 'high']).optional(),
  cuisines: z.array(z.enum(CUISINES)).max(6).optional(),
  keywords: z.array(z.string().max(40)).max(6).optional(),
  avoid: z.array(z.string().max(40)).max(10).optional(),
  allergies: z.array(z.enum(ALLERGENS)).optional(),
  maxWaitMinutes: z.number().positive().max(240).nullable().optional(),
  maxDistanceKm: z.number().positive().max(50).nullable().optional(),
  avoidWaiting: z.boolean().optional(),
  fulfilment: z.enum(['delivery', 'dinein', 'any']).optional(),
  mealSlot: z.enum(MEAL_SLOTS).nullable().optional(),
  openNow: z.boolean().optional(),
  location: locationSchema,
  limit: z.number().int().min(1).max(20).optional(),
  excludeFoodIds: z.array(z.string()).max(50).optional(),
});

export const smartRequestSchema = preferenceInputSchema.extend({
  query: z.string().max(600).optional(),
});

/** Shared pipeline: context -> engine -> explanations -> persisted history. */
async function runRecommendation({ req, input, mode, surface, query = null, intentSource = 'form' }) {
  const ctx = await buildContext(input, { userId: req.userId });

  // The dish flows rank whatever venues exist around the user. When that is a
  // real shared location, make sure the area has actually been pulled from the
  // live provider first — otherwise "what should I eat?" comes back empty for
  // anyone outside the one city the demo dataset covers.
  if (ctx.location && ctx.location.source !== 'default_city') {
    await ensureLiveCoverage({
      lat: ctx.location.lat,
      lng: ctx.location.lng,
      radiusKm: Math.max(ctx.maxDistanceKm ?? 6, 3),
    }).catch((error) => console.warn(`[recommend] live coverage skipped: ${error.message}`));
  }

  const engineResult =
    mode === 'places'
      ? await recommendPlaces(ctx, { limit: input.limit ?? 6 })
      : await recommendFoods(ctx, { limit: input.limit ?? 8 });

  let items = engineResult.items;
  if (input.excludeFoodIds?.length) {
    const excluded = new Set(input.excludeFoodIds.map(String));
    items = items.filter((item) => !excluded.has(String(item.food._id)));
  }

  const explained = await explainAll(items, ctx, { llmLimit: 3 });

  const record = await persistHistory({ req, ctx, items: explained, surface, query, intentSource });

  return {
    recommendationId: record ? String(record._id) : null,
    items: explained.map(serializeRecommendation),
    context: {
      ...serialiseContext(ctx),
      usingApproxLocation: ctx.location?.source === 'default_city',
      weatherSignalUsed: Boolean(ctx.weather),
    },
    meta: {
      engineVersion: ENGINE_VERSION,
      candidateCount: engineResult.candidateCount,
      tookMs: engineResult.tookMs,
      reason: engineResult.reason,
      intentSource,
    },
  };
}

async function persistHistory({ req, ctx, items, surface, query, intentSource }) {
  if (!req.userId || !items.length) return null;

  return RecommendationHistory.create({
    user: req.userId,
    surface,
    query,
    intentSource,
    engineVersion: ENGINE_VERSION,
    context: {
      ...serialiseContext(ctx),
      // Never store precise coordinates — snapped to a ~1 km grid.
      approxLocation: ctx.location ? coarsenLocation(ctx.location) : undefined,
    },
    results: items.slice(0, 8).map((item) => ({
      food: item.food?._id,
      restaurant: item.restaurant?._id,
      score: item.score,
      matchPercent: item.matchPercent,
      factors: item.factors,
      explanation: item.explanation,
      explanationSource: item.explanationSource,
    })),
  });
}

export const recommendFoodsHandler = asyncHandler(async (req, res) => {
  res.json(await runRecommendation({ req, input: req.body, mode: 'foods', surface: 'wizard' }));
});

export const recommendPlacesHandler = asyncHandler(async (req, res) => {
  res.json(await runRecommendation({ req, input: req.body, mode: 'places', surface: 'near_me' }));
});

export const alternativesHandler = asyncHandler(async (req, res) => {
  res.json(await runRecommendation({ req, input: req.body, mode: 'foods', surface: 'alternatives' }));
});

/**
 * The headline flow: "I'm hungry, I want biryani, I have ₹250, I'm near
 * restaurants, and I don't want to wait."
 *
 * Accepts a sentence, structured fields, or both. Returns the single best
 * place plus ranked runners-up.
 */
export const smartDecisionHandler = asyncHandler(async (req, res) => {
  const { query, ...formInput } = req.body;

  let input = formInput;
  let intentSource = 'form';
  let parsedIntent = null;

  if (query?.trim()) {
    const { intent, source } = await extractIntent(query);
    parsedIntent = intent;
    intentSource = source;
    // Explicit form fields still win over anything parsed from the sentence.
    input = { ...intentToContextInput(intent, { location: formInput.location }), ...stripUndefined(formInput) };
  }

  const result = await runRecommendation({
    req,
    input,
    mode: 'places',
    surface: 'smart_decision',
    query: query ?? null,
    intentSource,
  });

  res.json({
    ...result,
    intent: parsedIntent,
    best: result.items[0] ?? null,
    runnersUp: result.items.slice(1),
  });
});

export const historyHandler = asyncHandler(async (req, res) => {
  const history = await RecommendationHistory.find({ user: req.userId })
    .sort({ createdAt: -1 })
    .limit(25)
    .populate('results.food', 'name emoji price')
    .populate('results.restaurant', 'name emoji')
    .lean();

  res.json({ history });
});

/** Exposed so the UI can show exactly how a score is composed. */
export const weightsHandler = (req, res) => {
  res.json({
    engineVersion: ENGINE_VERSION,
    foodWeights: Object.entries(SCORING_WEIGHTS).map(([key, weight]) => ({
      key,
      label: FACTOR_LABELS[key] ?? key,
      weight,
      percent: Math.round(weight * 100),
    })),
    placeWeights: Object.entries(PLACE_WEIGHTS).map(([key, weight]) => ({
      key,
      label: FACTOR_LABELS[key] ?? key,
      weight,
      percent: Math.round(weight * 100),
    })),
    moods: MOODS,
    hungerLevels: HUNGER_LEVELS,
    dietTypes: DIET_TYPES,
    spiceLevels: SPICE_LEVELS,
    cuisines: CUISINES,
    allergens: ALLERGENS,
    priceCategories: PRICE_CATEGORIES,
    rejectionReasons: REJECTION_REASONS,
  });
};

const stripUndefined = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== null));
