import { env } from '../../config/env.js';

let disabledUntil = 0;

/**
 * Thin client for the optional Python crowd-prediction service (see /ml).
 *
 * Contract:
 *   POST {ML_CROWD_SERVICE_URL}/predict
 *   body: { items: [ { restaurantId, dayOfWeek, hour, ... } ] }
 *   200:  { predictions: [ { restaurantId, score, level, waitMinutes, modelVersion } ] }
 *
 * Any failure (unset URL, timeout, bad payload) returns null and the caller
 * keeps the deterministic rule-based estimate. A failing service is
 * circuit-broken for 60s so we do not add latency to every request.
 */
export async function predictWithMlService(items) {
  if (!env.ML_CROWD_SERVICE_URL || !items?.length) return null;
  if (Date.now() < disabledUntil) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ML_CROWD_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.ML_CROWD_SERVICE_URL.replace(/\/$/, '')}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`ML service responded ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.predictions) ? data.predictions : null;
  } catch (error) {
    disabledUntil = Date.now() + 60_000;
    console.warn(`[crowd/ml] falling back to rule engine for 60s: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
