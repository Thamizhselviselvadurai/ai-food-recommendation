import { z } from 'zod';
import { AI_MODEL, safeLlmCall } from './client.js';
import { parseWithRules } from './ruleNlu.js';
import { CUISINES, DIET_TYPES, HUNGER_LEVELS, MEAL_SLOTS, MOOD_IDS, SPICE_LEVELS } from '../../domain/constants.js';

/**
 * Structured intent extraction.
 *
 * The LLM's ONLY job here is to turn a sentence into typed fields. It never
 * sees the menu and never picks a dish — the recommendation engine does that
 * from the database. That is what stops it inventing restaurants or prices.
 *
 * Implemented with a single strict tool that the model is *forced* to call, so
 * the response is a validated JSON object rather than prose we have to parse.
 * (Deliberately not using the SDK's zod output-format helper: forced tool use
 * is the shape that works across every SDK version this project may install.)
 */

const nullableEnum = (values) => z.enum(values).nullable().catch(null);

/** Second line of defence: whatever comes back is re-validated locally. */
const IntentSchema = z.object({
  mood: nullableEnum(MOOD_IDS),
  hungerLevel: nullableEnum(HUNGER_LEVELS),
  budget: z.number().positive().max(100000).nullable().catch(null),
  dietType: nullableEnum(DIET_TYPES),
  spiceLevel: nullableEnum(SPICE_LEVELS),
  cuisines: z.array(z.enum(CUISINES)).catch([]),
  keywords: z.array(z.string().max(40)).catch([]),
  avoid: z.array(z.string().max(40)).catch([]),
  maxWaitMinutes: z.number().positive().max(240).nullable().catch(null),
  maxDistanceKm: z.number().positive().max(50).nullable().catch(null),
  avoidWaiting: z.boolean().catch(false),
  useLocation: z.boolean().catch(false),
  highProtein: z.boolean().catch(false),
  caloriePreference: z.enum(['low', 'moderate', 'high', 'any']).catch('any'),
  fulfilment: z.enum(['delivery', 'dinein', 'any']).catch('any'),
  mealSlot: nullableEnum(MEAL_SLOTS),
  clarification: z.string().max(200).nullable().catch(null),
});

const nullable = (schema, description) => ({ ...schema, description });

