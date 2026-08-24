import { DISH_CATALOG } from '../../data/dishCatalog.js';
import { CUISINES } from '../../domain/constants.js';

/**
 * ---------------------------------------------------------------------------
 * Deterministic natural-language parser.
 * ---------------------------------------------------------------------------
 * This is the fallback when no LLM key is configured — and the safety net when
 * an LLM call fails. It handles the phrasings the product actually ships with
 * ("I'm very hungry and I have only ₹150", "I don't want rice today",
 * "something near me and I don't want to wait").
 *
 * It is intentionally conservative: it only sets a field when it is confident.
 * Anything it does not understand is left null and filled by saved preferences.
 * ---------------------------------------------------------------------------
 */

const MOOD_PATTERNS = [
  [/\b(tired|exhaust|sleepy|worn out|drained)\b/, 'tired'],
  [/\b(stress|anxious|tense|pressure|overwhelmed)\b/, 'stressed'],
  [/\b(sad|down|low|upset|depress|lonely)\b/, 'sad'],
  [/\b(happy|celebrat|great day|excited|good mood)\b/, 'happy'],
  [/\b(starv|very hungry|really hungry|super hungry|so hungry)\b/, 'very_hungry'],
  [/\b(slightly hungry|little hungry|bit hungry|not very hungry|not too hungry)\b/, 'slightly_hungry'],
  [/\b(light|small meal|something small|easy on stomach)\b/, 'light'],
  [/\b(spicy|masala|hot food|fiery|chilli)\b/, 'spicy'],
  [/\b(healthy|clean eating|diet|nutritious|low fat)\b/, 'healthy'],
  [/\b(energy|energetic|workout|gym|protein|power)\b/, 'energy'],
  [/\b(craving|tasty|delicious|treat myself|indulge)\b/, 'craving'],
  [/\b(late night|midnight|late-night|this late)\b/, 'late_night'],
];

const CUISINE_PATTERNS = [
  [/\b(south indian|dosa|idli|tiffin|sambar)\b/, 'south_indian'],
  [/\b(north indian|punjabi|tandoor|naan|paneer|roti)\b/, 'north_indian'],
  [/\b(chinese|noodle|manchurian|schezwan|fried rice)\b/, 'chinese'],
  [/\b(italian|pizza|pasta)\b/, 'italian'],
  [/\b(arab|shawarma|falafel|alfaham|al faham)\b/, 'arabian'],
  [/\b(chettinad)\b/, 'chettinad'],
  [/\b(andhra|biryani)\b/, 'andhra'],
  [/\b(kerala|malabar)\b/, 'kerala'],
  [/\b(street food|chaat|pani puri)\b/, 'street_food'],
  [/\b(dessert|sweet|ice cream|cake)\b/, 'desserts'],
  [/\b(juice|drink|beverage|coffee|tea|shake)\b/, 'beverages'],
  [/\b(salad|bowl|healthy food)\b/, 'healthy'],
];

/** Every dish name and key becomes a searchable craving term. */
const DISH_TERMS = (() => {
  const terms = new Map();
  for (const dish of DISH_CATALOG) {
    const words = dish.name.toLowerCase().replace(/\(.*?\)/g, '').trim();
    terms.set(words, words);
    // Also index the distinctive head noun ("biryani", "dosa", "shawarma").
    for (const token of words.split(/\s+/)) {
      if (token.length >= 5 && !['sauce', 'grill', 'plate', 'bowl'].includes(token)) {
        terms.set(token, token);
      }
    }
  }
  return [...terms.keys()].sort((a, b) => b.length - a.length);
})();

