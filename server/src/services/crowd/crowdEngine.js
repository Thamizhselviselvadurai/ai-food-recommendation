import { CheckIn, CrowdReport, CrowdSnapshot } from '../../models/index.js';
import { CROWD_REPORT_SCORES } from '../../domain/constants.js';
import { clamp, isOpenAt, nowParts } from '../../utils/time.js';
import { baselineAt } from './baseline.js';
import { predictWithMlService } from './mlClient.js';

export const CROWD_ENGINE_VERSION = '1.2.0-rules';

const LIVE_CHECKIN_WINDOW_MIN = 75;
const RECENT_REPORT_WINDOW_MIN = 120;

/**
 * ---------------------------------------------------------------------------
 * Restaurant Crowd Estimation System (ours, not anybody else's)
 * ---------------------------------------------------------------------------
 * We combine four independent signals, each with its own confidence:
 *
 *   1. Baseline curve      how busy this venue usually is at this hour
 *   2. Historical pattern  rolled-up check-ins + crowd reports for this
 *                          (day, hour) slot — the "Friday 8 PM is packed" memory
 *   3. Live check-ins      people who said "I'm here now", vs. seating capacity
 *   4. Fresh crowd reports what visitors reported in the last two hours
 *
 * Weights are re-normalised over whichever signals actually have data, so a
 * venue with no reports still gets a sensible answer from its baseline, and a
 * venue with 20 live check-ins is driven mostly by those.
 *
 * The output is explicitly an ESTIMATE and is labelled as such in the UI.
 * ---------------------------------------------------------------------------
 */

const SIGNAL_WEIGHTS = {
  baseline: 0.34,
  historical: 0.24,
  liveCheckIns: 0.27,
  recentReports: 0.15,
};

export function levelFromScore(score) {
  if (score < 35) return 'low';
  if (score < 68) return 'moderate';
  return 'high';
}

export const CROWD_LEVEL_META = {
  low: { emoji: '🟢', label: 'Low Crowd' },
  moderate: { emoji: '🟡', label: 'Moderate Crowd' },
  high: { emoji: '🔴', label: 'High Crowd' },
};

/**
 * Converts a crowd score into an expected wait band.
 * Slow-service venues get punished harder at the same crowd level.
 */
function waitRangeFor(score, restaurant) {
  const service = restaurant?.avgServiceMinutes ?? 12;
  const throughput = clamp(service / 12, 0.55, 1.9);
  const load = clamp(score / 100, 0, 1);

  const centre = 3 + load ** 1.9 * 42 * throughput;
  const min = Math.max(0, Math.round((centre * 0.7) / 5) * 5);
  const max = Math.max(min + 5, Math.round((centre * 1.35) / 5) * 5);
  return { min, max, label: min === 0 ? `Under ${max} min` : `${min}–${max} min` };
}

function confidenceFrom(samples) {
  if (samples >= 12) return 'high';
  if (samples >= 4) return 'medium';
  return 'low';
}

/**
 * Contextual nudges. Small and explainable — never enough to flip a quiet venue
 * into a packed one on their own.
 */
function contextModifier({ weather, date }) {
  const notes = [];
  let delta = 0;
  const { isWeekend, hour } = nowParts(date);

  if (weather?.condition === 'rainy') {
    delta -= 6;
    notes.push('Rain usually thins out walk-in traffic');
  }
  if (weather?.condition === 'hot' && hour >= 12 && hour <= 16) {
    delta -= 4;
    notes.push('Midday heat usually reduces walk-ins');
  }
  if (isWeekend && hour >= 19) {
    delta += 4;
    notes.push('Weekend dinner hours run busier');
  }
  return { delta, notes };
}

/**
 * Core estimator. Pure function over already-fetched signals so it can be
 * unit-tested and batched without extra round-trips.
 */
