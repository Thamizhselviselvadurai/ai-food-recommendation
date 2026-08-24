import dotenv from 'dotenv';

dotenv.config();

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: num(process.env.PORT, 5000),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/food_ai',
  USE_MEMORY_DB: bool(process.env.USE_MEMORY_DB, false),

  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  AI_MODEL: process.env.AI_MODEL || 'claude-opus-5',
  AI_ENABLED: bool(process.env.AI_ENABLED, true),

  WEATHER_PROVIDER: (process.env.WEATHER_PROVIDER || 'open-meteo').toLowerCase(),
  OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY || '',

  ML_CROWD_SERVICE_URL: process.env.ML_CROWD_SERVICE_URL || '',
  ML_CROWD_TIMEOUT_MS: num(process.env.ML_CROWD_TIMEOUT_MS, 1200),

  // Live restaurant data. 'auto' prefers Google when a key exists, else OSM.
  PLACES_PROVIDER: (process.env.PLACES_PROVIDER || 'auto').toLowerCase(),
  // Total budget for one live-places lookup across every provider tried. Kept
  // well under a browser's patience: a slow provider must degrade, not hang.
  PLACES_TIMEOUT_MS: num(process.env.PLACES_TIMEOUT_MS, 12000),
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || '',

  // Real dish photography lookup (Wikimedia Commons, keyless).
  FOOD_IMAGES_ENABLED: bool(process.env.FOOD_IMAGES_ENABLED, true),

  DEFAULT_LAT: num(process.env.DEFAULT_LAT, 11.0168),
  DEFAULT_LNG: num(process.env.DEFAULT_LNG, 76.9558),
  DEFAULT_CITY: process.env.DEFAULT_CITY || 'Coimbatore',
};

/** True when a real LLM call is possible. Everything degrades gracefully otherwise. */
export const isLlmAvailable = () => env.AI_ENABLED && Boolean(env.ANTHROPIC_API_KEY);

export function assertConfig() {
  const problems = [];

  if (!env.JWT_SECRET) {
    if (env.NODE_ENV === 'production') {
      problems.push('JWT_SECRET is required in production. See server/.env.example.');
    } else {
      // Dev convenience only — never used in production because of the check above.
      env.JWT_SECRET = 'dev-only-insecure-secret-change-me';
      console.warn('[config] JWT_SECRET is not set — using an insecure development secret.');
    }
  }

  if (env.WEATHER_PROVIDER === 'openweather' && !env.OPENWEATHER_API_KEY) {
    console.warn('[config] WEATHER_PROVIDER=openweather but OPENWEATHER_API_KEY is empty — weather signal disabled.');
    env.WEATHER_PROVIDER = 'off';
  }

  if (problems.length) {
    throw new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
  }
}
