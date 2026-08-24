import mongoose from 'mongoose';

/**
 * Rolled-up historical pattern per (restaurant, dayOfWeek, hour).
 *
 * Recomputed from CheckIns + CrowdReports by services/crowd/aggregate.js.
 * This is the "Friday 8 PM is usually very busy" memory, and it is also the
 * training table exported for the optional Python ML model.
 */
const crowdSnapshotSchema = new mongoose.Schema(
  {
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    hour: { type: Number, min: 0, max: 23, required: true },

    avgScore: { type: Number, min: 0, max: 100, required: true },
    checkInCount: { type: Number, default: 0 },
    reportCount: { type: Number, default: 0 },
    sampleCount: { type: Number, default: 0 },
    avgObservedWaitMinutes: Number,

    lastComputedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

crowdSnapshotSchema.index({ restaurant: 1, dayOfWeek: 1, hour: 1 }, { unique: true });

export const CrowdSnapshot = mongoose.model('CrowdSnapshot', crowdSnapshotSchema);
