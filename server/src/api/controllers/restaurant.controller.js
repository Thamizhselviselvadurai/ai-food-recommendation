import { z } from 'zod';
import { FoodItem, Restaurant, Review } from '../../models/index.js';
import { buildContext } from '../../services/recommendation/context.js';
import { discoverNearby, recommendFoods } from '../../services/recommendation/engine.js';
import { estimateForRestaurant, hourlyOutlook } from '../../services/crowd/crowdEngine.js';
import { ingestNearbyPlaces, providerStatus } from '../../services/places/index.js';
import { fetchGooglePhoto } from '../../services/places/google.js';
import { haversineKm, kmToRadians, travelMinutes } from '../../utils/geo.js';
import { closingSoon, isOpenAt } from '../../utils/time.js';

/** Below this many known venues in range we top up from the live provider. */
const MIN_LOCAL_COVERAGE = 5;
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { serializeFood, serializeNearbyPlace, serializeRecommendation, serializeRestaurant } from '../serializers.js';

export const nearbySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(30).optional(),
  cuisines: z.string().optional(),
  priceCategory: z.enum(['low', 'medium', 'high']).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  pureVeg: z.coerce.boolean().optional(),
  lowCrowdOnly: z.coerce.boolean().optional(),
  openNow: z.coerce.boolean().optional(),
  search: z.string().max(100).optional(),
  sort: z.enum(['best', 'distance', 'rating', 'crowd', 'wait', 'price']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  /** Forces a fresh provider lookup instead of using the cached area result. */
  refresh: z.coerce.boolean().optional(),
});

/** 📍 Find Food Near Me */
export const nearby = asyncHandler(async (req, res) => {
  const q = req.query;
  const radiusKm = q.radiusKm ?? 5;

  const ctx = await buildContext(
    {
      location: q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng, source: 'device' } : null,
      maxDistanceKm: radiusKm,
      openNow: q.openNow !== false,
    },
    { userId: req.userId }
  );

  /**
   * Real venues come first. When the user actually shares their location we
   * always make sure that neighbourhood has been pulled from the live places
   * provider — the bundled demo dataset covers exactly one city, so relying on
   * it anywhere else showed either nothing or, worse, restaurants from another
   * city. The lookup is cached per ~1km area for hours, so this is one provider
   * call per neighbourhood, not one per request.
   */
  const usingRealLocation = ctx.location?.source !== 'default_city';
  let discovery = { provider: null, fetched: 0 };

  if (ctx.location) {
    const liveCount = await Restaurant.countDocuments({
      isActive: true,
      dataSource: { $in: ['osm', 'google'] },
      location: {
        $geoWithin: { $centerSphere: [[ctx.location.lng, ctx.location.lat], kmToRadians(radiusKm)] },
      },
    });

    if (usingRealLocation || liveCount < MIN_LOCAL_COVERAGE || q.refresh) {
      discovery = await ingestNearbyPlaces({
        lat: ctx.location.lat,
        lng: ctx.location.lng,
        radiusKm: Math.max(radiusKm, 2),
        priceCategory: q.priceCategory,
        force: Boolean(q.refresh),
        // This screen lists venues; it does not rank dishes. Answer as soon as
        // the venues are stored and let the menus build behind the response.
        awaitMenus: false,
      });
    }
  }

  const filters = {
    cuisines: q.cuisines ? q.cuisines.split(',').filter(Boolean) : undefined,
    priceCategory: q.priceCategory,
    minRating: q.minRating,
    pureVeg: q.pureVeg,
    lowCrowdOnly: q.lowCrowdOnly,
    search: q.search,
  };

  const found = await discoverNearby(ctx, {
    limit: q.limit ?? 20,
    includeClosed: q.openNow === false,
    sort: q.sort ?? 'best',
    filters,
  });

  /**
   * Never mix demo data into a real result set. If genuine venues were found
   * around the user, the seeded demo restaurants are dropped entirely — showing
   * a made-up restaurant next to a real one is the one thing that would make
   * every other number on the screen untrustworthy.
   */
  const realPlaces = found.filter((p) => p.restaurant.dataSource !== 'seed');
  const places = realPlaces.length ? realPlaces : found;
  const demoOnly = places.length > 0 && places.every((p) => p.restaurant.dataSource === 'seed');

  const status = providerStatus();
  const sources = [...new Set(places.map((p) => p.restaurant.dataSource))];

  res.json({
    places: places.map(serializeNearbyPlace),
    context: {
      location: { lat: ctx.location.lat, lng: ctx.location.lng, source: ctx.location.source },
      usingApproxLocation: ctx.location.source === 'default_city',
      radiusKm: ctx.maxDistanceKm,
      weather: ctx.weather,
    },
    dataSources: {
      used: sources,
      liveProvider: discovery.provider,
      liveFetched: discovery.fetched,
      // True when nothing real could be reached and the screen is showing the
      // bundled sample city. The UI says so out loud rather than implying these
      // are places near the user.
      demoData: demoOnly,
      attribution: sources.includes('osm')
        ? '© OpenStreetMap contributors (ODbL)'
        : sources.includes('google') ? 'Place data © Google' : null,
      // Told plainly so the UI can explain a missing rating instead of hiding it.
      ratingsAvailable: status.google.enabled,
      priceLevelsAvailable: status.google.enabled,
      note: status.note,
    },
    count: places.length,
  });
});

