import { formatDistance } from '../utils/geo.js';

export function serializeRestaurant(restaurant, extra = {}) {
  if (!restaurant) return null;
  const [lng, lat] = restaurant.location?.coordinates ?? [];

  return {
    id: String(restaurant._id),
    name: restaurant.name,
    slug: restaurant.slug,
    tagline: restaurant.tagline,
    emoji: restaurant.emoji,
    coverGradient: restaurant.coverGradient,
    cuisines: restaurant.cuisines ?? [],

    // `*Source` travels with every value so the UI can say "estimated from the
    // venue type" or "no rating published" instead of implying certainty.
    priceCategory: restaurant.priceCategory ?? null,
    priceSource: restaurant.priceSource ?? 'seed',
    avgCostForOne: restaurant.avgCostForOne ?? null,
    rating: restaurant.rating ?? null,
    ratingCount: restaurant.ratingCount ?? 0,
    ratingSource: restaurant.ratingSource ?? 'seed',

    imageUrl: restaurant.imageUrl ?? null,
    imageAttribution: restaurant.imageAttribution ?? null,
    website: restaurant.website ?? null,
    provider: restaurant.provider ?? 'seed',
    attribution: restaurant.attribution ?? null,
    hoursKnown: restaurant.hoursKnown !== false && Boolean(restaurant.openingHours?.length),

    address: restaurant.address,
    coordinates: lat == null ? null : { lat, lng },
    phone: restaurant.phone,
    isPureVeg: restaurant.isPureVeg,
    deliveryAvailable: restaurant.deliveryAvailable,
    dineInAvailable: restaurant.dineInAvailable,
    openingHours: restaurant.openingHours,
    tags: restaurant.tags ?? [],
    dataSource: restaurant.dataSource,
    ...extra,
  };
}

export function serializeFood(food, extra = {}) {
  if (!food) return null;
  return {
    id: String(food._id),
    name: food.name,
    slug: food.slug,
    description: food.description,
    emoji: food.emoji,
    // Real photograph when one resolved; the client falls back to the emoji
    // tile if this is null or fails to load.
    imageUrl: food.imageUrl ?? null,
    imageAttribution: food.imageAttribution ?? null,
    cuisine: food.cuisine,
    category: food.category,
    dietType: food.dietType,
    spiceLevel: food.spiceLevel,
    price: food.price,
    nutrition: food.nutrition
      ? {
        ...food.nutrition,
        // Surfaced verbatim in the UI so nobody reads these as lab values.
        isEstimate: food.nutritionSource === 'estimated',
        source: food.nutritionSource,
        disclaimer: food.nutritionSource === 'estimated'
          ? 'Nutrition values are estimates for a typical serving.'
          : undefined,
      }
      : null,
    prepTimeMinutes: food.prepTimeMinutes,
    tags: food.tags ?? [],
    moodTags: food.moodTags ?? [],
    mealSlots: food.mealSlots ?? [],
    allergens: food.allergens ?? [],
    rating: food.rating,
    ratingCount: food.ratingCount,
    isAvailable: food.isAvailable,
    restaurantId: food.restaurant ? String(food.restaurant._id ?? food.restaurant) : null,
    // Where this dish record came from. `indicative` means the venue is real but
    // its menu is not published by any provider, so this is a typical dish for
    // the cuisine it is tagged with — the UI says so instead of implying a menu.
    menuSource: food.dataSource ?? 'seed',
    menuDisclaimer: food.dataSource === 'indicative'
      ? 'Typical dish for this kind of place — this venue does not publish its menu, so the item and price are indicative.'
      : undefined,
    ...extra,
  };
}

/** One ranked recommendation, with the full "why" attached. */
export function serializeRecommendation(item) {
  return {
    id: `${item.food?._id ?? 'x'}:${item.restaurant?._id ?? 'x'}`,
    matchPercent: item.matchPercent,
    score: Number((item.score ?? 0).toFixed(4)),
    food: serializeFood(item.food),
    restaurant: serializeRestaurant(item.restaurant),
    distanceKm: item.distanceKm != null ? Number(item.distanceKm.toFixed(2)) : null,
    distanceLabel: formatDistance(item.distanceKm),
    crowd: item.crowd ?? null,
    timing: {
      etaMinutes: item.etaMinutes,
      deliveryEtaMinutes: item.deliveryEta,
      dineInEtaMinutes: item.dineInEta,
      travelMinutes: item.travelMinutes,
    },
    isOpen: item.isOpen,
    closingSoon: item.closingSoon,
    overBudget: item.overBudget ?? false,
    explanation: item.explanation,
    explanationSource: item.explanationSource,
    factors: item.factors ?? [],
    adjustments: item.adjustments ?? [],
    alsoAvailable: item.alsoAvailable?.map((a) => ({
      food: serializeFood(a.food),
      matchPercent: a.matchPercent,
    })),
  };
}

/** A restaurant card on the "near me" screen. */
export function serializeNearbyPlace(place) {
  return {
    ...serializeRestaurant(place.restaurant),
    distanceKm: place.distanceKm != null ? Number(place.distanceKm.toFixed(2)) : null,
    distanceLabel: formatDistance(place.distanceKm),
    isOpen: place.isOpen,
    closingSoon: place.closingSoon,
    crowd: place.crowd,
    timing: {
      dineInEtaMinutes: place.dineInEta,
      deliveryEtaMinutes: place.deliveryEta,
      travelMinutes: place.travelMinutes,
    },
    matchPercent: place.matchPercent,
    factors: place.factors,
  };
}

export function serializeOrder(order) {
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    restaurant: order.restaurant?._id
      ? serializeRestaurant(order.restaurant)
      : { id: String(order.restaurant), name: order.restaurantName },
    items: order.items,
    fulfilment: order.fulfilment,
    deliveryAddress: order.deliveryAddress,
    pricing: order.pricing,
    payment: order.payment,
    status: order.status,
    statusHistory: order.statusHistory,
    etaMinutes: order.etaMinutes,
    notes: order.notes,
    createdAt: order.createdAt,
  };
}
