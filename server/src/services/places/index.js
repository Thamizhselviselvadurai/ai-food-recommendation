import { Restaurant } from '../../models/index.js';
import { env } from '../../config/env.js';
import { kmToRadians } from '../../utils/geo.js';
import { buildBaselineCurve } from '../crowd/baseline.js';
import { isGoogleEnabled, searchNearbyGoogle } from './google.js';
import { searchNearbyOsm } from './overpass.js';
import { searchNearbyNominatim } from './nominatim.js';
import { ensureIndicativeMenus } from './liveMenu.js';

/**
 * ---------------------------------------------------------------------------
 * Places layer — where "restaurants near me" actually comes from.
 * ---------------------------------------------------------------------------
 * Provider order (PLACES_PROVIDER=auto, the default):
 *   1. Google Places      — only if GOOGLE_MAPS_API_KEY is set. Real ratings,
 *                           real price levels, real photos.
 *   2. OSM via Overpass   — keyless, worldwide, real venues, richest tags.
 *   3. OSM via Nominatim  — keyless fallback for when the Overpass mirrors are
 *                           overloaded, which in practice is often. Same data.
 *   4. Bundled demo       — the seeded dataset, used only where it is near.
 *
 * The whole lookup runs against one shared deadline (`PLACES_TIMEOUT_MS`), so a
 * struggling provider can never hold the response open — previously a walk over
 * two dead Overpass mirrors blocked "near me" for ~36s and then returned zero.
 *
 * Live results are cached into MongoDB so the crowd engine, check-ins, reports
 * and favourites can attach to a stable restaurant id. Cache entries carry
 * `dataSource: 'osm' | 'google'` so they are never confused with demo data.
 * ---------------------------------------------------------------------------
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // re-query a neighbourhood twice a day
const MISS_RETRY_MS = 3 * 60 * 1000; // but retry a failed lookup soon
const searchLog = new Map();

/**
 * Every live lookup covers this radius regardless of the radius the caller asked
 * for. Keeping it fixed means "near me" at 3km and a recommendation at 6km share
 * one cached fetch instead of each triggering their own provider round-trip.
 */
const FETCH_RADIUS_KM = 6;

/** Coarse cache key — one lookup covers everyone in roughly the same area. */
const areaKey = (lat, lng) => `${lat.toFixed(2)}:${lng.toFixed(2)}`;

/**
 * Resolves with the first promise to produce a non-empty array, without waiting
 * for the slower ones. Falls back to [] once every promise has settled empty or
 * rejected. Rejections are swallowed: a provider being down is not an error the
 * caller can do anything about.
 */
function firstWithResults(promises) {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (!pending) return resolve([]);

    for (const promise of promises) {
      Promise.resolve(promise)
        .then((result) => {
          if (Array.isArray(result) && result.length) return resolve(result);
          if (--pending === 0) resolve([]);
        })
        .catch(() => {
          if (--pending === 0) resolve([]);
        });
    }
  });
}

export function providerStatus() {
  return {
    configured: env.PLACES_PROVIDER,
    google: { enabled: isGoogleEnabled(), provides: ['rating', 'priceLevel', 'photos', 'openNow'] },
    openstreetmap: { enabled: true, keyless: true, provides: ['name', 'cuisine', 'address', 'openingHours', 'phone'] },
    note: isGoogleEnabled()
      ? 'Google Places is active — ratings and price levels are real values from Google.'
      : 'Using OpenStreetMap. It has no ratings or price levels, so those are shown as unavailable or clearly marked as estimated from the venue type. Set GOOGLE_MAPS_API_KEY for real ratings, prices and photos.',
  };
}

/**
 * Gives every live venue in an area an indicative menu if it lacks one, so the
 * dish-ranking flows have something to work with wherever the user actually is.
 */
/**
 * How many venues get a menu before the caller is allowed to continue. A dense
 * city centre can return 150+ venues, and building every menu inline made the
 * first request to a new neighbourhood take ~10s. This many is plenty to rank a
 * good answer from; the rest are filled in behind the response.
 */
const MENU_BATCH = 40;

export async function ensureMenusNear({ lat, lng, radiusKm = 5, blocking = MENU_BATCH } = {}) {
  const venues = await Restaurant.find(
    {
      isActive: true,
      dataSource: { $in: ['osm', 'google'] },
      menuBuiltAt: { $exists: false },
      location: { $geoWithin: { $centerSphere: [[lng, lat], kmToRadians(radiusKm)] } },
    },
    { externalId: 1, slug: 1, cuisines: 1, priceCategory: 1, isPureVeg: 1, dataSource: 1, menuBuiltAt: 1 }
  )
    .limit(200)
    .lean();

  if (!venues.length) return { venues: 0, dishes: 0 };

  const first = venues.slice(0, blocking);
  const rest = venues.slice(blocking);

  const result = await ensureIndicativeMenus(first);

  // Everything past the first batch is built without holding the response open.
  if (rest.length) {
    ensureIndicativeMenus(rest).catch((error) =>
      console.warn(`[places/menu] background batch failed: ${error.message}`)
    );
  }

  return result;
}