export function estimateFromSignals({ restaurant, snapshot, liveCheckIns = [], recentReports = [], weather, date = new Date() }) {
  const open = isOpenAt(restaurant.openingHours, date);
  const signals = [];

  // 1 — baseline
  const baseline = baselineAt(restaurant.baselineCrowdCurve, date) * 100;
  const parts = [{ key: 'baseline', score: baseline, weight: SIGNAL_WEIGHTS.baseline, confidence: 1 }];
  signals.push({
    key: 'baseline',
    label: 'Typical business at this hour',
    value: Math.round(baseline),
    detail: 'Modelled from this venue’s own service profile and past activity',
  });

  // 2 — historical pattern for this (day, hour)
  if (snapshot && snapshot.sampleCount > 0) {
    const confidence = clamp(snapshot.sampleCount / 10, 0.15, 1);
    parts.push({ key: 'historical', score: snapshot.avgScore, weight: SIGNAL_WEIGHTS.historical, confidence });
    signals.push({
      key: 'historical',
      label: 'Historical pattern for this slot',
      value: Math.round(snapshot.avgScore),
      detail: `${snapshot.sampleCount} past observation${snapshot.sampleCount === 1 ? '' : 's'} for this day and hour`,
    });
  }

  // 3 — live check-ins vs. capacity
  if (liveCheckIns.length) {
    const heads = liveCheckIns.reduce((sum, c) => sum + (c.partySize || 1), 0);
    const capacity = Math.max(8, restaurant.seatingCapacity || 40);
    const occupancy = heads / capacity;
    const score = clamp(occupancy * 115, 0, 100);
    const confidence = clamp(liveCheckIns.length / 6, 0.2, 1);
    parts.push({ key: 'liveCheckIns', score, weight: SIGNAL_WEIGHTS.liveCheckIns, confidence });
    signals.push({
      key: 'liveCheckIns',
      label: 'People checked in right now',
      value: heads,
      detail: `${heads} guest${heads === 1 ? '' : 's'} checked in within the last ${LIVE_CHECKIN_WINDOW_MIN} minutes`,
    });
  }

  // 4 — fresh crowd reports
  if (recentReports.length) {
    // Newer reports count for more.
    let weighted = 0;
    let weightSum = 0;
    for (const report of recentReports) {
      const ageMin = (date - new Date(report.createdAt)) / 60000;
      const recency = clamp(1 - ageMin / RECENT_REPORT_WINDOW_MIN, 0.1, 1);
      weighted += (CROWD_REPORT_SCORES[report.level] ?? 50) * recency;
      weightSum += recency;
    }
    const score = weightSum ? weighted / weightSum : 50;
    const confidence = clamp(recentReports.length / 4, 0.25, 1);
    parts.push({ key: 'recentReports', score, weight: SIGNAL_WEIGHTS.recentReports, confidence });
    signals.push({
      key: 'recentReports',
      label: 'Recent visitor reports',
      value: recentReports.length,
      detail: `${recentReports.length} report${recentReports.length === 1 ? '' : 's'} in the last ${Math.round(RECENT_REPORT_WINDOW_MIN / 60)} hours`,
    });
  }

  // Weighted blend, re-normalised over the signals we actually have.
  const totalWeight = parts.reduce((sum, p) => sum + p.weight * p.confidence, 0) || 1;
  let score = parts.reduce((sum, p) => sum + p.score * p.weight * p.confidence, 0) / totalWeight;

  const { delta, notes } = contextModifier({ weather, date });
  score = clamp(score + delta, 0, 100);

  if (!open) score = 0;

  const sampleCount =
    (snapshot?.sampleCount ?? 0) + liveCheckIns.length * 2 + recentReports.length * 3;

  const level = levelFromScore(score);
  const wait = open ? waitRangeFor(score, restaurant) : { min: 0, max: 0, label: 'Closed' };

  return {
    score: Math.round(score),
    level,
    levelEmoji: CROWD_LEVEL_META[level].emoji,
    levelLabel: CROWD_LEVEL_META[level].label,
    isOpen: open,
    waitMinutes: wait,
    confidence: confidenceFrom(sampleCount),
    signals,
    contextNotes: notes,
    source: 'rules',
    engineVersion: CROWD_ENGINE_VERSION,
    /** Users must not read this as a live occupancy feed. */
    disclaimer: 'Estimated from our own check-ins, visitor reports and historical patterns.',
    computedAt: date.toISOString(),
  };
}

/**
 * Batched estimator: three queries total regardless of how many restaurants.
 * Use this everywhere a list is rendered.
 */
