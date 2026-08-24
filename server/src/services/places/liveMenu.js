import { DISH_CATALOG } from '../../data/dishCatalog.js';
import { FoodItem, Restaurant } from '../../models/index.js';

/**
 * ---------------------------------------------------------------------------
 * Indicative menus for live (OpenStreetMap / Google) venues.
 * ---------------------------------------------------------------------------
 * Why this exists: the recommendation engine ranks *dishes*, and dishes live in
 * the FoodItem collection. A venue discovered live has no FoodItems, so at a
 * real user's location "what should I eat?" returned nothing at all — the
 * restaurants were real but there was nothing to recommend from them.
 *
 * No keyless provider publishes real menus. Rather than inventing a menu and
 * presenting it as fact, we attach the *typical dishes for the cuisine the
 * venue is genuinely tagged with in OSM*, priced against its inferred price
 * band, and mark every one `dataSource: 'indicative'`. The API and UI carry
 * that label through, so these read as "south Indian places like this usually
 * serve these" — never as a scraped menu.
 *
 * Everything is deterministic per venue: the same restaurant always gets the
 * same dish list and the same prices, so nothing shifts between page loads.
 * ---------------------------------------------------------------------------
 */

const DISHES_PER_VENUE = 12;

/** Same price ladder the seeded demo restaurants use, applied to the band. */
const PRICE_MULTIPLIER = { low: 0.8, medium: 1, high: 1.45 };

/** Dishes that fit almost any Indian eatery, used when tags are uninformative. */
const FALLBACK_CUISINES = ['south_indian', 'north_indian'];

