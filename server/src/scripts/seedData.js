import {
  CheckIn, CrowdReport, CrowdSnapshot, Favorite, Feedback, FoodItem, Order, Rating,
  RecommendationHistory, Restaurant, Review, User, UserPreference,
} from '../models/index.js';
import { CITY_CENTER, RESTAURANT_SEEDS } from '../data/restaurants.js';
import { DISH_BY_KEY } from '../data/dishCatalog.js';
import { buildBaselineCurve } from '../services/crowd/baseline.js';
import { recomputeSnapshots } from '../services/crowd/aggregate.js';
import { resolveFoodImages } from '../services/images/foodImages.js';
import { clamp } from '../utils/time.js';

/**
 * Seeds the bundled demo dataset:
 *   14 restaurants · ~170 menu items · 3 weeks of synthetic crowd history
 *   · live check-ins · demo accounts with orders, ratings and reviews.
 *
 * Everything written here is marked `dataSource: 'seed'`.
 */

// Deterministic PRNG so every run produces the same demo data.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260823);
const pick = (array) => array[Math.floor(rand() * array.length)];
const between = (min, max) => min + rand() * (max - min);
const roundTo = (value, step) => Math.round(value / step) * step;

const PRICE_MULTIPLIER = { low: 0.85, medium: 1, high: 1.35 };

const DEMO_ACCOUNTS = [
  {
    name: 'Demo User',
    email: 'demo@foodai.app',
    password: 'Demo@12345',
    avatarEmoji: '🙂',
    preferences: {
      dietType: 'nonveg',
      preferredSpiceLevel: 'medium',
      maxSpiceLevel: 'hot',
      defaultBudget: 300,
      preferredCuisines: ['south_indian', 'chinese'],
      allergies: [],
      maxWaitMinutes: 35,
      maxDistanceKm: 6,
      onboardingComplete: true,
    },
    addresses: [
      { label: 'Home', line1: '4B Lakshmi Apartments, Cross Cut Road', city: 'Coimbatore', pincode: '641012', isDefault: true },
    ],
  },
  {
    name: 'Priya',
    email: 'priya@foodai.app',
    password: 'Priya@12345',
    avatarEmoji: '🌿',
    preferences: {
      dietType: 'veg',
      preferredSpiceLevel: 'mild',
      maxSpiceLevel: 'medium',
      defaultBudget: 200,
      caloriePreference: 'low',
      highProtein: true,
      preferredCuisines: ['south_indian', 'healthy'],
      allergies: ['nuts'],
      maxWaitMinutes: 25,
      maxDistanceKm: 4,
      onboardingComplete: true,
    },
    addresses: [
      { label: 'Home', line1: '22 Race Course Road', city: 'Coimbatore', pincode: '641018', isDefault: true },
    ],
  },
];

const REVIEW_SNIPPETS = [
  ['Consistently good', 'Been coming here for years. Portions are generous and service is quick.'],
  ['Great value', 'Tastes home-made and the price is very reasonable for what you get.'],
  ['Busy but worth it', 'Go early or expect a wait during peak hours. The food makes up for it.'],
  ['Solid choice', 'Nothing fancy, but everything on the menu is dependable.'],
  ['Fresh and hot', 'Everything arrived hot and well seasoned. Will order again.'],
  ['Bit slow at peak', 'Food was good, but the kitchen struggles when it gets full.'],
  ['My regular spot', 'Reliable for a quick weekday meal. Staff are friendly.'],
];

/**
 * @param {object}  options
 * @param {boolean} options.quiet
 * @param {{lat:number,lng:number}} [options.center]  Place the demo dataset near
 *        a given point instead of the default city. Lets the dish-level features
 *        work wherever the user actually is.
 */
