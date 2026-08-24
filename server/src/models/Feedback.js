import mongoose from 'mongoose';
import { REJECTION_REASONS } from '../domain/constants.js';

const REASON_IDS = REJECTION_REASONS.map((r) => r.id);

/** "I don't like this recommendation" + why. Feeds back into UserPreference. */
const feedbackSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recommendation: { type: mongoose.Schema.Types.ObjectId, ref: 'RecommendationHistory' },
    food: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem' },
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' },

    sentiment: { type: String, enum: ['positive', 'negative'], default: 'negative' },
    reasons: [{ type: String, enum: REASON_IDS }],
    comment: { type: String, maxlength: 300 },

    /** What we changed in the taste profile because of this. Auditable. */
    appliedAdjustments: [
      {
        field: String,
        delta: Number,
        key: String,
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

feedbackSchema.index({ user: 1, createdAt: -1 });

export const Feedback = mongoose.model('Feedback', feedbackSchema);
