import { FoodItem, Restaurant } from '../../models/index.js';
import { DIET_COMPATIBILITY } from '../../domain/constants.js';
import { env } from '../../config/env.js';
import { buildContext } from '../../services/recommendation/context.js';
import { estimateForRestaurants } from '../../services/crowd/crowdEngine.js';
import { haversineKm, kmToRadians } from '../../utils/geo.js';
import { isOpenAt } from '../../utils/time.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { serializeFood, serializeRestaurant } from '../serializers.js';

/**
 * Price bands for a single dish, matching the Low / Medium / High labels the UI
 * shows. Kept here (not in the client) so the filter is applied in the database
 * query rather than after the result set has already been truncated by `limit`.
 */
const DISH_PRICE_BANDS = {
  low: { $lt: 150 },
  medium: { $gte: 150, $lte: 350 },
  high: { $gt: 350 },
};

/**
 * Food search across every menu, with the same filters as the discovery screen.
 * This is plain search — no scoring. The recommendation endpoints do ranking.
 */
export const search = asyncHandler(async (req, res) => {
  const {
    q, cuisine, dietType, maxPrice, minPrice, priceCategory, spiceLevel, category,
    lat, lng, radiusKm = 8, openNow, sort = 'relevance', limit = 40,
  } = req.query;

  const query = { isAvailable: true };

  if (q) {
    const term = String(q).slice(0, 60);
    query.$or = [
      { name: { $regex: term, $options: 'i' } },
      { description: { $regex: term, $options: 'i' } },
      { tags: { $regex: term, $options: 'i' } },
    ];
  }
  if (cuisine) query.cuisine = { $in: String(cuisine).split(',') };
  if (dietType) query.dietType = { $in: DIET_COMPATIBILITY[dietType] ?? [dietType] };
  if (category) query.category = category;
  if (spiceLevel) query.spiceLevel = spiceLevel;
  // A band and an explicit min/max can both be supplied; the tighter one wins
  // because the constraints are merged rather than overwritten.
  const band = priceCategory ? DISH_PRICE_BANDS[String(priceCategory)] : null;
  if (maxPrice || minPrice || band) {
    query.price = { ...(band ?? {}) };
    if (maxPrice) query.price.$lte = Math.min(Number(maxPrice), query.price.$lte ?? Infinity);
    if (minPrice) query.price.$gte = Math.max(Number(minPrice), query.price.$gte ?? -Infinity);
  }

  /**
   * Always search a *place*. Without this fallback, a visitor who has not shared
   * their location got an arbitrary slice of every menu in the database — dishes
   * from cities on the other side of the country, which is worse than useless.
   * Every other endpoint already falls back to the configured default city.
   */
  const location =
    lat != null && lng != null
      ? { lat: Number(lat), lng: Number(lng) }
      : { lat: env.DEFAULT_LAT, lng: env.DEFAULT_LNG };

  const restaurantFilter = await Restaurant.find({
    isActive: true,
    location: { $geoWithin: { $centerSphere: [[location.lng, location.lat], kmToRadians(Number(radiusKm))] } },
  }).lean();
  query.restaurant = { $in: restaurantFilter.map((r) => r._id) };

  const foods = await FoodItem.find(query).limit(Math.min(Number(limit), 80)).lean();

  const restaurantIds = new Set(foods.map((f) => String(f.restaurant)));
  const restaurants = restaurantFilter.filter((r) => restaurantIds.has(String(r._id)));

  const restaurantMap = new Map(restaurants.map((r) => [String(r._id), r]));
  const crowdMap = await estimateForRestaurants(restaurants, {});

  let results = foods
    .map((food) => {
      const restaurant = restaurantMap.get(String(food.restaurant));
      if (!restaurant) return null;
      const [rLng, rLat] = restaurant.location?.coordinates ?? [];
      const distanceKm = rLat != null ? haversineKm(location, { lat: rLat, lng: rLng }) : null;
      // A venue that publishes no hours is unknown, not open — and not closed.
      const hoursKnown = restaurant.hoursKnown !== false && Boolean(restaurant.openingHours?.length);
      const open = hoursKnown ? isOpenAt(restaurant.openingHours) : null;

      return {
        ...serializeFood(food),
        restaurant: serializeRestaurant(restaurant),
        distanceKm: distanceKm != null ? Number(distanceKm.toFixed(2)) : null,
        isOpen: open,
        crowd: crowdMap.get(String(restaurant._id)) ?? null,
      };
    })
    .filter(Boolean);

  // Hide confirmed-closed venues but keep unknown-hours ones, which the UI
  // labels — otherwise most real-world listings would silently disappear.
  if (openNow === 'true') results = results.filter((r) => r.isOpen !== false);

  const sorters = {
    relevance: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    distance: (a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999),
    prep_time: (a, b) => a.prepTimeMinutes - b.prepTimeMinutes,
  };
  results.sort(sorters[sort] ?? sorters.relevance);

  res.json({
    foods: results,
    count: results.length,
    // What actually exists on the menus in range, regardless of the current
    // filter. The UI uses this to offer only cuisines that can return something
    // and to explain an empty result instead of just saying "nothing matched".
    facets: await menuFacets(restaurantFilter.map((r) => r._id)),
  });
});

/**
 * Counts dishes by cuisine and diet across the menus in range. Deliberately
 * ignores the user's current filters — its whole job is to say what else is
 * available so a dead-end filter can be avoided or explained.
 */
async function menuFacets(restaurantIds) {
  const match = { isAvailable: true, restaurant: { $in: restaurantIds } };

  const [cuisines, diets, priceRange] = await Promise.all([
    FoodItem.aggregate([{ $match: match }, { $group: { _id: '$cuisine', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    FoodItem.aggregate([{ $match: match }, { $group: { _id: '$dietType', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    FoodItem.aggregate([{ $match: match }, { $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }]),
  ]);

  return {
    cuisines: cuisines.filter((c) => c._id).map((c) => ({ id: c._id, count: c.count })),
    dietTypes: diets.filter((d) => d._id).map((d) => ({ id: d._id, count: d.count })),
    priceRange: priceRange[0] ? { min: priceRange[0].min, max: priceRange[0].max } : null,
    totalDishes: cuisines.reduce((sum, c) => sum + c.count, 0),
  };
}

export const detail = asyncHandler(async (req, res) => {
  const food = await FoodItem.findById(req.params.id).populate('restaurant').lean();
  if (!food) throw ApiError.notFound('Dish not found');

  const ctx = await buildContext({}, { userId: req.userId, includeWeather: false });
  const crowdMap = await estimateForRestaurants([food.restaurant], {});

  res.json({
    food: serializeFood(food),
    restaurant: serializeRestaurant(food.restaurant),
    crowd: crowdMap.get(String(food.restaurant._id)) ?? null,
    similar: (
      await FoodItem.find({
        _id: { $ne: food._id },
        cuisine: food.cuisine,
        dietType: { $in: DIET_COMPATIBILITY[ctx.dietType ?? 'nonveg'] },
        isAvailable: true,
      })
        .limit(6)
        .populate('restaurant', 'name emoji slug rating')
        .lean()
    ).map((f) => ({ ...serializeFood(f), restaurant: serializeRestaurant(f.restaurant) })),
  });
});