export async function seedDatabase({ quiet = false, center = null } = {}) {
  const log = (...args) => { if (!quiet) console.log(...args); };
  const origin = center ?? CITY_CENTER;

  log('[seed] clearing existing data…');
  await Promise.all([
    // Live provider records are cached, not authored — leave them alone.
    Restaurant.deleteMany({ dataSource: 'seed' }), FoodItem.deleteMany({}), CheckIn.deleteMany({}),
    CrowdReport.deleteMany({}), CrowdSnapshot.deleteMany({}), Review.deleteMany({}),
    User.deleteMany({}), UserPreference.deleteMany({}), Order.deleteMany({}),
    Favorite.deleteMany({}), Rating.deleteMany({}), Feedback.deleteMany({}),
    RecommendationHistory.deleteMany({}),
  ]);

  // ── Restaurants ───────────────────────────────────────────────────────────
  const restaurantDocs = RESTAURANT_SEEDS.map((seed) => ({
    name: seed.name,
    slug: seed.slug,
    tagline: seed.tagline,
    emoji: seed.emoji,
    coverGradient: seed.coverGradient,
    cuisines: seed.cuisines,
    priceCategory: seed.priceCategory,
    avgCostForOne: seed.avgCostForOne,
    priceSource: 'seed',
    rating: seed.rating,
    ratingCount: seed.ratingCount,
    ratingSource: 'seed',
    provider: 'seed',
    hoursKnown: true,
    address: center
      ? { ...seed.address, city: null, area: seed.address.area }
      : seed.address,
    location: {
      type: 'Point',
      coordinates: [origin.lng + seed.offset.lng, origin.lat + seed.offset.lat],
    },
    phone: `+91 ${Math.floor(between(70000, 99999))} ${Math.floor(between(10000, 99999))}`,
    isPureVeg: Boolean(seed.isPureVeg),
    deliveryAvailable: true,
    dineInAvailable: true,
    seatingCapacity: seed.seatingCapacity,
    avgServiceMinutes: seed.avgServiceMinutes,
    avgPrepMinutes: seed.avgPrepMinutes,
    deliveryBaseMinutes: seed.deliveryBaseMinutes,
    baselineCrowdCurve: buildBaselineCurve(seed.crowdProfile, seed.openingHours),
    openingHours: seed.openingHours,
    tags: seed.tags,
    popularityIndex: seed.popularityIndex,
    dataSource: 'seed',
  }));

  const restaurants = await Restaurant.insertMany(restaurantDocs);
  log(`[seed] ${restaurants.length} restaurants`);

  const bySlug = new Map(restaurants.map((r) => [r.slug, r]));

  // ── Real dish photography ─────────────────────────────────────────────────
  // Resolved once here from Wikimedia Commons so no runtime request depends on
  // an external service. Failures are non-fatal — those dishes keep the emoji tile.
  const dishKeys = [...new Set(RESTAURANT_SEEDS.flatMap((seed) => seed.menu))];
  log(`[seed] resolving real photographs for ${dishKeys.length} dishes…`);
  const imageMap = await resolveFoodImages(dishKeys).catch((error) => {
    console.warn(`[seed] image lookup failed, continuing without photos: ${error.message}`);
    return new Map();
  });
  log(`[seed] ${imageMap.size}/${dishKeys.length} dish photos resolved`);

  // ── Menus ─────────────────────────────────────────────────────────────────
  const foodDocs = [];
  for (const seed of RESTAURANT_SEEDS) {
    const restaurant = bySlug.get(seed.slug);
    const multiplier = PRICE_MULTIPLIER[seed.priceCategory] ?? 1;

    for (const key of seed.menu) {
      const dish = DISH_BY_KEY[key];
      if (!dish) {
        console.warn(`[seed] unknown dish key "${key}" on ${seed.slug} — skipped`);
        continue;
      }

      const price = Math.max(15, roundTo(dish.price * multiplier * between(0.94, 1.08), 5));

      const image = imageMap.get(key);

      foodDocs.push({
        name: dish.name,
        slug: `${seed.slug}-${key}`,
        description: dish.desc,
        emoji: dish.emoji,
        imageUrl: image?.imageUrl,
        imageAttribution: image?.imageAttribution,
        restaurant: restaurant._id,
        cuisine: dish.cuisine,
        category: dish.category,
        dietType: dish.dietType,
        spiceLevel: dish.spice,
        price,
        nutrition: {
          calories: dish.cal,
          protein: dish.pro,
          carbs: dish.carb,
          fat: dish.fat,
          servingDescription: 'Typical single serving',
        },
        nutritionSource: 'estimated',
        prepTimeMinutes: Math.max(2, Math.round(dish.prep * between(0.85, 1.2))),
        tags: dish.tags,
        moodTags: dish.moods,
        mealSlots: dish.slots,
        allergens: dish.allergens,
        rating: Number(clamp(seed.rating + between(-0.4, 0.4), 3.2, 5).toFixed(1)),
        ratingCount: Math.round(between(20, 600)),
        orderCount: Math.round(between(30, 2000)),
        popularity: Number(clamp(seed.popularityIndex + between(-0.2, 0.2), 0.05, 1).toFixed(2)),
        isAvailable: true,
        dataSource: 'seed',
      });
    }
  }

  const foods = await FoodItem.insertMany(foodDocs);
  log(`[seed] ${foods.length} menu items`);

  // ── Crowd history (3 weeks of visitor reports) ─────────────────────────────
  const reports = [];
  const now = new Date();

  const levelFor = (score) => {
    if (score < 15) return 'empty';
    if (score < 35) return 'low';
    if (score < 60) return 'moderate';
    if (score < 80) return 'crowded';
    return 'very_crowded';
  };

  for (const restaurant of restaurants) {
    const curve = restaurant.baselineCrowdCurve;

    for (let daysAgo = 21; daysAgo >= 1; daysAgo -= 1) {
      const day = new Date(now);
      day.setDate(day.getDate() - daysAgo);

      for (let hour = 0; hour < 24; hour += 1) {
        const expected = curve[day.getDay()][hour];
        if (expected < 0.12) continue;
        // Busier hours attract more reports, exactly as they would in reality.
        if (rand() > expected * 0.55) continue;

        const count = expected > 0.7 ? (rand() > 0.55 ? 2 : 1) : 1;
        for (let i = 0; i < count; i += 1) {
          const score = clamp(expected * 100 + between(-14, 14), 0, 100);
          const level = levelFor(score);
          const createdAt = new Date(day);
          createdAt.setHours(hour, Math.floor(between(0, 59)), 0, 0);

          reports.push({
            restaurant: restaurant._id,
            anonymousKey: `seed-${Math.floor(between(1, 400))}`,
            level,
            observedWaitMinutes: Math.round(clamp((score / 100) ** 1.8 * 45, 0, 60) / 5) * 5,
            dayOfWeek: createdAt.getDay(),
            hour,
            reportedFor: createdAt,
            createdAt,
            updatedAt: createdAt,
            source: 'simulated',
          });
        }
      }
    }
  }

  await CrowdReport.insertMany(reports, { ordered: false });
  log(`[seed] ${reports.length} historical crowd reports (simulated)`);

  // ── Live check-ins so "right now" has real signal on first load ────────────
  const checkIns = [];
  for (const restaurant of restaurants) {
    const expected = restaurant.baselineCrowdCurve[now.getDay()][now.getHours()];
    if (expected < 0.15) continue;

    const heads = Math.round(expected * restaurant.seatingCapacity * between(0.25, 0.6));
    const parties = Math.max(1, Math.round(heads / 2.4));

    for (let i = 0; i < parties; i += 1) {
      const minutesAgo = Math.floor(between(1, 70));
      const createdAt = new Date(now.getTime() - minutesAgo * 60000);
      checkIns.push({
        restaurant: restaurant._id,
        anonymousKey: `seed-live-${restaurant.slug}-${i}`,
        partySize: Math.max(1, Math.round(between(1, 4))),
        dayOfWeek: createdAt.getDay(),
        hour: createdAt.getHours(),
        source: 'simulated',
        expiresAt: new Date(createdAt.getTime() + 150 * 60000),
        createdAt,
        updatedAt: createdAt,
      });
    }
  }
  if (checkIns.length) await CheckIn.insertMany(checkIns, { ordered: false });
  log(`[seed] ${checkIns.length} live check-ins (simulated)`);

  log('[seed] rolling up historical crowd patterns…');
  const snapshotCount = await recomputeSnapshots(null, { lookbackDays: 30 });
  log(`[seed] ${snapshotCount} crowd snapshots`);

  // ── Users ─────────────────────────────────────────────────────────────────
  const users = [];
  for (const account of DEMO_ACCOUNTS) {
    const user = new User({
      name: account.name,
      email: account.email,
      avatarEmoji: account.avatarEmoji,
      addresses: account.addresses,
    });
    await user.setPassword(account.password);
    await user.save();
    await UserPreference.create({ user: user._id, ...account.preferences });
    users.push(user);
  }
  log(`[seed] ${users.length} demo accounts`);

  // ── Reviews ───────────────────────────────────────────────────────────────
  const reviewDocs = [];
  for (const restaurant of restaurants) {
    const count = Math.round(between(3, 6));
    for (let i = 0; i < count; i += 1) {
      const [title, body] = pick(REVIEW_SNIPPETS);
      const author = pick(users);
      const createdAt = new Date(now.getTime() - Math.floor(between(1, 60)) * 86400000);
      reviewDocs.push({
        user: author._id,
        authorName: pick(['Arun', 'Meena', 'Karthik', 'Divya', 'Ravi', 'Swetha', 'Naveen', 'Anitha']),
        restaurant: restaurant._id,
        rating: Math.round(clamp(restaurant.rating + between(-0.8, 0.6), 1, 5)),
        title,
        body,
        visitedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }
  await Review.insertMany(reviewDocs);
  log(`[seed] ${reviewDocs.length} reviews`);

  // ── Order history + favourites for the primary demo account ───────────────
  const demoUser = users[0];
  const foodsByRestaurant = new Map();
  for (const food of foods) {
    const key = String(food.restaurant);
    if (!foodsByRestaurant.has(key)) foodsByRestaurant.set(key, []);
    foodsByRestaurant.get(key).push(food);
  }

  const orderSources = [bySlug.get('biryani-house'), bySlug.get('sri-krishna-bhavan'), bySlug.get('wok-and-roll')];
  const orders = [];
  for (const [index, restaurant] of orderSources.entries()) {
    const menu = foodsByRestaurant.get(String(restaurant._id)) ?? [];
    if (!menu.length) continue;

    const chosen = [pick(menu), pick(menu)].filter((v, i, arr) => arr.findIndex((x) => String(x._id) === String(v._id)) === i);
    const items = chosen.map((food) => ({
      food: food._id,
      name: food.name,
      emoji: food.emoji,
      unitPrice: food.price,
      quantity: 1,
      lineTotal: food.price,
    }));
    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
    const taxes = Math.round(subtotal * 0.05);
    const createdAt = new Date(now.getTime() - (index + 1) * 4 * 86400000);

    orders.push({
      orderNumber: `FASEED${1000 + index}`,
      user: demoUser._id,
      restaurant: restaurant._id,
      restaurantName: restaurant.name,
      items,
      fulfilment: 'delivery',
      deliveryAddress: demoUser.addresses[0],
      pricing: { subtotal, deliveryFee: subtotal < 499 ? 29 : 0, taxes, total: subtotal + taxes + (subtotal < 499 ? 29 : 0) },
      payment: { method: 'demo_upi', status: 'paid', reference: `DEMO-SEED-${index}`, isSimulated: true },
      status: 'delivered',
      statusHistory: [
        { status: 'placed', at: createdAt },
        { status: 'delivered', at: new Date(createdAt.getTime() + 35 * 60000) },
      ],
      etaMinutes: 35,
      createdAt,
      updatedAt: createdAt,
    });
  }
  await Order.insertMany(orders);

  const favouriteFood = foodsByRestaurant.get(String(bySlug.get('biryani-house')._id))?.[0];
  await Favorite.insertMany(
    [
      favouriteFood && { user: demoUser._id, targetType: 'food', food: favouriteFood._id },
      { user: demoUser._id, targetType: 'restaurant', restaurant: bySlug.get('sri-krishna-bhavan')._id },
      { user: demoUser._id, targetType: 'restaurant', restaurant: bySlug.get('biryani-house')._id },
    ].filter(Boolean)
  );

  // Give the demo account a believable learned profile.
  await UserPreference.updateOne(
    { user: demoUser._id },
    {
      $set: {
        cuisineAffinity: { andhra: 0.42, south_indian: 0.3, chinese: 0.18, italian: -0.1 },
        tagAffinity: { spicy: 0.35, filling: 0.28, protein: 0.2, light: -0.12 },
      },
    }
  );

  log(`[seed] ${orders.length} past orders + favourites for ${demoUser.email}`);

  return {
    center: origin,
    photos: imageMap.size,
    restaurants: restaurants.length,
    foods: foods.length,
    crowdReports: reports.length,
    checkIns: checkIns.length,
    snapshots: snapshotCount,
    users: users.length,
    reviews: reviewDocs.length,
    orders: orders.length,
    accounts: DEMO_ACCOUNTS.map((a) => ({ email: a.email, password: a.password })),
  };
}
