import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorName: String,
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    food: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, maxlength: 120 },
    body: { type: String, maxlength: 1500 },
    visitedAt: Date,
    helpfulCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

reviewSchema.index({ restaurant: 1, createdAt: -1 });

export const Review = mongoose.model('Review', reviewSchema);
