import fs from 'node:fs/promises';
import path from 'node:path';
import { assertConfig } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { CrowdSnapshot, Restaurant } from '../models/index.js';

/**
 * Exports the crowd training table as CSV for the optional Python model.
 *
 *   npm run export:crowd-dataset -- ../ml/data/crowd_training.csv
 *
 * One row per (restaurant, dayOfWeek, hour) with the features the model uses
 * and `avgScore` as the label.
 */
const HEADERS = [
  'restaurant_id', 'restaurant_slug', 'day_of_week', 'hour', 'is_weekend',
  'seating_capacity', 'avg_service_minutes', 'popularity_index', 'price_category',
  'baseline_score', 'check_in_count', 'report_count', 'sample_count',
  'avg_observed_wait_minutes', 'avg_score',
];

async function main() {
  assertConfig();
  await connectDatabase();

  const outputPath = path.resolve(process.argv[2] ?? '../ml/data/crowd_training.csv');

  const [restaurants, snapshots] = await Promise.all([
    Restaurant.find({}).lean(),
    CrowdSnapshot.find({}).lean(),
  ]);
  const byId = new Map(restaurants.map((r) => [String(r._id), r]));

  const rows = [HEADERS.join(',')];
  for (const snapshot of snapshots) {
    const restaurant = byId.get(String(snapshot.restaurant));
    if (!restaurant) continue;

    rows.push([
      String(snapshot.restaurant),
      restaurant.slug,
      snapshot.dayOfWeek,
      snapshot.hour,
      [0, 6].includes(snapshot.dayOfWeek) ? 1 : 0,
      restaurant.seatingCapacity ?? 40,
      restaurant.avgServiceMinutes ?? 12,
      restaurant.popularityIndex ?? 0.5,
      restaurant.priceCategory,
      Math.round((restaurant.baselineCrowdCurve?.[snapshot.dayOfWeek]?.[snapshot.hour] ?? 0) * 100),
      snapshot.checkInCount ?? 0,
      snapshot.reportCount ?? 0,
      snapshot.sampleCount ?? 0,
      snapshot.avgObservedWaitMinutes ?? '',
      snapshot.avgScore.toFixed(2),
    ].join(','));
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${rows.join('\n')}\n`, 'utf8');

  console.log(`[export] ${rows.length - 1} rows -> ${outputPath}`);
  await disconnectDatabase();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('[export] failed:', error);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
