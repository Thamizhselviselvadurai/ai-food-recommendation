import mongoose from 'mongoose';
import {
  ALLERGENS, CUISINES, DIET_TYPES, FOOD_CATEGORIES, MEAL_SLOTS, MOOD_IDS, SPICE_LEVELS,
} from '../domain/constants.js';

const foodItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, index: true },
    description: { type: String, maxlength: 400 },
    emoji: { type: String, default: '🍛' },

    /**
     * Real photograph of the dish. Resolved at seed time from Wikimedia Commons
     * (CC-licensed press/community photography), never AI-generated. The client
     * falls back to the emoji tile if the URL fails to load.
     */
    imageUrl: String,
    imageAttribution: String,
    /**
     * When a photo lookup was last attempted — recorded even when it found
     * nothing, so a dish with no usable article is not re-queried on every
     * single boot. Clear this field to force a retry.
     */
    imageResolvedAt: Date,

    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },

    cuisine: { type: String, enum: CUISINES, required: true, index: true },
    category: { type: String, enum: FOOD_CATEGORIES, default: 'main', index: true },
    dietType: { type: String, enum: DIET_TYPES, required: true, index: true },
    spiceLevel: { type: String, enum: SPICE_LEVELS, default: 'mild' },

    price: { type: Number, required: true, min: 0, index: true },

    /**
     * Nutrition is a modelled estimate for typical serving sizes, not a lab
     * measurement. `nutritionSource` is surfaced in the UI so users know.
     */
    nutrition: {
      calories: Number,
      protein: Number, // grams
      carbs: Number,
      fat: Number,
      servingDescription: String,
    },
    nutritionSource: {
      type: String,
      enum: ['estimated', 'restaurant_provided', 'verified_database'],
      default: 'estimated',
    },

    prepTimeMinutes: { type: Number, default: 15 },

    tags: [String],
    moodTags: [{ type: String, enum: MOOD_IDS }],
    mealSlots: [{ type: String, enum: MEAL_SLOTS }],
    allergens: [{ type: String, enum: ALLERGENS }],

    rating: { type: Number, min: 0, max: 5, default: 4 },
    ratingCount: { type: Number, default: 0 },
    orderCount: { type: Number, default: 0 },
    popularity: { type: Number, default: 0.5, min: 0, max: 1 },

    isAvailable: { type: Boolean, default: true, index: true },
    /**
     * `indicative` marks a dish attached to a live (OpenStreetMap/Google) venue.
     * No keyless provider publishes real menus, so these are typical dishes for
     * the cuisine that venue is actually tagged with — the UI labels them as
     * "typical dishes, not the venue's published menu" rather than implying the
     * restaurant serves exactly this list at exactly this price.
     */
    dataSource: {
      type: String,
      enum: ['seed', 'indicative', 'partner_api', 'restaurant_managed'],
      default: 'seed',
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

foodItemSchema.index({ name: 'text', description: 'text', tags: 'text' });
foodItemSchema.index({ restaurant: 1, isAvailable: 1 });
foodItemSchema.index({ dietType: 1, price: 1 });
foodItemSchema.index({ cuisine: 1, spiceLevel: 1 });

export const FoodItem = mongoose.model('FoodItem', foodItemSchema);
