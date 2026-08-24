import mongoose from 'mongoose';

/**
 * "I'm at this restaurant right now."
 *
 * Privacy: we store the restaurant, a coarse timestamp and an *anonymised*
 * actor key. `user` is kept only to stop one person spamming check-ins and is
 * never exposed through any read API. No precise coordinates are stored.
 */
const checkInSchema = new mongoose.Schema(
  {
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, select: false },
    anonymousKey: { type: String, index: true }, // hashed device/session id for guests
    partySize: { type: Number, default: 1, min: 1, max: 20 },
    source: { type: String, enum: ['user', 'order', 'simulated'], default: 'user' },

    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    hour: { type: Number, min: 0, max: 23, required: true },

    /** Check-ins age out — a 3-hour-old check-in says nothing about right now. */
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

checkInSchema.index({ restaurant: 1, createdAt: -1 });
checkInSchema.index({ restaurant: 1, dayOfWeek: 1, hour: 1 });

export const CheckIn = mongoose.model('CheckIn', checkInSchema);
