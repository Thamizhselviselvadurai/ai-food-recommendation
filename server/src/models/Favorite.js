import mongoose from 'mongoose';

const favoriteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetType: { type: String, enum: ['food', 'restaurant'], required: true },
    food: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem' },
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' },
  },
  { timestamps: true }
);

favoriteSchema.index({ user: 1, targetType: 1, food: 1, restaurant: 1 }, { unique: true });

export const Favorite = mongoose.model('Favorite', favoriteSchema);
