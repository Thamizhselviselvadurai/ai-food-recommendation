import { z } from 'zod';
import { Favorite, FoodItem, Order, Rating, Restaurant, UserPreference } from '../../models/index.js';
import { ALLERGENS, CUISINES, DIET_TYPES, SPICE_LEVELS } from '../../domain/constants.js';
import { buildContext } from '../../services/recommendation/context.js';
import { discoverNearby, recommendFoods } from '../../services/recommendation/engine.js';
import { explainAll } from '../../services/ai/explain.js';
import { getOrCreatePreferences, reinforcePositive } from '../../services/personalization.js';
import { weatherSuggestion } from '../../services/weather/weatherService.js';
import { mealSlot } from '../../utils/time.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { serializeFood, serializeNearbyPlace, serializeRecommendation, serializeRestaurant } from '../serializers.js';

export const preferencesSchema = z.object({
  dietType: z.enum(DIET_TYPES).optional(),
  maxSpiceLevel: z.enum(SPICE_LEVELS).optional(),
  preferredSpiceLevel: z.enum(SPICE_LEVELS).optional(),
  defaultBudget: z.number().int().min(30).max(20000).optional(),
  caloriePreference: z.enum(['any', 'low', 'moderate', 'high']).optional(),
  highProtein: z.boolean().optional(),
  preferredCuisines: z.array(z.enum(CUISINES)).max(8).optional(),
  allergies: z.array(z.enum(ALLERGENS)).optional(),
  avoidIngredients: z.array(z.string().max(40)).max(15).optional(),
  maxWaitMinutes: z.number().int().min(5).max(180).optional(),
  maxDistanceKm: z.number().min(0.5).max(30).optional(),
  onboardingComplete: z.boolean().optional(),
});

export const favoriteSchema = z.object({
  targetType: z.enum(['food', 'restaurant']),
  id: z.string(),
});

export const ratingSchema = z.object({
  targetType: z.enum(['food', 'restaurant']),
  id: z.string(),
  value: z.number().int().min(1).max(5),
});

export const addressSchema = z.object({
  label: z.string().max(40).optional(),
  line1: z.string().min(4).max(160),
  line2: z.string().max(160).optional(),
  city: z.string().max(60).optional(),
  pincode: z.string().max(10).optional(),
  isDefault: z.boolean().optional(),
});

export const getPreferences = asyncHandler(async (req, res) => {
  res.json({ preferences: await getOrCreatePreferences(req.userId) });
});

export const updatePreferences = asyncHandler(async (req, res) => {
  const preferences = await UserPreference.findOneAndUpdate(
    { user: req.userId },
    { $set: req.body },
    { new: true, upsert: true, runValidators: true }
  );
  res.json({ preferences });
});

/** Learned signals are user data — they must be resettable. */
export const resetLearning = asyncHandler(async (req, res) => {
  const preferences = await UserPreference.findOneAndUpdate(
    { user: req.userId },
    {
      $set: {
        cuisineAffinity: {},
        tagAffinity: {},
        priceSensitivity: 0,
        spiceDrift: 0,
        portionDrift: 0,
        dislikedFoods: [],
        dislikedRestaurants: [],
        recentFoods: [],
      },
    },
    { new: true, upsert: true }
  );
  res.json({ preferences, message: 'Learned preferences cleared. Your explicit settings were kept.' });
});

export const listFavorites = asyncHandler(async (req, res) => {
  const favorites = await Favorite.find({ user: req.userId })
    .populate('food')
    .populate('restaurant')
    .lean();

  res.json({
    foods: favorites.filter((f) => f.food).map((f) => serializeFood(f.food)),
    restaurants: favorites.filter((f) => f.restaurant).map((f) => serializeRestaurant(f.restaurant)),
  });
});

export const toggleFavorite = asyncHandler(async (req, res) => {
  const { targetType, id } = req.body;
  const filter = { user: req.userId, targetType, food: null, restaurant: null };
  if (targetType === 'food') filter.food = id;
  else filter.restaurant = id;

  const existing = await Favorite.findOne(filter);
  if (existing) {
    await existing.deleteOne();
    return res.json({ favorited: false });
  }

  const exists = targetType === 'food' ? await FoodItem.exists({ _id: id }) : await Restaurant.exists({ _id: id });
  if (!exists) throw ApiError.notFound(`That ${targetType} does not exist`);

  await Favorite.create(filter);
  res.status(201).json({ favorited: true });
});