/** Which places provider is answering, and what it can and cannot supply. */
export const placesStatus = (req, res) => res.json(providerStatus());

/**
 * Proxies a Google place photo so GOOGLE_MAPS_API_KEY never reaches the browser.
 * Redirects to the signed CDN URL Google returns.
 */
export const placePhoto = asyncHandler(async (req, res) => {
  const { ref, w } = req.query;
  if (!ref) throw ApiError.badRequest('Missing photo reference');

  const url = await fetchGooglePhoto(String(ref), Number(w) || 640);
  if (!url) throw ApiError.notFound('Photo unavailable');
  res.redirect(302, url);
});

export const list = asyncHandler(async (req, res) => {
  const { search, cuisine, priceCategory, limit = 30 } = req.query;
  const query = { isActive: true };
  if (cuisine) query.cuisines = cuisine;
  if (priceCategory) query.priceCategory = priceCategory;
  if (search) query.name = { $regex: String(search).slice(0, 60), $options: 'i' };

  const restaurants = await Restaurant.find(query).limit(Math.min(Number(limit), 60)).lean();
  res.json({ restaurants: restaurants.map((r) => serializeRestaurant(r)) });
});

export const detail = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findById(req.params.id).lean();
  if (!restaurant || !restaurant.isActive) throw ApiError.notFound('Restaurant not found');

  const ctx = await buildContext(
    { location: req.query.lat && req.query.lng ? { lat: Number(req.query.lat), lng: Number(req.query.lng) } : null },
    { userId: req.userId }
  );

  const [menu, crowd, reviews, outlook] = await Promise.all([
    FoodItem.find({ restaurant: restaurant._id, isAvailable: true }).lean(),
    estimateForRestaurant(restaurant, { weather: ctx.weather }),
    Review.find({ restaurant: restaurant._id }).sort({ createdAt: -1 }).limit(12).lean(),
    hourlyOutlook(restaurant, new Date().getDay()),
  ]);

  const [lng, lat] = restaurant.location?.coordinates ?? [];
  const distanceKm = ctx.location && lat != null ? haversineKm(ctx.location, { lat, lng }) : null;

  // Personalised picks from this menu only.
  const picks = await recommendFoods(ctx, { limit: 3, diversify: false, restaurantId: restaurant._id });

  res.json({
    restaurant: serializeRestaurant(restaurant, {
      distanceKm: distanceKm != null ? Number(distanceKm.toFixed(2)) : null,
      isOpen: hasHours(restaurant) ? isOpenAt(restaurant.openingHours) : null,
      closingSoon: hasHours(restaurant) ? closingSoon(restaurant.openingHours) : false,
      travelMinutes: travelMinutes(distanceKm),
    }),
    crowd,
    crowdOutlook: outlook,
    menu: menu.map((f) => serializeFood(f)),
    menuByCategory: groupByCategory(menu),
    reviews: reviews.map((review) => ({
      id: String(review._id),
      authorName: review.authorName ?? 'Guest',
      rating: review.rating,
      title: review.title,
      body: review.body,
      createdAt: review.createdAt,
    })),
    aiPicks: picks.items.map(serializeRecommendation),
  });
});

export const crowdOutlook = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findById(req.params.id).lean();
  if (!restaurant) throw ApiError.notFound('Restaurant not found');

  const day = req.query.day != null ? Number(req.query.day) : new Date().getDay();
  if (!Number.isInteger(day) || day < 0 || day > 6) throw ApiError.badRequest('day must be 0-6');

  const [outlook, current] = await Promise.all([
    hourlyOutlook(restaurant, day),
    estimateForRestaurant(restaurant, {}),
  ]);

  res.json({
    restaurantId: String(restaurant._id),
    dayOfWeek: day,
    outlook,
    current,
    methodology:
      'Estimated from this app’s own check-ins, visitor crowd reports and historical patterns. ' +
      'Not live occupancy data from any external map provider.',
  });
});

const hasHours = (restaurant) =>
  restaurant.hoursKnown !== false && Boolean(restaurant.openingHours?.length);

function groupByCategory(menu) {
  const groups = new Map();
  for (const item of menu) {
    const key = item.category ?? 'main';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(serializeFood(item));
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }));
}
