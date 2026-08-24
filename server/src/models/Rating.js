import mongoose from 'mongoose';

const ratingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetType: { type: String, enum: ['food', 'restaurant'], required: true },
    food: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem' },
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    value: { type: Number, required: true, min: 1, max: 5 },
  },
  { timestamps: true }
);

ratingSchema.index({ user: 1, targetType: 1, food: 1, restaurant: 1 }, { unique: true });

export const Rating = mongoose.model('Rating', ratingSchema);
