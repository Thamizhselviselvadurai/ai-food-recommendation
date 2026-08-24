import mongoose from 'mongoose';
import { ALLERGENS, CUISINES, DIET_TYPES, SPICE_LEVELS } from '../domain/constants.js';

/**
 * Long-lived taste profile. Updated explicitly (profile screen) and implicitly
 * (orders, ratings, rejected recommendations) — see services/personalization.
 */
const userPreferenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    dietType: { type: String, enum: DIET_TYPES, default: 'nonveg' },
    maxSpiceLevel: { type: String, enum: SPICE_LEVELS, default: 'hot' },
    preferredSpiceLevel: { type: String, enum: SPICE_LEVELS, default: 'medium' },
    defaultBudget: { type: Number, default: 300 },
    caloriePreference: { type: String, enum: ['any', 'low', 'moderate', 'high'], default: 'any' },
    highProtein: { type: Boolean, default: false },
    preferredCuisines: [{ type: String, enum: CUISINES }],
    allergies: [{ type: String, enum: ALLERGENS }],
    avoidIngredients: [String], // free-text ("rice", "mushroom")
    maxWaitMinutes: { type: Number, default: 45 },
    maxDistanceKm: { type: Number, default: 6 },

    /** Learned signals — small bounded nudges, never hard filters. */
    cuisineAffinity: { type: Map, of: Number, default: {} }, // cuisine -> -1..1
    tagAffinity: { type: Map, of: Number, default: {} }, // dish tag -> -1..1
    priceSensitivity: { type: Number, default: 0, min: -1, max: 1 }, // >0 = wants cheaper
    spiceDrift: { type: Number, default: 0, min: -2, max: 2 }, // learned offset in spice steps
    portionDrift: { type: Number, default: 0, min: -1, max: 1 }, // >0 = wants more filling

    dislikedFoods: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem' }],
    dislikedRestaurants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' }],

    /** Rolling window used to avoid recommending the same dish repeatedly. */
    recentFoods: [
      {
        food: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem' },
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],

    onboardingComplete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userPreferenceSchema.methods.affinityFor = function affinityFor(map, key) {
  const value = this[map]?.get?.(key);
  return typeof value === 'number' ? value : 0;
};

export const UserPreference = mongoose.model('UserPreference', userPreferenceSchema);
