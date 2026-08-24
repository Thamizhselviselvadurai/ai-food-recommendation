/** User-facing mirror of the server's domain vocabulary (server/src/domain/constants.js). */

export const MOODS = [
  { id: 'happy', label: 'Happy', emoji: '😄' },
  { id: 'tired', label: 'Tired', emoji: '😮‍💨' },
  { id: 'stressed', label: 'Stressed', emoji: '😖' },
  { id: 'sad', label: 'Sad', emoji: '😔' },
  { id: 'very_hungry', label: 'Very Hungry', emoji: '🍽️' },
  { id: 'slightly_hungry', label: 'Slightly Hungry', emoji: '🙂' },
  { id: 'light', label: 'Something Light', emoji: '🥗' },
  { id: 'spicy', label: 'Something Spicy', emoji: '🌶️' },
  { id: 'healthy', label: 'Something Healthy', emoji: '🥬' },
  { id: 'energy', label: 'Need Energy', emoji: '⚡' },
  { id: 'craving', label: 'Craving Something Tasty', emoji: '🤤' },
  { id: 'late_night', label: 'Late-Night Hunger', emoji: '🌙' },
];

export const HUNGER_LEVELS = [
  { id: 'light', label: 'Just a bite', emoji: '🍪' },
  { id: 'moderate', label: 'Normal meal', emoji: '🍲' },
  { id: 'very_hungry', label: 'Really hungry', emoji: '🍛' },
];

export const DIET_TYPES = [
  { id: 'veg', label: 'Vegetarian', emoji: '🟢' },
  { id: 'vegan', label: 'Vegan', emoji: '🌱' },
  { id: 'egg', label: 'Eggetarian', emoji: '🥚' },
  { id: 'nonveg', label: 'Non-veg', emoji: '🍗' },
];

export const SPICE_LEVELS = [
  { id: 'none', label: 'No spice', emoji: '🥛' },
  { id: 'mild', label: 'Mild', emoji: '🌤️' },
  { id: 'medium', label: 'Medium', emoji: '🌶️' },
  { id: 'hot', label: 'Hot', emoji: '🔥' },
];

export const PRICE_CATEGORIES = [
  { id: 'low', label: '₹ Low', hint: 'Under ₹150' },
  { id: 'medium', label: '₹₹ Medium', hint: '₹150 – ₹350' },
  { id: 'high', label: '₹₹₹ High', hint: '₹350+' },
];

export const CALORIE_PREFERENCES = [
  { id: 'any', label: 'No preference' },
  { id: 'low', label: 'Lighter (~300 kcal)' },
  { id: 'moderate', label: 'Balanced (~500 kcal)' },
  { id: 'high', label: 'Hearty (~800 kcal)' },
];

export const CUISINES = [
  { id: 'south_indian', label: 'South Indian' },
  { id: 'north_indian', label: 'North Indian' },
  { id: 'chinese', label: 'Chinese' },
  { id: 'italian', label: 'Italian' },
  { id: 'continental', label: 'Continental' },
  { id: 'arabian', label: 'Arabian' },
  { id: 'kerala', label: 'Kerala' },
  { id: 'andhra', label: 'Andhra' },
  { id: 'chettinad', label: 'Chettinad' },
  { id: 'street_food', label: 'Street Food' },
  { id: 'bakery', label: 'Bakery' },
  { id: 'beverages', label: 'Beverages' },
  { id: 'desserts', label: 'Desserts' },
  { id: 'healthy', label: 'Healthy' },
];

export const ALLERGENS = [
  { id: 'dairy', label: 'Dairy' },
  { id: 'gluten', label: 'Gluten' },
  { id: 'nuts', label: 'Tree nuts' },
  { id: 'peanut', label: 'Peanut' },
  { id: 'soy', label: 'Soy' },
  { id: 'seafood', label: 'Seafood' },
  { id: 'egg', label: 'Egg' },
  { id: 'sesame', label: 'Sesame' },
  { id: 'mustard', label: 'Mustard' },
];

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

export const CROWD_LEVELS = {
  low: { emoji: '🟢', label: 'Low Crowd' },
  moderate: { emoji: '🟡', label: 'Moderate Crowd' },
  high: { emoji: '🔴', label: 'High Crowd' },
  closed: { emoji: '⚪', label: 'Closed' },
};

export const CHAT_SUGGESTIONS = [
  "I'm very hungry and I have only ₹150.",
  'I am tired and want something light.',
  "I want something spicy but I don't want to spend more than ₹250.",
  'Suggest a healthy dinner.',
  "I don't want rice today.",
  "I want something near me and I don't want to wait.",
];

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const findLabel = (list, id, fallback = '') => list.find((item) => item.id === id)?.label ?? fallback;