export const rate = asyncHandler(async (req, res) => {
  const { targetType, id, value } = req.body;
  const filter = { user: req.userId, targetType, food: null, restaurant: null };
  if (targetType === 'food') filter.food = id;
  else filter.restaurant = id;

  await Rating.findOneAndUpdate(filter, { $set: { value } }, { upsert: true, new: true });

  if (targetType === 'food' && value >= 4) {
    const food = await FoodItem.findById(id).lean();
    if (food) await reinforcePositive({ userId: req.userId, foods: [food], strength: 0.06 });
  }

  res.json({ rated: true, value });
});

export const addAddress = asyncHandler(async (req, res) => {
  const user = req.user;
  if (req.body.isDefault) user.addresses.forEach((a) => { a.isDefault = false; });
  user.addresses.push({ ...req.body, isDefault: req.body.isDefault ?? user.addresses.length === 0 });
  await user.save();
  res.status(201).json({ addresses: user.addresses });
});

export const deleteAddress = asyncHandler(async (req, res) => {
  const user = req.user;
  const before = user.addresses.length;
  user.addresses = user.addresses.filter((a) => String(a._id) !== req.params.addressId);
  if (user.addresses.length === before) throw ApiError.notFound('Address not found');
  await user.save();
  res.json({ addresses: user.addresses });
});

/**
 * The dashboard: current context strip + personalised rows.
 * Works for guests too — it just skips the personalised sections.
 */
export const dashboard = asyncHandler(async (req, res) => {
  const location =
    req.query.lat != null && req.query.lng != null
      ? { lat: Number(req.query.lat), lng: Number(req.query.lng), source: 'device' }
      : null;

  const ctx = await buildContext({ location, mood: req.query.mood }, { userId: req.userId });

  const [foodRecs, nearby] = await Promise.all([
    recommendFoods(ctx, { limit: 6 }),
    discoverNearby(ctx, { limit: 6, sort: 'best' }),
  ]);

  const explained = await explainAll(foodRecs.items, ctx, { llmLimit: 0 });

  const personalised = req.userId ? await loadPersonalSections(req.userId) : null;

  res.json({
    context: {
      location: { lat: ctx.location.lat, lng: ctx.location.lng, source: ctx.location.source },
      usingApproxLocation: ctx.location.source === 'default_city',
      weather: ctx.weather,
      weatherNote: weatherSuggestion(ctx.weather),
      mealSlot: mealSlot(),
      budget: ctx.budget,
      dietType: ctx.dietType,
      mood: ctx.mood,
      isPersonalised: Boolean(req.userId),
    },
    recommendedFoods: explained.map(serializeRecommendation),
    recommendedRestaurants: nearby.map(serializeNearbyPlace),
    ...(personalised ?? { recentOrders: [], favoriteFoods: [], favoriteRestaurants: [] }),
  });
});

async function loadPersonalSections(userId) {
  const [orders, favorites] = await Promise.all([
    Order.find({ user: userId }).sort({ createdAt: -1 }).limit(5).populate('restaurant', 'name emoji slug').lean(),
    Favorite.find({ user: userId }).populate('food').populate('restaurant').lean(),
  ]);

  return {
    recentOrders: orders.map((order) => ({
      id: String(order._id),
      orderNumber: order.orderNumber,
      restaurantName: order.restaurant?.name ?? order.restaurantName,
      emoji: order.restaurant?.emoji,
      items: order.items.map((i) => `${i.quantity}× ${i.name}`),
      total: order.pricing.total,
      status: order.status,
      createdAt: order.createdAt,
    })),
    favoriteFoods: favorites.filter((f) => f.food).map((f) => serializeFood(f.food)).slice(0, 8),
    favoriteRestaurants: favorites.filter((f) => f.restaurant).map((f) => serializeRestaurant(f.restaurant)).slice(0, 8),
  };
}