/** Builds menus inline or in the background, depending on what the caller needs. */
function runMenus({ lat, lng, radiusKm, awaitMenus }) {
  if (awaitMenus) return ensureMenusNear({ lat, lng, radiusKm });

  ensureMenusNear({ lat, lng, radiusKm }).catch((error) =>
    console.warn(`[places/menu] background build failed: ${error.message}`)
  );
  return Promise.resolve({ venues: 0, dishes: 0 });
}

/**
 * Fetches live venues and upserts them so they behave like any other restaurant
 * in the system. Returns the persisted documents.
 */
export async function ingestNearbyPlaces({
  lat,
  lng,
  radiusKm,
  limit = 60,
  priceCategory,
  force = false,
  /**
   * Whether to hold the response until indicative menus exist. The dish flows
   * need them to have anything to rank; "near me" lists venues and does not, so
   * it hands the work off and answers as soon as the venues are stored.
   */
  awaitMenus = true,
} = {}) {
  // One fixed fetch radius per area, so callers asking for different radii reuse
  // the same cached provider result instead of each paying for a fresh lookup.
  const fetchRadiusKm = Math.max(FETCH_RADIUS_KM, radiusKm ?? 0);
  const key = areaKey(lat, lng);
  const last = searchLog.get(key);

  if (!force && last && Date.now() - last < CACHE_TTL_MS) {
    // Still make sure the venues cached for this area have menus. Venues stored
    // before indicative menus existed would otherwise stay permanently
    // unrecommendable, because the area is "already fetched" forever.
    const menus = await runMenus({ lat, lng, radiusKm: fetchRadiusKm, awaitMenus });
    return { fetched: 0, upserted: 0, cached: true, provider: null, menusBuilt: menus.dishes };
  }

  const deadline = Date.now() + Math.max(2000, env.PLACES_TIMEOUT_MS);

  let places = [];
  let provider = null;

  if (env.PLACES_PROVIDER !== 'osm' && isGoogleEnabled()) {
    places = await searchNearbyGoogle({ lat, lng, radiusKm: fetchRadiusKm, limit, priceCategory });
    if (places.length) provider = 'google';
  }
  if (!places.length && env.PLACES_PROVIDER !== 'google') {
    /**
     * Overpass and Nominatim are raced rather than tried in turn. Both read the
     * same OSM data, and which one is healthy at any moment is unpredictable —
     * running them in sequence meant a stalled Overpass mirror burned the whole
     * budget before the working provider was ever asked. Whichever returns
     * venues first wins; the loser is ignored. One race per neighbourhood per
     * six hours, so the extra request costs effectively nothing.
     */
    places = await firstWithResults([
      searchNearbyOsm({ lat, lng, radiusKm: fetchRadiusKm, limit, deadline }),
      searchNearbyNominatim({ lat, lng, radiusKm: fetchRadiusKm, limit, deadline }),
    ]);
    if (places.length) provider = 'osm';
  }

  if (!places.length) {
    // Remember the miss briefly so we do not hammer a provider that has nothing.
    // Short, because a miss is usually a provider outage rather than an empty area.
    searchLog.set(key, Date.now() - CACHE_TTL_MS + MISS_RETRY_MS);
    return { fetched: 0, upserted: 0, cached: false, provider: null };
  }

  const operations = places.map((place) => {
    const { distanceKm, hoursKnown, rawOpeningHours, openNowReported, imageAttribution, ...doc } = place;

    return {
      updateOne: {
        filter: { externalId: place.externalId },
        update: {
          $set: {
            ...doc,
            // A venue with unknown hours must not be silently treated as open
            // 24/7 — `hoursKnown: false` makes the UI say "hours not listed".
            hoursKnown: Boolean(hoursKnown),
            baselineCrowdCurve: buildBaselineCurve(
              defaultCrowdProfile(place),
              hoursKnown ? place.openingHours : []
            ),
            isActive: true,
            lastSyncedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    };
  });

  const result = await Restaurant.bulkWrite(operations, { ordered: false });
  searchLog.set(key, Date.now());

  // Attach indicative menus so the dish-level flows ("what should I eat?", the
  // assistant) have something to rank at the user's real location. Without this
  // the venues are real but every recommendation screen comes back empty.
  const menus = await runMenus({ lat, lng, radiusKm: fetchRadiusKm, awaitMenus });

  return {
    fetched: places.length,
    upserted: (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0),
    cached: false,
    provider,
    menusBuilt: menus.dishes,
    attribution: places[0]?.attribution,
  };
}

/**
 * A generic busy-ness shape by venue type. This is explicitly a *starting
 * point*: as soon as real check-ins and crowd reports arrive for a venue, the
 * crowd engine weights those far above this curve, and reports its confidence.
 */
function defaultCrowdProfile(place) {
  const isCafe = place.cuisines?.includes('beverages') || place.tags?.includes('cafe');
  const isFastFood = place.tags?.includes('fast_food');

  if (isCafe) {
    return { base: 0.12, peaks: [[10.5, 1.6, 0.5], [17, 2, 0.7]], weekendBoost: 0.2 };
  }
  if (isFastFood) {
    return { base: 0.1, peaks: [[13, 1.5, 0.7], [20, 2, 0.8]], weekendBoost: 0.25 };
  }
  return { base: 0.1, peaks: [[8.5, 1.4, 0.55], [13, 1.6, 0.85], [20, 1.9, 0.8]], weekendBoost: 0.2 };
}
