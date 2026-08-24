import { env } from '../../config/env.js';
import { haversineKm } from '../../utils/geo.js';

/**
 * ---------------------------------------------------------------------------
 * REAL restaurant data from OpenStreetMap via the Overpass API.
 * ---------------------------------------------------------------------------
 * No API key, no scraping, no terms-of-service grey area — Overpass is a public
 * read API over ODbL-licensed community map data, and it covers the whole world.
 * This is what makes "restaurants near me" work at the user's ACTUAL location
 * instead of only where the bundled demo dataset happens to sit.
 *
 * What OSM genuinely provides: name, coordinates, amenity type, cuisine tags,
 * address, phone, website, opening hours, diet/takeaway/delivery flags.
 *
 * What OSM does NOT provide: star ratings, price levels, photos, menus.
 * We do not invent them. `rating` stays null and `priceSource` is marked
 * `estimated_from_venue_type`, which the UI surfaces verbatim.
 * ---------------------------------------------------------------------------
 */

/**
 * Overpass mirrors, tried in order. The public mirrors go down or return 502/504
 * regularly, so the list is deliberately long and every attempt is capped by its
 * own short timeout — one dead mirror must never stall the request.
 *
 * `regional: true` marks an extract that only covers part of the world. Those
 * legitimately answer 200 with zero elements outside their region, so an empty
 * result from them means "ask someone else", not "there is no food here".
 */
const ENDPOINTS = [
  { url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter' },
  { url: 'https://overpass-api.de/api/interpreter' },
  { url: 'https://overpass.kumi.systems/api/interpreter' },
  { url: 'https://overpass.private.coffee/api/interpreter' },
  { url: 'https://overpass.osm.jp/api/interpreter' },
  { url: 'https://overpass.osm.ch/api/interpreter', regional: true },
];

const AMENITIES = 'restaurant|fast_food|cafe|food_court|ice_cream';

/** OSM cuisine tag -> our cuisine vocabulary. Unmapped values are dropped. */
const CUISINE_MAP = {
  indian: 'north_indian', south_indian: 'south_indian', north_indian: 'north_indian',
  chettinad: 'chettinad', andhra: 'andhra', kerala: 'kerala', tamil: 'south_indian',
  biryani: 'andhra', chinese: 'chinese', asian: 'chinese', noodle: 'chinese',
  italian: 'italian', pizza: 'italian', pasta: 'italian',
  american: 'continental', burger: 'continental', sandwich: 'continental',
  international: 'continental', continental: 'continental', breakfast: 'south_indian',
  arab: 'arabian', lebanese: 'arabian', kebab: 'arabian', shawarma: 'arabian',
  turkish: 'arabian', mediterranean: 'arabian',
  bakery: 'bakery', cake: 'bakery', pastry: 'bakery', dessert: 'desserts',
  ice_cream: 'desserts', juice: 'beverages', coffee_shop: 'beverages',
  coffee: 'beverages', tea: 'beverages', regional: 'south_indian',
  street_food: 'street_food', vegetarian: 'south_indian', vegan: 'healthy',
  salad: 'healthy', healthy: 'healthy', seafood: 'kerala', fish: 'kerala',
};

/**
 * Venue type is a genuine signal about price band, but it is an inference, not
 * data. Everything downstream carries `priceSource` so the UI can say so.
 */
const PRICE_BY_AMENITY = {
  fast_food: 'low',
  ice_cream: 'low',
  cafe: 'low',
  food_court: 'low',
  restaurant: 'medium',
};

const EMOJI_BY_AMENITY = {
  restaurant: '🍽️', fast_food: '🍔', cafe: '☕', food_court: '🍱', ice_cream: '🍨',
};

const GRADIENTS = [
  'from-orange-400 to-rose-500', 'from-rose-500 to-red-700', 'from-amber-400 to-orange-600',
  'from-emerald-500 to-teal-600', 'from-violet-500 to-indigo-600', 'from-cyan-500 to-blue-600',
  'from-lime-500 to-emerald-700', 'from-fuchsia-500 to-pink-600',
];

/** Stable per-venue gradient so a place looks the same on every render. */
const gradientFor = (id) => {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
};

function buildQuery({ lat, lng, radiusM, limit, timeoutSeconds }) {
  const filter = `["amenity"~"^(${AMENITIES})$"]["name"]`;
  return `[out:json][timeout:${timeoutSeconds}];` +
    `(node${filter}(around:${radiusM},${lat},${lng});` +
    `way${filter}(around:${radiusM},${lat},${lng}););` +
    `out center tags ${limit};`;
}

/**
 * Parses an OSM `opening_hours` value into our weekly window format.
 * Deliberately conservative: anything it cannot parse confidently returns null,
 * and a null means "hours unknown" rather than a guessed schedule.
 */
const DAY_INDEX = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
const DAY_ORDER = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];

