import mongoose from 'mongoose';
import { CUISINES, PRICE_CATEGORIES } from '../domain/constants.js';

const openingHourSchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    open: { type: String, required: true }, // "07:00"
    close: { type: String, required: true }, // "22:30" (may wrap past midnight)
    closed: { type: Boolean, default: false },
  },
  { _id: false }
);

const restaurantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: 'text' },
    slug: { type: String, required: true, unique: true, lowercase: true },
    tagline: String,
    emoji: { type: String, default: '🍽️' },
    coverGradient: { type: String, default: 'from-orange-400 to-rose-500' },

    cuisines: [{ type: String, enum: CUISINES }],

    // Nullable on purpose: live providers such as OpenStreetMap genuinely do
    // not publish price levels or ratings, and inventing them would be worse
    // than admitting we do not know. `*Source` says where the value came from.
    priceCategory: { type: String, enum: [...PRICE_CATEGORIES, null], default: null, index: true },
    priceSource: {
      type: String,
      enum: ['seed', 'google', 'estimated_from_venue_type', 'unavailable'],
      default: 'seed',
    },
    avgCostForOne: { type: Number, default: null },

    rating: { type: Number, min: 0, max: 5, default: null },
    ratingCount: { type: Number, default: 0 },
    ratingSource: { type: String, enum: ['seed', 'google', 'user', 'unavailable'], default: 'seed' },

    /** Set for venues pulled from a live provider. Unique per provider record. */
    externalId: { type: String, index: true, sparse: true, unique: true },
    provider: { type: String, enum: ['seed', 'osm', 'google'], default: 'seed' },
    website: String,
    imageUrl: String,
    imageAttribution: String,
    attribution: String,
    lastSyncedAt: Date,
    /**
     * When an indicative menu was last attached to this live venue. Recorded even
     * when no dishes matched, so a venue we cannot build a menu for is not
     * re-examined on every single request.
     */
    menuBuiltAt: Date,

    /** False when the provider listed no opening hours — never guess a schedule. */
    hoursKnown: { type: Boolean, default: true },

    address: {
      line1: String,
      area: String,
      city: String,
      pincode: String,
    },
    // GeoJSON [lng, lat] — required by MongoDB's 2dsphere index.
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    phone: String,

    isPureVeg: { type: Boolean, default: false },
    deliveryAvailable: { type: Boolean, default: true },
    dineInAvailable: { type: Boolean, default: true },

    /** Kitchen throughput inputs for the crowd/wait engine. */
    seatingCapacity: { type: Number, default: 40 },
    avgServiceMinutes: { type: Number, default: 12 },
    avgPrepMinutes: { type: Number, default: 18 },
    deliveryBaseMinutes: { type: Number, default: 20 },

    /**
     * Seeded baseline busyness, 7 x 24 matrix of 0..1 values.
     * This is our own modelled expectation — NOT live data from any map provider.
     */
    baselineCrowdCurve: {
      type: [[Number]],
      default: undefined,
      validate: {
        validator: (v) => !v || (v.length === 7 && v.every((d) => d.length === 24)),
        message: 'baselineCrowdCurve must be a 7x24 matrix',
      },
    },

    openingHours: [openingHourSchema],
    tags: [String],
    popularityIndex: { type: Number, default: 0.5, min: 0, max: 1 },

    /** Where this record came from. 'seed' is the bundled demo dataset. */
    dataSource: { type: String, enum: ['seed', 'osm', 'google', 'partner_api', 'user_submitted'], default: 'seed' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

restaurantSchema.index({ location: '2dsphere' });
restaurantSchema.index({ cuisines: 1, priceCategory: 1, rating: -1 });
restaurantSchema.index({ name: 'text', tagline: 'text' });

restaurantSchema.virtual('coords').get(function coords() {
  const [lng, lat] = this.location?.coordinates ?? [];
  return lat == null ? null : { lat, lng };
});

export const Restaurant = mongoose.model('Restaurant', restaurantSchema);