export function parseWithRules(rawMessage) {
  const message = String(rawMessage ?? '').toLowerCase().trim();
  const intent = {
    mood: null,
    hungerLevel: null,
    budget: null,
    priceCategory: null,
    dietType: null,
    spiceLevel: null,
    cuisines: [],
    keywords: [],
    avoid: [],
    maxWaitMinutes: null,
    maxDistanceKm: null,
    avoidWaiting: false,
    useLocation: false,
    highProtein: false,
    caloriePreference: null,
    fulfilment: 'any',
    mealSlot: null,
  };
  if (!message) return intent;

  // ── Budget ──────────────────────────────────────────────────────────────
  const budgetMatch =
    message.match(/(?:under|below|less than|within|max(?:imum)?|only|budget of|upto|up to)\s*(?:₹|rs\.?|inr)?\s*(\d{2,5})/) ||
    message.match(/(?:₹|rs\.?|inr)\s*(\d{2,5})/) ||
    message.match(/(\d{2,5})\s*(?:rupees|rs\b|bucks)/);
  if (budgetMatch) intent.budget = Number(budgetMatch[1]);

  if (/\b(cheap|budget|affordable|low cost|inexpensive)\b/.test(message)) intent.priceCategory = 'low';
  if (/\b(premium|fine dining|expensive|fancy|high end)\b/.test(message)) intent.priceCategory = 'high';

  // ── Mood & hunger ───────────────────────────────────────────────────────
  for (const [pattern, mood] of MOOD_PATTERNS) {
    if (pattern.test(message)) { intent.mood = mood; break; }
  }
  if (/\b(starv|very hungry|really hungry|super hungry|so hungry|full meal|heavy)\b/.test(message)) {
    intent.hungerLevel = 'very_hungry';
  } else if (/\b(slightly hungry|little hungry|bit hungry|snack|light|small)\b/.test(message)) {
    intent.hungerLevel = 'light';
  } else if (/\bhungry\b/.test(message)) {
    intent.hungerLevel = 'moderate';
  }

  // ── Diet ────────────────────────────────────────────────────────────────
  if (/\bvegan\b/.test(message)) intent.dietType = 'vegan';
  else if (/\b(non[- ]?veg|nonveg|chicken|mutton|fish|prawn|meat|beef)\b/.test(message)) intent.dietType = 'nonveg';
  else if (/\begg\b/.test(message)) intent.dietType = 'egg';
  else if (/\b(veg|vegetarian|no meat|without meat)\b/.test(message)) intent.dietType = 'veg';

  // ── Spice ───────────────────────────────────────────────────────────────
  if (/\b(not spicy|less spicy|no spice|mild|avoid spicy|without spice)\b/.test(message)) intent.spiceLevel = 'mild';
  else if (/\b(very spicy|extra spicy|super spicy|really spicy)\b/.test(message)) intent.spiceLevel = 'hot';
  else if (/\bspicy\b/.test(message)) intent.spiceLevel = 'hot';

  // ── Cuisine & craving ───────────────────────────────────────────────────
  for (const [pattern, cuisine] of CUISINE_PATTERNS) {
    if (pattern.test(message) && !intent.cuisines.includes(cuisine)) intent.cuisines.push(cuisine);
  }
  for (const term of DISH_TERMS) {
    if (message.includes(term)) {
      intent.keywords.push(term);
      if (intent.keywords.length >= 3) break;
    }
  }

  // ── Avoidance: "I don't want rice", "no onion", "without garlic" ────────
  const avoidPatterns = [
    /(?:don'?t|do not|dont)\s+want\s+(?:any\s+)?([a-z ]{3,25}?)(?:\s+today|\s+right now|[.,!]|$)/g,
    /\bno\s+([a-z]{3,15})\b/g,
    /\bwithout\s+([a-z]{3,15})\b/g,
    /\b(?:avoid|skip)\s+([a-z]{3,15})\b/g,
  ];
  // "I don't want to wait" is about patience, not food. Anything that reads as
  // a verb phrase or a non-food noun is dropped rather than used as a filter —
  // a bad avoid term silently removes real results.
  const NON_FOOD_WORDS = new Set([
    'wait', 'waiting', 'time', 'money', 'much', 'more', 'long', 'far', 'spicy', 'spice',
    'meat', 'that', 'this', 'anything', 'something', 'now', 'today', 'idea', 'clue',
    'problem', 'issue', 'one', 'any', 'the', 'and', 'but', 'for', 'too',
  ]);

  for (const pattern of avoidPatterns) {
    for (const match of message.matchAll(pattern)) {
      let term = match[1].trim();

      // Strip an infinitive marker: "want to wait" -> "wait" -> rejected below.
      term = term.replace(/^to\s+/, '').replace(/^(any|the|a|an)\s+/, '').trim();

      if (!term || term.length < 3) continue;
      if (term.split(/\s+/).some((word) => NON_FOOD_WORDS.has(word))) continue;
      if (term.split(/\s+/).length > 2) continue; // "spend more than 250" etc.
      if (/\d/.test(term)) continue;
      if (!intent.avoid.includes(term)) intent.avoid.push(term);
    }
  }

  // ── Location & waiting ──────────────────────────────────────────────────
  if (/\b(near me|nearby|close by|around me|walking distance|near by)\b/.test(message)) {
    intent.useLocation = true;
    intent.maxDistanceKm = 3;
  }
  if (/\b(don'?t want to wait|no wait|without waiting|quick|fast|hurry|in a rush|asap|immediately)\b/.test(message)) {
    intent.avoidWaiting = true;
    intent.maxWaitMinutes = 20;
  }
  const waitMatch = message.match(/(?:within|under|less than|max)\s*(\d{1,3})\s*(?:min|minute)/);
  if (waitMatch) intent.maxWaitMinutes = Number(waitMatch[1]);

  const distanceMatch = message.match(/(?:within|under|less than)\s*(\d{1,2}(?:\.\d)?)\s*(?:km|kilomet)/);
  if (distanceMatch) intent.maxDistanceKm = Number(distanceMatch[1]);

  if (/\b(dine in|dine-in|sit down|visit|go there|eat out|restaurant near)\b/.test(message)) intent.fulfilment = 'dinein';
  if (/\b(deliver|order online|home delivery|bring it)\b/.test(message)) intent.fulfilment = 'delivery';

  // ── Nutrition ───────────────────────────────────────────────────────────
  if (/\b(high protein|protein rich|more protein|muscle)\b/.test(message)) intent.highProtein = true;
  if (/\b(low calorie|low cal|light on calories|less calories)\b/.test(message)) intent.caloriePreference = 'low';

  // ── Meal slot ───────────────────────────────────────────────────────────
  if (/\bbreakfast\b/.test(message)) intent.mealSlot = 'breakfast';
  else if (/\blunch\b/.test(message)) intent.mealSlot = 'lunch';
  else if (/\bdinner\b/.test(message)) intent.mealSlot = 'dinner';
  else if (/\b(snack|evening)\b/.test(message)) intent.mealSlot = 'snack';
  else if (/\b(late night|midnight)\b/.test(message)) intent.mealSlot = 'late_night';

  intent.cuisines = intent.cuisines.filter((c) => CUISINES.includes(c));
  return intent;
}