export function parseOpeningHours(value) {
  if (!value || typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();

  if (text === '24/7') {
    return Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, open: '00:00', close: '23:59', closed: false }));
  }

  const windows = [];
  for (const rule of text.split(';')) {
    const match = rule.trim().match(/^([a-z,\-\s]*)\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*,?\s*)+)$/);
    if (!match) continue;

    const days = expandDays(match[1].trim());
    if (!days.length) continue;

    for (const span of match[2].split(',')) {
      const times = span.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      if (!times) continue;
      const open = times[1].padStart(5, '0');
      const close = times[2].padStart(5, '0');
      for (const dayOfWeek of days) windows.push({ dayOfWeek, open, close, closed: false });
    }
  }

  return windows.length ? windows : null;
}

function expandDays(spec) {
  if (!spec) return [0, 1, 2, 3, 4, 5, 6]; // no day prefix means every day
  const days = new Set();

  for (const part of spec.split(',')) {
    const token = part.trim();
    if (!token) continue;

    const range = token.match(/^([a-z]{2})\s*-\s*([a-z]{2})$/);
    if (range && DAY_INDEX[range[1]] !== undefined && DAY_INDEX[range[2]] !== undefined) {
      let cursor = DAY_ORDER.indexOf(range[1]);
      const end = DAY_ORDER.indexOf(range[2]);
      for (let guard = 0; guard < 8; guard += 1) {
        days.add(cursor);
        if (cursor === end) break;
        cursor = (cursor + 1) % 7;
      }
      continue;
    }
    if (DAY_INDEX[token] !== undefined) days.add(DAY_INDEX[token]);
  }
  return [...days];
}

function mapCuisines(tags) {
  const raw = `${tags.cuisine ?? ''};${tags['cuisine:1'] ?? ''}`.toLowerCase();
  const mapped = new Set();

  for (const token of raw.split(/[;,]/)) {
    const key = token.trim().replace(/\s+/g, '_');
    if (CUISINE_MAP[key]) mapped.add(CUISINE_MAP[key]);
  }
  if (tags.amenity === 'cafe') mapped.add('beverages');
  if (tags.amenity === 'ice_cream') mapped.add('desserts');
  if (tags.amenity === 'fast_food' && !mapped.size) mapped.add('street_food');
  if (!mapped.size) mapped.add('south_indian'); // regional default for unlabelled venues

  return [...mapped].slice(0, 4);
}

function toRestaurant(element, origin) {
  return buildOsmVenue(
    {
      osmType: element.type,
      osmId: element.id,
      lat: element.lat ?? element.center?.lat,
      lng: element.lon ?? element.center?.lon,
      tags: element.tags ?? {},
    },
    origin
  );
}

/**
 * Maps a raw OSM venue (from Overpass *or* Nominatim) into our restaurant shape.
 * Shared so both providers produce byte-identical documents and therefore share
 * the same `externalId`, which keeps check-ins and favourites stable no matter
 * which provider happened to answer.
 */
