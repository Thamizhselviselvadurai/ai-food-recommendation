import { CheckIn, CrowdReport, CrowdSnapshot } from '../../models/index.js';
import { CROWD_REPORT_SCORES } from '../../domain/constants.js';
import { clamp } from '../../utils/time.js';

/**
 * Rolls raw check-ins and crowd reports into per-(restaurant, day, hour)
 * historical snapshots.
 *
 * Called after every new crowd report (cheap, single restaurant) and by the
 * seeder for the whole dataset. In a larger deployment this would be a nightly
 * job or an incremental streaming aggregation.
 */
export async function recomputeSnapshots(restaurantId = null, { lookbackDays = 60 } = {}) {
  const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
  const match = { createdAt: { $gte: since } };
  if (restaurantId) match.restaurant = restaurantId;

  const [reportRows, checkInRows] = await Promise.all([
    CrowdReport.aggregate([
      { $match: match },
      {
        $group: {
          _id: { restaurant: '$restaurant', dayOfWeek: '$dayOfWeek', hour: '$hour' },
          levels: { $push: '$level' },
          waits: { $push: '$observedWaitMinutes' },
          count: { $sum: 1 },
        },
      },
    ]),
    CheckIn.aggregate([
      { $match: match },
      {
        $group: {
          _id: { restaurant: '$restaurant', dayOfWeek: '$dayOfWeek', hour: '$hour' },
          heads: { $sum: { $ifNull: ['$partySize', 1] } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const buckets = new Map();
  const keyOf = (id) => `${id.restaurant}|${id.dayOfWeek}|${id.hour}`;

  for (const row of reportRows) {
    const scores = row.levels.map((l) => CROWD_REPORT_SCORES[l] ?? 50);
    const waits = row.waits.filter((w) => typeof w === 'number');
    buckets.set(keyOf(row._id), {
      ...row._id,
      reportScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      reportCount: row.count,
      checkInCount: 0,
      checkInScore: null,
      avgObservedWaitMinutes: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : undefined,
    });
  }

  for (const row of checkInRows) {
    const key = keyOf(row._id);
    // Check-ins per hour are converted to a 0..100 pressure score. 10 heads in
    // one hour at a mid-size venue reads as "busy".
    const checkInScore = clamp((row.heads / 12) * 100, 0, 100);
    const existing = buckets.get(key);
    if (existing) {
      existing.checkInCount = row.count;
      existing.checkInScore = checkInScore;
    } else {
      buckets.set(key, {
        ...row._id,
        reportScore: null,
        reportCount: 0,
        checkInCount: row.count,
        checkInScore,
        avgObservedWaitMinutes: undefined,
      });
    }
  }

  const operations = [];
  for (const bucket of buckets.values()) {
    // Visitor reports are ground truth; check-in volume is a proxy. Blend when
    // we have both, otherwise use whichever exists.
    let avgScore;
    if (bucket.reportScore != null && bucket.checkInScore != null) {
      avgScore = bucket.reportScore * 0.65 + bucket.checkInScore * 0.35;
    } else {
      avgScore = bucket.reportScore ?? bucket.checkInScore ?? 0;
    }

    operations.push({
      updateOne: {
        filter: { restaurant: bucket.restaurant, dayOfWeek: bucket.dayOfWeek, hour: bucket.hour },
        update: {
          $set: {
            avgScore: Math.round(clamp(avgScore, 0, 100) * 100) / 100,
            reportCount: bucket.reportCount,
            checkInCount: bucket.checkInCount,
            sampleCount: bucket.reportCount + bucket.checkInCount,
            avgObservedWaitMinutes: bucket.avgObservedWaitMinutes,
            lastComputedAt: new Date(),
          },
        },
        upsert: true,
      },
    });
  }

  if (operations.length) await CrowdSnapshot.bulkWrite(operations, { ordered: false });
  return operations.length;
}
