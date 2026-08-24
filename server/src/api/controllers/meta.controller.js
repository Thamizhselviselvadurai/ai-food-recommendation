import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { isMemoryDb } from '../../config/db.js';
import { FoodItem, Restaurant } from '../../models/index.js';
import { getWeather, weatherSuggestion } from '../../services/weather/weatherService.js';
import { aiStatus } from '../../services/ai/client.js';
import { CROWD_ENGINE_VERSION } from '../../services/crowd/crowdEngine.js';
import { ENGINE_VERSION } from '../../services/recommendation/engine.js';
import { DAY_NAMES, mealSlot, nowParts } from '../../utils/time.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const health = asyncHandler(async (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  const [restaurants, foods] = dbUp
    ? await Promise.all([Restaurant.estimatedDocumentCount(), FoodItem.estimatedDocumentCount()])
    : [0, 0];

  res.status(dbUp ? 200 : 503).json({
    status: dbUp ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    database: {
      connected: dbUp,
      mode: isMemoryDb() ? 'in-memory (ephemeral demo)' : 'mongodb',
      restaurants,
      foods,
      seeded: restaurants > 0 && foods > 0,
    },
    ai: aiStatus(),
    weatherProvider: env.WEATHER_PROVIDER,
    crowdSource: env.ML_CROWD_SERVICE_URL ? 'ml-service-with-rule-fallback' : 'rule-engine',
    engines: { recommendation: ENGINE_VERSION, crowd: CROWD_ENGINE_VERSION },
  });
});

/** Everything the dashboard's "current context" strip needs, in one call. */
export const context = asyncHandler(async (req, res) => {
  const lat = req.query.lat != null ? Number(req.query.lat) : env.DEFAULT_LAT;
  const lng = req.query.lng != null ? Number(req.query.lng) : env.DEFAULT_LNG;
  const usingApprox = req.query.lat == null || req.query.lng == null;

  const weather = await getWeather({ lat, lng });
  const parts = nowParts();

  res.json({
    time: {
      iso: new Date().toISOString(),
      dayName: DAY_NAMES[parts.dayOfWeek],
      hour: parts.hour,
      isWeekend: parts.isWeekend,
      mealSlot: mealSlot(),
    },
    location: {
      lat,
      lng,
      source: usingApprox ? 'default_city' : 'device',
      city: usingApprox ? env.DEFAULT_CITY : undefined,
      note: usingApprox
        ? 'Using a default city centre because location was not shared. Nearby results are approximate.'
        : 'Your location is used only for this request and is never stored precisely.',
    },
    weather,
    weatherNote: weatherSuggestion(weather),
    ai: aiStatus(),
  });
});
