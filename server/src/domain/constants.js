/**
 * Single source of truth for the domain vocabulary.
 * The client mirrors the user-facing subset in `client/src/lib/constants.js`.
 */

export const DIET_TYPES = ['veg', 'vegan', 'egg', 'nonveg'];

/** What a user with diet preference X is allowed to be shown. */
export const DIET_COMPATIBILITY = {
  vegan: ['vegan'],
  veg: ['veg', 'vegan'],
  egg: ['veg', 'vegan', 'egg'],
  nonveg: ['veg', 'vegan', 'egg', 'nonveg'],
};

export const SPICE_LEVELS = ['none', 'mild', 'medium', 'hot'];
export const SPICE_INDEX = { none: 0, mild: 1, medium: 2, hot: 3 };

export const PRICE_CATEGORIES = ['low', 'medium', 'high'];
export const PRICE_BANDS = {
  low: { min: 0, max: 150, label: '₹ Low' },
  medium: { min: 150, max: 350, label: '₹₹ Medium' },
  high: { min: 350, max: Infinity, label: '₹₹₹ High' },
};

export const HUNGER_LEVELS = ['light', 'moderate', 'very_hungry'];

export const MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner', 'late_night'];

export const MOODS = [
  { id: 'happy', label: 'Happy', emoji: '😄', tags: ['tasty', 'shareable', 'indulgent'] },
  { id: 'tired', label: 'Tired', emoji: '😮‍💨', tags: ['energy', 'comfort', 'warm', 'quick'] },
  { id: 'stressed', label: 'Stressed', emoji: '😖', tags: ['comfort', 'warm', 'light'] },
  { id: 'sad', label: 'Sad', emoji: '😔', tags: ['comfort', 'sweet', 'warm'] },
  { id: 'very_hungry', label: 'Very Hungry', emoji: '🍽️', tags: ['heavy', 'filling', 'value'] },
  { id: 'slightly_hungry', label: 'Slightly Hungry', emoji: '🙂', tags: ['light', 'snack', 'quick'] },
  { id: 'light', label: 'Something Light', emoji: '🥗', tags: ['light', 'healthy', 'low_cal'] },
  { id: 'spicy', label: 'Something Spicy', emoji: '🌶️', tags: ['spicy', 'tasty'] },
  { id: 'healthy', label: 'Something Healthy', emoji: '🥬', tags: ['healthy', 'low_cal', 'protein'] },
  { id: 'energy', label: 'Need Energy', emoji: '⚡', tags: ['energy', 'protein', 'carb_rich'] },
  { id: 'craving', label: 'Craving Something Tasty', emoji: '🤤', tags: ['tasty', 'indulgent', 'fried'] },
  { id: 'late_night', label: 'Late-Night Hunger', emoji: '🌙', tags: ['quick', 'comfort', 'late_night'] },
];

export const MOOD_IDS = MOODS.map((m) => m.id);
export const MOOD_TAGS = Object.fromEntries(MOODS.map((m) => [m.id, m.tags]));

/** Descriptive tags a dish can carry. Used for mood/nutrition/context matching. */
export const FOOD_TAGS = [
  'light', 'heavy', 'filling', 'comfort', 'warm', 'cold', 'refreshing',
  'healthy', 'low_cal', 'high_cal', 'protein', 'carb_rich', 'fried',
  'spicy', 'sweet', 'tasty', 'indulgent', 'shareable', 'quick', 'value',
  'snack', 'soupy', 'late_night', 'energy', 'street_food', 'grilled', 'baked',
];

export const ALLERGENS = ['dairy', 'gluten', 'nuts', 'peanut', 'soy', 'seafood', 'egg', 'sesame', 'mustard'];

export const CUISINES = [
  'south_indian', 'north_indian', 'chinese', 'italian', 'continental',
  'arabian', 'kerala', 'andhra', 'chettinad', 'street_food', 'bakery',
  'beverages', 'desserts', 'healthy',
];

export const CUISINE_LABELS = {
  south_indian: 'South Indian',
  north_indian: 'North Indian',
  chinese: 'Chinese',
  italian: 'Italian',
  continental: 'Continental',
  arabian: 'Arabian',
  kerala: 'Kerala',
  andhra: 'Andhra',
  chettinad: 'Chettinad',
  street_food: 'Street Food',
  bakery: 'Bakery',
  beverages: 'Beverages',
  desserts: 'Desserts',
  healthy: 'Healthy',
};

export const FOOD_CATEGORIES = ['breakfast', 'main', 'snack', 'dessert', 'beverage', 'side'];

export const CROWD_LEVELS = ['low', 'moderate', 'high'];

export const CROWD_REPORT_LEVELS = ['empty', 'low', 'moderate', 'crowded', 'very_crowded'];

/** Crowd report -> 0..100 contribution. */
export const CROWD_REPORT_SCORES = {
  empty: 5,
  low: 25,
  moderate: 50,
  crowded: 78,
  very_crowded: 95,
};

export const WEATHER_CONDITIONS = ['hot', 'warm', 'mild', 'cool', 'cold', 'rainy'];

/** Which dish tags get a nudge in which weather. Contextual only — never decisive. */
export const WEATHER_TAG_AFFINITY = {
  hot: { refreshing: 1, cold: 1, light: 0.6, low_cal: 0.3, fried: -0.6, heavy: -0.5 },
  warm: { refreshing: 0.5, light: 0.3, fried: -0.2 },
  mild: {},
  cool: { warm: 0.4, soupy: 0.4 },
  cold: { warm: 1, soupy: 0.8, comfort: 0.5, cold: -0.8, refreshing: -0.6 },
  rainy: { warm: 1, soupy: 0.9, fried: 0.5, comfort: 0.6, snack: 0.4, cold: -0.7 },
};

export const REJECTION_REASONS = [
  { id: 'too_expensive', label: 'Too expensive' },
  { id: 'too_spicy', label: 'Too spicy' },
  { id: 'not_filling', label: 'Not filling enough' },
  { id: 'dislike_food', label: "Don't like this food" },
  { id: 'dislike_restaurant', label: "Don't like this restaurant" },
  { id: 'ate_recently', label: 'Already ate this recently' },
  { id: 'too_far', label: 'Too far' },
  { id: 'too_much_waiting', label: 'Too much waiting' },
  { id: 'other', label: 'Other' },
];

export const ORDER_STATUSES = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'ready_for_pickup', 'delivered', 'cancelled'];

/**
 * Recommendation weights (must sum to 1.0). Exposed via /api/recommendations/weights
 * so the UI can show exactly how a score was built.
 */
export const SCORING_WEIGHTS = {
  mood: 0.15,
  hunger: 0.20,
  budget: 0.15,
  dietary: 0.15,
  nutrition: 0.10,
  spice: 0.10,
  history: 0.10,
  distanceTime: 0.05,
};

/** Additional weights layered on when ranking *places* rather than dishes. */
export const PLACE_WEIGHTS = {
  dish: 0.55,
  distance: 0.15,
  crowd: 0.18,
  rating: 0.12,
};

export const FACTOR_LABELS = {
  mood: 'Mood',
  hunger: 'Hunger',
  budget: 'Budget',
  dietary: 'Dietary preference',
  nutrition: 'Nutrition',
  spice: 'Spice preference',
  history: 'Your past choices',
  distanceTime: 'Distance & time',
  dish: 'Food match',
  distance: 'Distance',
  crowd: 'Crowd',
  rating: 'Rating',
};