export function buildOsmVenue({ osmType, osmId, lat, lng, tags = {} }, origin) {
  if (lat == null || lng == null || !tags.name || !osmType || osmId == null) return null;

  const externalId = `osm:${osmType}/${osmId}`;
  const amenity = tags.amenity ?? 'restaurant';
  const element = { type: osmType, id: osmId };
  const openingHours = parseOpeningHours(tags.opening_hours);

  const addressParts = [
    tags['addr:housenumber'] && tags['addr:street']
      ? `${tags['addr:housenumber']} ${tags['addr:street']}`
      : tags['addr:street'],
    tags['addr:suburb'] ?? tags['addr:neighbourhood'],
  ].filter(Boolean);

  return {
    externalId,
    provider: 'osm',
    name: tags.name,
    slug: `osm-${element.type}-${element.id}`,
    tagline: tags.cuisine ? tags.cuisine.replace(/[_;]/g, ' ') : amenity.replace(/_/g, ' '),
    emoji: EMOJI_BY_AMENITY[amenity] ?? '🍽️',
    coverGradient: gradientFor(externalId),
    cuisines: mapCuisines(tags),

    // Inferred from venue type, never presented as fact.
    priceCategory: PRICE_BY_AMENITY[amenity] ?? 'medium',
    priceSource: 'estimated_from_venue_type',
    avgCostForOne: null,

    // OpenStreetMap has no ratings. We do not invent one.
    rating: null,
    ratingCount: 0,
    ratingSource: 'unavailable',

    address: {
      line1: addressParts.join(', ') || null,
      area: tags['addr:suburb'] ?? tags['addr:neighbourhood'] ?? tags['addr:city'] ?? null,
      city: tags['addr:city'] ?? null,
      pincode: tags['addr:postcode'] ?? null,
    },
    location: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
    phone: tags.phone ?? tags['contact:phone'] ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,

    isPureVeg: tags['diet:vegetarian'] === 'only' || tags.cuisine === 'vegetarian',
    deliveryAvailable: tags.delivery === 'yes',
    dineInAvailable: tags.takeaway !== 'only',

    openingHours: openingHours ?? [],
    hoursKnown: Boolean(openingHours),
    rawOpeningHours: tags.opening_hours ?? null,

    // Neutral defaults — the crowd engine's confidence reporting makes the
    // resulting uncertainty visible rather than hiding it.
    seatingCapacity: amenity === 'fast_food' ? 24 : 45,
    avgServiceMinutes: amenity === 'fast_food' ? 7 : 14,
    avgPrepMinutes: amenity === 'fast_food' ? 10 : 18,
    deliveryBaseMinutes: 22,
    popularityIndex: 0.5,

    tags: [amenity, tags.takeaway === 'yes' ? 'takeaway' : null, tags.outdoor_seating === 'yes' ? 'outdoor_seating' : null].filter(Boolean),
    dataSource: 'osm',
    attribution: '© OpenStreetMap contributors (ODbL)',
    distanceKm: origin ? haversineKm(origin, { lat, lng }) : null,
  };
}

/**
 * Fetches real nearby venues. Falls through a list of Overpass mirrors, and
 * returns [] (never throws) so a provider outage degrades to the next provider
 * instead of breaking the screen.
 *
 * Two rules keep a bad mirror from stalling the page:
 *  - every attempt gets its own short timeout (`perTryMs`), and
 *  - the whole walk stops once `deadline` passes, however many mirrors are left.
 * A 200 carrying zero elements is treated as "this mirror has nothing", not as
 * an authoritative "there are no restaurants here", so the walk continues.
 */
export async function searchNearbyOsm({ lat, lng, radiusKm = 3, limit = 60, deadline, perTryMs } = {}) {
  const budgetMs = Math.max(2000, env.PLACES_TIMEOUT_MS);
  const attemptMs = perTryMs ?? Math.min(8000, budgetMs);
  const stopAt = deadline ?? Date.now() + budgetMs;

  const query = buildQuery({
    lat,
    lng,
    radiusM: Math.round(radiusKm * 1000),
    limit,
    timeoutSeconds: Math.max(5, Math.round(attemptMs / 1000)),
  });
  const body = `data=${encodeURIComponent(query)}`;

  for (const endpoint of ENDPOINTS) {
    const remaining = stopAt - Date.now();
    if (remaining <= 500) {
      console.warn('[places/osm] time budget exhausted — giving up on Overpass');
      break;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(attemptMs, remaining));
    const startedAt = Date.now();
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass asks API consumers to identify themselves.
          'User-Agent': 'FoodAI/1.0 (open-source food discovery demo)',
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      const places = (data.elements ?? [])
        .map((element) => toRestaurant(element, { lat, lng }))
        .filter(Boolean)
        .filter((place) => place.distanceKm == null || place.distanceKm <= radiusKm * 1.05)
        .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));

      if (!places.length) {
        // Regional extracts answer 200/empty for most of the world; even a global
        // mirror can return an empty set mid-reload. Neither is a real answer.
        console.warn(`[places/osm] ${endpoint.url} returned 0 venues — trying the next mirror`);
        continue;
      }

      console.log(`[places/osm] ${places.length} venues from ${endpoint.url} in ${Date.now() - startedAt}ms`);
      return places;
    } catch (error) {
      const reason = error.name === 'AbortError' ? `timed out after ${Date.now() - startedAt}ms` : error.message;
      console.warn(`[places/osm] ${endpoint.url} failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return [];
}
