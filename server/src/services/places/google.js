import { env } from '../../config/env.js';
import { haversineKm } from '../../utils/geo.js';

/**
 * Optional Google Places (New) provider.
 *
 * Enabled only when GOOGLE_MAPS_API_KEY is set. The key is read from the server
 * environment and never reaches the browser — the client always talks to our
 * own /api routes.
 *
 * Google supplies what OpenStreetMap cannot: real star ratings, real price
 * levels and venue photos. When this provider answers, `ratingSource` becomes
 * `google` and `priceSource` becomes `google`, so the UI stops labelling those
 * values as estimates.
 */

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';

const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.rating', 'places.userRatingCount', 'places.priceLevel', 'places.types',
  'places.currentOpeningHours.openNow', 'places.regularOpeningHours.periods',
  'places.nationalPhoneNumber', 'places.websiteUri', 'places.photos',
  'places.primaryTypeDisplayName',
].join(',');

const PRICE_MAP = {
  PRICE_LEVEL_FREE: 'low',
  PRICE_LEVEL_INEXPENSIVE: 'low',
  PRICE_LEVEL_MODERATE: 'medium',
  PRICE_LEVEL_EXPENSIVE: 'high',
  PRICE_LEVEL_VERY_EXPENSIVE: 'high',
};

const TYPE_CUISINE = {
  indian_restaurant: 'north_indian', south_indian_restaurant: 'south_indian',
  chinese_restaurant: 'chinese', italian_restaurant: 'italian', pizza_restaurant: 'italian',
  cafe: 'beverages', coffee_shop: 'beverages', bakery: 'bakery',
  ice_cream_shop: 'desserts', dessert_shop: 'desserts', juice_shop: 'beverages',
  middle_eastern_restaurant: 'arabian', fast_food_restaurant: 'street_food',
  seafood_restaurant: 'kerala', vegetarian_restaurant: 'healthy', vegan_restaurant: 'healthy',
  sandwich_shop: 'continental', american_restaurant: 'continental',
};

export const isGoogleEnabled = () => Boolean(env.GOOGLE_MAPS_API_KEY);

/** Google photo references are proxied through our API so the key stays server-side. */
export const googlePhotoPath = (photoName, maxWidth = 640) =>
  `/api/places/photo?ref=${encodeURIComponent(photoName)}&w=${maxWidth}`;

function toRestaurant(place, origin) {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (lat == null || lng == null) return null;

  const cuisines = [...new Set((place.types ?? []).map((t) => TYPE_CUISINE[t]).filter(Boolean))];

  return {
    externalId: `google:${place.id}`,
    provider: 'google',
    name: place.displayName?.text ?? 'Unnamed venue',
    slug: `google-${place.id}`.toLowerCase(),
    tagline: place.primaryTypeDisplayName?.text ?? null,
    emoji: '🍽️',
    coverGradient: 'from-orange-400 to-rose-500',
    cuisines: cuisines.length ? cuisines.slice(0, 4) : ['south_indian'],

    priceCategory: PRICE_MAP[place.priceLevel] ?? null,
    priceSource: place.priceLevel ? 'google' : 'unavailable',
    avgCostForOne: null,

    rating: typeof place.rating === 'number' ? place.rating : null,
    ratingCount: place.userRatingCount ?? 0,
    ratingSource: typeof place.rating === 'number' ? 'google' : 'unavailable',

    address: { line1: place.formattedAddress ?? null, area: null, city: null, pincode: null },
    location: { type: 'Point', coordinates: [lng, lat] },
    phone: place.nationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,

    imageUrl: place.photos?.[0]?.name ? googlePhotoPath(place.photos[0].name) : null,
    imageAttribution: 'Photo via Google Places',

    isPureVeg: (place.types ?? []).includes('vegetarian_restaurant'),
    deliveryAvailable: false,
    dineInAvailable: true,

    openingHours: mapPeriods(place.regularOpeningHours?.periods),
    hoursKnown: Boolean(place.regularOpeningHours?.periods?.length),
    openNowReported: place.currentOpeningHours?.openNow ?? null,

    seatingCapacity: 45,
    avgServiceMinutes: 14,
    avgPrepMinutes: 18,
    deliveryBaseMinutes: 22,
    popularityIndex: Math.min(1, (place.userRatingCount ?? 0) / 2000),

    tags: (place.types ?? []).slice(0, 4),
    dataSource: 'google',
    attribution: 'Place data © Google',
    distanceKm: origin ? haversineKm(origin, { lat, lng }) : null,
  };
}

function mapPeriods(periods) {
  if (!periods?.length) return [];
  const pad = (n) => String(n).padStart(2, '0');
  return periods
    .filter((p) => p.open && p.close)
    .map((p) => ({
      dayOfWeek: p.open.day,
      open: `${pad(p.open.hour)}:${pad(p.open.minute ?? 0)}`,
      close: `${pad(p.close.hour)}:${pad(p.close.minute ?? 0)}`,
      closed: false,
    }));
}

export async function searchNearbyGoogle({ lat, lng, radiusKm = 3, limit = 20, priceCategory }) {
  if (!isGoogleEnabled()) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.PLACES_TIMEOUT_MS);

  const body = {
    includedTypes: ['restaurant', 'cafe', 'bakery', 'meal_takeaway'],
    maxResultCount: Math.min(20, limit),
    locationRestriction: {
      circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(50000, radiusKm * 1000) },
    },
    rankPreference: 'DISTANCE',
  };

  // Google supports server-side price filtering — use it when the user picked one.
  const priceLevels = {
    low: ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_FREE'],
    medium: ['PRICE_LEVEL_MODERATE'],
    high: ['PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE'],
  }[priceCategory];
  if (priceLevels) body.priceLevels = priceLevels;

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const data = await response.json();

    return (data.places ?? [])
      .map((place) => toRestaurant(place, { lat, lng }))
      .filter(Boolean)
      .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  } catch (error) {
    console.warn(`[places/google] failed, falling back: ${error.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Streams a Google place photo through our server so the key is never public. */
export async function fetchGooglePhoto(photoName, maxWidth = 640) {
  if (!isGoogleEnabled()) return null;
  const url =
    `https://places.googleapis.com/v1/${photoName}/media` +
    `?maxWidthPx=${Math.min(1600, Number(maxWidth) || 640)}&skipHttpRedirect=true`;

  const response = await fetch(url, { headers: { 'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY } });
  if (!response.ok) return null;
  const data = await response.json();
  return data.photoUri ?? null;
}