/** Stable pseudo-random in [0,1) derived from a string — no Math.random(). */
function hashUnit(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

const roundTo = (value, step) => Math.round(value / step) * step;

/**
 * Picks the dish list for one venue: cuisine-matched, veg-only where the venue
 * is tagged pure veg, and always spanning more than one meal slot so breakfast
 * and dinner both have something to rank.
 */
function chooseDishes(restaurant) {
  const cuisines = restaurant.cuisines?.length ? restaurant.cuisines : FALLBACK_CUISINES;

  let pool = DISH_CATALOG.filter((dish) => cuisines.includes(dish.cuisine));
  if (pool.length < 6) {
    pool = DISH_CATALOG.filter((dish) => [...cuisines, ...FALLBACK_CUISINES].includes(dish.cuisine));
  }
  if (restaurant.isPureVeg) {
    pool = pool.filter((dish) => ['veg', 'vegan', 'egg'].includes(dish.dietType));
  }
  if (!pool.length) return [];

  // Deterministic shuffle: order by a hash of (venue, dish) so each venue gets a
  // different-looking menu while staying identical across requests.
  const seed = String(restaurant.externalId ?? restaurant.slug ?? restaurant._id);
  return [...pool]
    .sort((a, b) => hashUnit(`${seed}:${a.key}`) - hashUnit(`${seed}:${b.key}`))
    .slice(0, DISHES_PER_VENUE);
}

/**
 * Real dish photographs are already resolved once per dish (Wikimedia Commons)
 * and stored on the seeded menu items. A live venue serving the same dish shows
 * the same photograph rather than re-querying Wikimedia per venue — it is a
 * photo *of the dish*, which is exactly what it claims to be.
 */
let imageIndexCache = null;

async function dishImageIndex() {
  if (imageIndexCache) return imageIndexCache;

  // Only the seeded menu carries resolved photographs, and it is ~170 documents
  // rather than every dish in the database — which by now includes thousands of
  // indicative rows. Scanning those was what made the first request to a new
  // neighbourhood slow.
  const withPhotos = await FoodItem.find(
    { dataSource: 'seed', imageUrl: { $nin: [null, ''] } },
    { slug: 1, imageUrl: 1, imageAttribution: 1 }
  ).lean();

  const index = new Map();
  const keys = DISH_CATALOG.map((dish) => dish.key);

  for (const item of withPhotos) {
    for (const key of keys) {
      if (index.has(key)) continue;
      if (item.slug?.endsWith(`-${key}`)) {
        index.set(key, { imageUrl: item.imageUrl, imageAttribution: item.imageAttribution });
        break;
      }
    }
  }

  // Only worth caching once the photos actually exist — before the boot-time
  // backfill finishes this would otherwise pin an empty map for the process.
  if (index.size) imageIndexCache = index;
  return index;
}

function toFoodDoc(dish, restaurant, seed, image) {
  const multiplier = PRICE_MULTIPLIER[restaurant.priceCategory] ?? 1;
  // ±6% of jitter, deterministic, so prices are not all identical across venues.
  const jitter = 0.94 + hashUnit(`${seed}:${dish.key}:price`) * 0.12;

  return {
    updateOne: {
      filter: { slug: `${restaurant.slug}-${dish.key}`, restaurant: restaurant._id },
      update: {
        $set: {
          name: dish.name,
          description: dish.desc,
          emoji: dish.emoji,
          imageUrl: image?.imageUrl,
          imageAttribution: image?.imageAttribution,
          restaurant: restaurant._id,
          cuisine: dish.cuisine,
          category: dish.category,
          dietType: dish.dietType,
          spiceLevel: dish.spice,
          price: Math.max(15, roundTo(dish.price * multiplier * jitter, 5)),
          nutrition: {
            calories: dish.cal,
            protein: dish.pro,
            carbs: dish.carb,
            fat: dish.fat,
            servingDescription: 'Typical single serving',
          },
          nutritionSource: 'estimated',
          prepTimeMinutes: dish.prep,
          tags: dish.tags ?? [],
          moodTags: dish.moods ?? [],
          mealSlots: dish.slots ?? [],
          allergens: dish.allergens ?? [],
          // OSM publishes no dish ratings; leave the neutral default rather than
          // inventing a score, and keep the count honest at zero.
          ratingCount: 0,
          isAvailable: true,
          dataSource: 'indicative',
        },
        $setOnInsert: { slug: `${restaurant.slug}-${dish.key}`, createdAt: new Date() },
      },
      upsert: true,
    },
  };
}

/**
 * Ensures every supplied live restaurant has an indicative menu. Skips venues
 * that already have one, so this is cheap to call on every discovery.
 * Never throws — a failure here must not take down "near me".
 */
export async function ensureIndicativeMenus(restaurants) {
  const live = (restaurants ?? []).filter((r) => r && ['osm', 'google'].includes(r.dataSource));
  if (!live.length) return { venues: 0, dishes: 0 };

  try {
    // `menuBuiltAt` is the cheap gate: a venue is examined once, ever. Relying on
    // "has no FoodItems" instead meant any venue whose cuisine matched no dish
    // stayed pending forever and re-ran the whole build on every request.
    const pending = live.filter((r) => !r.menuBuiltAt);
    if (!pending.length) return { venues: 0, dishes: 0 };

    const chosen = pending.map((restaurant) => ({ restaurant, dishes: chooseDishes(restaurant) }));
    const images = await dishImageIndex();

    const operations = [];
    for (const { restaurant, dishes } of chosen) {
      const seed = String(restaurant.externalId ?? restaurant.slug ?? restaurant._id);
      for (const dish of dishes) {
        operations.push(toFoodDoc(dish, restaurant, seed, images.get(dish.key)));
      }
    }
    const markBuilt = Restaurant.updateMany(
      { _id: { $in: pending.map((r) => r._id) } },
      { $set: { menuBuiltAt: new Date() } }
    );

    if (!operations.length) {
      await markBuilt;
      return { venues: pending.length, dishes: 0 };
    }

    await Promise.all([FoodItem.bulkWrite(operations, { ordered: false }), markBuilt]);
    return { venues: pending.length, dishes: operations.length };
  } catch (error) {
    console.warn(`[places/menu] indicative menu build failed: ${error.message}`);
    return { venues: 0, dishes: 0, error: error.message };
  }
}
