import { z } from 'zod';
import { Feedback, FoodItem, Restaurant } from '../../models/index.js';
import { REJECTION_REASONS } from '../../domain/constants.js';
import { applyRejectionFeedback, reinforcePositive } from '../../services/personalization.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const REASON_IDS = REJECTION_REASONS.map((r) => r.id);

export const feedbackSchema = z.object({
  sentiment: z.enum(['positive', 'negative']).default('negative'),
  reasons: z.array(z.enum(REASON_IDS)).max(6).optional(),
  comment: z.string().max(300).optional(),
  foodId: z.string().optional(),
  restaurantId: z.string().optional(),
  recommendationId: z.string().optional(),
});

const FIELD_LABELS = {
  priceSensitivity: 'we will lean towards cheaper options',
  defaultBudget: 'your default budget',
  spiceDrift: 'we will suggest milder food',
  maxSpiceLevel: 'your spice ceiling',
  portionDrift: 'we will suggest more filling plates',
  tagAffinity: 'flavour preferences',
  cuisineAffinity: 'cuisine preferences',
  dislikedFoods: 'dishes to skip',
  dislikedRestaurants: 'restaurants to skip',
  recentFoods: 'recently eaten list',
  maxDistanceKm: 'your distance limit',
  maxWaitMinutes: 'your waiting limit',
};

/**
 * "❌ I don't like this recommendation" → a concrete, visible change to the
 * taste profile. The response tells the user exactly what we learned.
 */
export const submit = asyncHandler(async (req, res) => {
  const { sentiment, reasons = [], comment, foodId, restaurantId, recommendationId } = req.body;

  const [food, restaurant] = await Promise.all([
    foodId ? FoodItem.findById(foodId).lean() : null,
    restaurantId ? Restaurant.findById(restaurantId).lean() : null,
  ]);

  let applied = [];
  if (sentiment === 'negative') {
    ({ applied } = await applyRejectionFeedback({ userId: req.userId, reasons, food, restaurant }));
  } else {
    await reinforcePositive({
      userId: req.userId,
      foods: food ? [food] : [],
      restaurantId: restaurant?._id,
      strength: 0.09,
    });
    applied = [{ field: 'cuisineAffinity', key: food?.cuisine, delta: 0.09 }];
  }

  await Feedback.create({
    user: req.userId,
    recommendation: recommendationId || undefined,
    food: food?._id,
    restaurant: restaurant?._id,
    sentiment,
    reasons,
    comment,
    appliedAdjustments: applied,
  });

  res.status(201).json({
    message:
      sentiment === 'negative'
        ? 'Got it — future recommendations will take this into account.'
        : 'Noted, we will show you more like this.',
    learned: applied
      .filter((a) => FIELD_LABELS[a.field])
      .map((a) => ({
        field: a.field,
        label: FIELD_LABELS[a.field],
        direction: a.delta > 0 ? 'up' : 'down',
      })),
  });
});

export const history = asyncHandler(async (req, res) => {
  const feedback = await Feedback.find({ user: req.userId })
    .sort({ createdAt: -1 })
    .limit(30)
    .populate('food', 'name emoji price')
    .populate('restaurant', 'name emoji')
    .lean();
  res.json({ feedback });
});