const INTENT_TOOL = {
  name: 'record_food_intent',
  description: 'Record the structured food preferences expressed in the user’s message.',
  input_schema: {
    type: 'object',
    properties: {
      mood: nullable({ type: ['string', 'null'], enum: [...MOOD_IDS, null] }, 'Closest matching mood, or null if none was expressed'),
      hungerLevel: nullable({ type: ['string', 'null'], enum: [...HUNGER_LEVELS, null] }, 'How hungry the user says they are'),
      budget: nullable({ type: ['number', 'null'] }, 'Maximum rupees for the food itself. Only a number the user actually mentioned.'),
      dietType: nullable({ type: ['string', 'null'], enum: [...DIET_TYPES, null] }, 'veg, vegan, egg or nonveg — only if stated or clearly implied'),
      spiceLevel: nullable({ type: ['string', 'null'], enum: [...SPICE_LEVELS, null] }, 'Desired spice level'),
      cuisines: nullable({ type: 'array', items: { type: 'string', enum: CUISINES } }, 'Cuisines mentioned or clearly implied; empty array if none'),
      keywords: nullable({ type: 'array', items: { type: 'string' } }, 'Specific dishes the user asked for, e.g. ["biryani"]'),
      avoid: nullable({ type: 'array', items: { type: 'string' } }, 'Foods or ingredients the user does NOT want, e.g. ["rice"]'),
      maxWaitMinutes: nullable({ type: ['number', 'null'] }, 'Maximum minutes they are willing to wait'),
      maxDistanceKm: nullable({ type: ['number', 'null'] }, 'Maximum distance in kilometres'),
      avoidWaiting: nullable({ type: 'boolean' }, 'True if they expressed impatience or wanting something fast'),
      useLocation: nullable({ type: 'boolean' }, 'True if they want somewhere near their current location'),
      highProtein: nullable({ type: 'boolean' }, 'True if they asked for high protein'),
      caloriePreference: nullable({ type: 'string', enum: ['low', 'moderate', 'high', 'any'] }, 'Calorie preference, "any" if unstated'),
      fulfilment: nullable({ type: 'string', enum: ['delivery', 'dinein', 'any'] }, 'Order online, visit the restaurant, or unstated'),
      mealSlot: nullable({ type: ['string', 'null'], enum: [...MEAL_SLOTS, null] }, 'Which meal this is about'),
      clarification: nullable({ type: ['string', 'null'] }, 'A short question to ask if the message has no actionable signal at all; otherwise null'),
    },
    required: [
      'mood', 'hungerLevel', 'budget', 'dietType', 'spiceLevel', 'cuisines', 'keywords', 'avoid',
      'maxWaitMinutes', 'maxDistanceKm', 'avoidWaiting', 'useLocation', 'highProtein',
      'caloriePreference', 'fulfilment', 'mealSlot', 'clarification',
    ],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You extract structured food-ordering preferences from a user's message.

Rules:
- Only fill a field when the user stated it or clearly implied it. Use null / empty arrays otherwise.
- Never guess a budget from context; only use a number the user actually mentioned.
- Currency is Indian Rupees (₹).
- "keywords" holds dishes the user explicitly wants (e.g. "biryani", "dosa"). "avoid" holds what they do not want.
- Do not recommend any food, restaurant or price. You are only parsing the sentence.
- Set "clarification" only when the message has no actionable signal at all (e.g. "hi").`;

export async function extractIntent(message, { timeoutMs = 8000 } = {}) {
  const ruleIntent = parseWithRules(message);

  const { value, source, reason } = await safeLlmCall(
    async (anthropic) => {
      const response = await anthropic.messages.create(
        {
          model: AI_MODEL,
          // Deliberately small: the output is one fixed-shape JSON object, and
          // a larger budget would only add latency.
          max_tokens: 1024,
          output_config: { effort: 'low' },
          system: SYSTEM_PROMPT,
          tools: [INTENT_TOOL],
          tool_choice: { type: 'tool', name: INTENT_TOOL.name },
          messages: [{ role: 'user', content: String(message).slice(0, 2000) }],
        },
        { timeout: timeoutMs }
      );

      const block = response.content.find((b) => b.type === 'tool_use' && b.name === INTENT_TOOL.name);
      if (!block) throw new Error('Model returned no structured intent');

      // Never trust the payload shape — re-validate before it reaches the engine.
      const parsed = IntentSchema.safeParse(block.input);
      if (!parsed.success) throw new Error(`Intent failed validation: ${parsed.error.message}`);
      return parsed.data;
    },
    null,
    { label: 'intent' }
  );

  if (!value) {
    return { intent: ruleIntent, source: 'rules', fallbackReason: reason ?? null };
  }

  // Union the two: the LLM is better at nuance, the rules are better at
  // literal numbers and negations. Rules fill anything the model left blank.
  return { intent: mergeIntents(value, ruleIntent), source, fallbackReason: null };
}

function mergeIntents(primary, secondary) {
  const merged = { ...secondary, ...stripNulls(primary) };

  merged.cuisines = unique([...(primary.cuisines ?? []), ...(secondary.cuisines ?? [])]).slice(0, 4);
  merged.keywords = unique([...(primary.keywords ?? []), ...(secondary.keywords ?? [])]).slice(0, 5);
  merged.avoid = unique([...(primary.avoid ?? []), ...(secondary.avoid ?? [])]).slice(0, 6);

  merged.avoidWaiting = Boolean(primary.avoidWaiting || secondary.avoidWaiting);
  merged.useLocation = Boolean(primary.useLocation || secondary.useLocation);
  merged.highProtein = Boolean(primary.highProtein || secondary.highProtein);
  merged.budget = primary.budget ?? secondary.budget ?? null;
  merged.caloriePreference =
    primary.caloriePreference && primary.caloriePreference !== 'any'
      ? primary.caloriePreference
      : secondary.caloriePreference ?? 'any';

  return merged;
}

const stripNulls = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, v]) => v !== null && v !== undefined));

const unique = (values) => [...new Set(values.map((v) => String(v).toLowerCase().trim()).filter(Boolean))];

/** Turns the parsed intent into the shape `buildContext` expects. */
export function intentToContextInput(intent, { location } = {}) {
  return {
    mood: intent.mood,
    hungerLevel: intent.hungerLevel,
    budget: intent.budget,
    priceCategory: intent.priceCategory ?? null,
    dietType: intent.dietType,
    spiceLevel: intent.spiceLevel,
    cuisines: intent.cuisines,
    keywords: intent.keywords,
    avoid: intent.avoid,
    maxWaitMinutes: intent.maxWaitMinutes,
    maxDistanceKm: intent.maxDistanceKm,
    avoidWaiting: intent.avoidWaiting,
    highProtein: intent.highProtein,
    caloriePreference: intent.caloriePreference,
    fulfilment: intent.fulfilment,
    mealSlot: intent.mealSlot,
    location: intent.useLocation === false ? location : location,
  };
}
