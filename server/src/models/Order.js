import mongoose from 'mongoose';
import { ORDER_STATUSES } from '../domain/constants.js';

const orderItemSchema = new mongoose.Schema(
  {
    food: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem', required: true },
    name: { type: String, required: true }, // denormalised: menus change, receipts must not
    emoji: String,
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    lineTotal: { type: Number, required: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    restaurantName: String,

    items: { type: [orderItemSchema], required: true },

    fulfilment: { type: String, enum: ['delivery', 'pickup'], default: 'delivery' },
    deliveryAddress: {
      label: String,
      line1: String,
      line2: String,
      city: String,
      pincode: String,
    },

    pricing: {
      subtotal: { type: Number, required: true },
      deliveryFee: { type: Number, default: 0 },
      taxes: { type: Number, default: 0 },
      total: { type: Number, required: true },
    },

    /** Demo payment only — no real gateway, no card data is ever collected. */
    payment: {
      method: { type: String, enum: ['demo_upi', 'demo_card', 'cash_on_delivery'], default: 'demo_upi' },
      status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
      reference: String,
      isSimulated: { type: Boolean, default: true },
    },

    status: { type: String, enum: ORDER_STATUSES, default: 'placed', index: true },
    statusHistory: [
      {
        status: { type: String, enum: ORDER_STATUSES },
        at: { type: Date, default: Date.now },
        note: String,
        _id: false,
      },
    ],

    etaMinutes: Number,
    placedFromRecommendation: { type: mongoose.Schema.Types.ObjectId, ref: 'RecommendationHistory' },
    notes: String,
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });

export const Order = mongoose.model('Order', orderSchema);
