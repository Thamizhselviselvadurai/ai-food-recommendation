import mongoose from 'mongoose';
import { CROWD_REPORT_LEVELS } from '../domain/constants.js';

/** A user telling us how busy a place actually was. The ground truth signal. */
const crowdReportSchema = new mongoose.Schema(
  {
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, select: false },
    anonymousKey: { type: String },

    level: { type: String, enum: CROWD_REPORT_LEVELS, required: true },
    observedWaitMinutes: { type: Number, min: 0, max: 240 },
    note: { type: String, maxlength: 200 },

    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    hour: { type: Number, min: 0, max: 23, required: true },
    reportedFor: { type: Date, default: Date.now },
    source: { type: String, enum: ['user', 'simulated'], default: 'user' },
  },
  { timestamps: true }
);

crowdReportSchema.index({ restaurant: 1, createdAt: -1 });
crowdReportSchema.index({ restaurant: 1, dayOfWeek: 1, hour: 1 });

export const CrowdReport = mongoose.model('CrowdReport', crowdReportSchema);
