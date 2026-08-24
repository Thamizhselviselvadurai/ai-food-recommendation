import mongoose from 'mongoose';

/**
 * Every recommendation we show is persisted with the exact context and factor
 * breakdown that produced it. That is what makes "Why this recommendation?"
 * auditable rather than a story the LLM made up after the fact.
 */
const scoredItemSchema = new mongoose.Schema(
  {
    food: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem' },
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' },
    score: Number,
    matchPercent: Number,
    factors: [
      {
        key: String,
        label: String,
        weight: Number,
        score: Number,
        passed: Boolean,
        detail: String,
        _id: false,
      },
    ],
    explanation: String,
    explanationSource: { type: String, enum: ['llm', 'template'], default: 'template' },
  },
  { _id: false }
);

const recommendationHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    sessionKey: String, // guests
    surface: {
      type: String,
      enum: ['wizard', 'chat', 'near_me', 'dashboard', 'smart_decision', 'alternatives'],
      required: true,
    },
    query: String, // raw natural-language input, when there was one

    /** The resolved intent that drove scoring. */
    context: {
      mood: String,
      hungerLevel: String,
      budget: Number,
      dietType: String,
      spiceLevel: String,
      cuisines: [String],
      maxWaitMinutes: Number,
      maxDistanceKm: Number,
      avoid: [String],
      allergies: [String],
      mealSlot: String,
      weather: {
        condition: String,
        temperatureC: Number,
      },
      approxLocation: { lat: Number, lng: Number }, // coarse grid only
    },

    results: [scoredItemSchema],
    engineVersion: { type: String, default: '1.0.0' },
    intentSource: { type: String, enum: ['llm', 'rules', 'form'], default: 'form' },
    tookMs: Number,
  },
  { timestamps: true }
);

recommendationHistorySchema.index({ user: 1, createdAt: -1 });

export const RecommendationHistory = mongoose.model('RecommendationHistory', recommendationHistorySchema);