export async function estimateForRestaurants(restaurants, { weather, date = new Date() } = {}) {
  if (!restaurants.length) return new Map();

  const ids = restaurants.map((r) => r._id);
  const { dayOfWeek, hour } = nowParts(date);
  const checkInSince = new Date(date.getTime() - LIVE_CHECKIN_WINDOW_MIN * 60000);
  const reportSince = new Date(date.getTime() - RECENT_REPORT_WINDOW_MIN * 60000);

  const [snapshots, checkIns, reports] = await Promise.all([
    CrowdSnapshot.find({ restaurant: { $in: ids }, dayOfWeek, hour }).lean(),
    CheckIn.find({ restaurant: { $in: ids }, createdAt: { $gte: checkInSince } })
      .select('restaurant partySize createdAt')
      .lean(),
    CrowdReport.find({ restaurant: { $in: ids }, createdAt: { $gte: reportSince } })
      .select('restaurant level createdAt observedWaitMinutes')
      .lean(),
  ]);

  const groupBy = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const key = String(row.restaurant);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  };

  const snapshotMap = new Map(snapshots.map((s) => [String(s.restaurant), s]));
  const checkInMap = groupBy(checkIns);
  const reportMap = groupBy(reports);

  const results = new Map();
  for (const restaurant of restaurants) {
    const key = String(restaurant._id);
    results.set(
      key,
      estimateFromSignals({
        restaurant,
        snapshot: snapshotMap.get(key),
        liveCheckIns: checkInMap.get(key) ?? [],
        recentReports: reportMap.get(key) ?? [],
        weather,
        date,
      })
    );
  }

  // Optional ML upgrade. Never blocks or breaks the response.
  await applyMlPredictions(restaurants, results, { date, snapshotMap, checkInMap, reportMap });

  return results;
}

export async function estimateForRestaurant(restaurant, options = {}) {
  const map = await estimateForRestaurants([restaurant], options);
  return map.get(String(restaurant._id));
}

/**
 * If an ML crowd service is configured, let it override the rule-based score.
 * The rule engine stays the contract and the fallback, so the app is fully
 * functional with no Python service running.
 */
async function applyMlPredictions(restaurants, results, { date, snapshotMap, checkInMap, reportMap }) {
  const { dayOfWeek, hour, isWeekend } = nowParts(date);

  const features = restaurants.map((restaurant) => {
    const key = String(restaurant._id);
    const checkIns = checkInMap.get(key) ?? [];
    return {
      restaurantId: key,
      dayOfWeek,
      hour,
      isWeekend: isWeekend ? 1 : 0,
      seatingCapacity: restaurant.seatingCapacity ?? 40,
      avgServiceMinutes: restaurant.avgServiceMinutes ?? 12,
      popularityIndex: restaurant.popularityIndex ?? 0.5,
      baselineScore: results.get(key)?.score ?? 0,
      recentCheckIns: checkIns.reduce((s, c) => s + (c.partySize || 1), 0),
      recentReports: (reportMap.get(key) ?? []).length,
      historicalAvg: snapshotMap.get(key)?.avgScore ?? null,
    };
  });

  const predictions = await predictWithMlService(features);
  if (!predictions) return;

  for (const prediction of predictions) {
    const existing = results.get(prediction.restaurantId);
    if (!existing || !existing.isOpen || typeof prediction.score !== 'number') continue;
    const score = clamp(prediction.score, 0, 100);
    const level = prediction.level ?? levelFromScore(score);
    results.set(prediction.restaurantId, {
      ...existing,
      score: Math.round(score),
      level,
      levelEmoji: CROWD_LEVEL_META[level]?.emoji ?? existing.levelEmoji,
      levelLabel: CROWD_LEVEL_META[level]?.label ?? existing.levelLabel,
      waitMinutes: prediction.waitMinutes ?? existing.waitMinutes,
      source: 'ml',
      engineVersion: prediction.modelVersion ?? 'ml',
      signals: [
        ...existing.signals,
        { key: 'ml', label: 'ML crowd model', value: Math.round(score), detail: 'Prediction from the trained crowd model' },
      ],
    });
  }
}

/**
 * Hour-by-hour outlook used by the restaurant page chart ("Friday 12 PM ->
 * medium, 1 PM -> high, ..."). History is layered on the baseline where we have it.
 */
export async function hourlyOutlook(restaurant, dayOfWeek = new Date().getDay()) {
  const snapshots = await CrowdSnapshot.find({ restaurant: restaurant._id, dayOfWeek }).lean();
  const byHour = new Map(snapshots.map((s) => [s.hour, s]));
  const curve = restaurant.baselineCrowdCurve ?? [];

  return Array.from({ length: 24 }, (_, hour) => {
    const baseline = (curve?.[dayOfWeek]?.[hour] ?? 0) * 100;
    const snapshot = byHour.get(hour);
    const blend = snapshot?.sampleCount
      ? (baseline * 0.55 + snapshot.avgScore * 0.45)
      : baseline;
    const score = Math.round(clamp(blend, 0, 100));
    return {
      hour,
      score,
      level: score === 0 ? 'closed' : levelFromScore(score),
      samples: snapshot?.sampleCount ?? 0,
    };
  });
}
