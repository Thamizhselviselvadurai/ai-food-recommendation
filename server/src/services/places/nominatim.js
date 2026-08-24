import { env } from '../../config/env.js';
import { buildOsmVenue } from './overpass.js';

/**
 * ---------------------------------------------------------------------------
 * REAL restaurant data from OpenStreetMap via Nominatim — the resilience net.
 * ---------------------------------------------------------------------------
 * Overpass is the richer query interface, but its public mirrors are frequently
 * overloaded (502/504) and a walk across them can take tens of seconds. That is
 * exactly what made "near me" hang and then show nothing.
 *
 * Nominatim is the other keyless public endpoint over the same ODbL OSM data.
 * It answers a bounded-box search in ~1-2s, and with `extratags=1` it returns
 * the cuisine / opening_hours / phone / website tags we need. Same data, same
 * `externalId` scheme, so a venue found here is the same record as one found
 * via Overpass.
 *
 * Still no ratings, price levels or photos in OSM — those stay null and are
 * labelled as unavailable rather than invented.
 * ---------------------------------------------------------------------------
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/** Nominatim asks for a real identifying UA and caps callers at ~1 req/sec. */
const USER_AGENT = 'FoodAI/1.0 (open-source food discovery demo)';

/** Searched one term at a time; results are merged and de-duplicated by OSM id. */
const TERMS = ['restaurant', 'cafe', 'fast food'];

/** Roughly converts a radius in km to a lat/lng delta for the viewbox. */
const degreesFor = (radiusKm, lat) => ({
  dLat: radiusKm / 111,
  dLng: radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))),
});

/**
 * Nominatim exposes the OSM tags under `extratags` and a structured `address`.
 * Re-assemble the flat `addr:*` tag shape that `buildOsmVenue` expects.
 */
function tagsFor(result) {
  const extra = result.extratags ?? {};
  const address = result.address ?? {};

  return {
    ...extra,
    name: result.name || result.display_name?.split(',')[0]?.trim(),
    // `type` is the amenity value for category=amenity results.
    amenity: result.category === 'amenity' ? result.type : extra.amenity ?? 'restaurant',
    'addr:housenumber': address.house_number ?? extra['addr:housenumber'],
    'addr:street': address.road ?? extra['addr:street'],
    'addr:suburb': address.suburb ?? address.neighbourhood ?? address.quarter,
    'addr:neighbourhood': address.neighbourhood,
    'addr:city': address.city ?? address.town ?? address.village ?? address.municipality,
    'addr:postcode': address.postcode,
  };
}

async function searchTerm(term, { lat, lng, radiusKm, limit, timeoutMs }) {
  const { dLat, dLng } = degreesFor(radiusKm, lat);
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: String(limit),
    extratags: '1',
    addressdetails: '1',
    bounded: '1',
    // viewbox is <west>,<north>,<east>,<south>
    viewbox: `${lng - dLng},${lat + dLat},${lng + dLng},${lat - dLat}`,
    q: term,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ENDPOINT}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches real nearby venues. Returns []rather than throwing so a Nominatim
 * outage degrades the screen instead of breaking it.
 */
export async function searchNearbyNominatim({ lat, lng, radiusKm = 3, limit = 60, deadline } = {}) {
  const stopAt = deadline ?? Date.now() + Math.max(2000, env.PLACES_TIMEOUT_MS);
  const perTerm = Math.min(40, Math.max(10, Math.ceil(limit / TERMS.length) + 10));

  const byId = new Map();

  for (const term of TERMS) {
    const remaining = stopAt - Date.now();
    if (remaining <= 500) break;

    const startedAt = Date.now();
    try {
      const results = await searchTerm(term, {
        lat,
        lng,
        radiusKm,
        limit: perTerm,
        timeoutMs: Math.min(8000, remaining),
      });

      for (const result of results) {
        const venue = buildOsmVenue(
          {
            osmType: result.osm_type,
            osmId: result.osm_id,
            lat: Number(result.lat),
            lng: Number(result.lon),
            tags: tagsFor(result),
          },
          { lat, lng }
        );
        // Nominatim's viewbox is a rectangle; enforce the actual circle here.
        if (venue && (venue.distanceKm == null || venue.distanceKm <= radiusKm * 1.05)) {
          byId.set(venue.externalId, venue);
        }
      }
      console.log(`[places/nominatim] "${term}" → ${results.length} raw in ${Date.now() - startedAt}ms`);
    } catch (error) {
      const reason = error.name === 'AbortError' ? `timed out after ${Date.now() - startedAt}ms` : error.message;
      console.warn(`[places/nominatim] "${term}" failed: ${reason}`);
    }
  }

  return [...byId.values()]
    .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
    .slice(0, limit);
}
