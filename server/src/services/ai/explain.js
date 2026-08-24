import { AI_MODEL, safeLlmCall } from './client.js';

/**
 * Turns the engine's factor breakdown into a sentence a human wants to read.
 *
 * The LLM is given ONLY the numbers the engine produced — dish name, price,
 * distance, crowd, and each factor's score and reason. It is explicitly told it
 * may not introduce any fact that is not in that payload. If it is unavailable
 * we compose the same explanation from a template, so the feature never
 * silently disappears.
 */

const SAFETY_RULES = `Hard rules:
- Use ONLY the facts in the JSON. Never invent a dish, restaurant, price, distance, wait time or nutrition number.
- Never make health or medical claims. Do not say food cures, treats, fixes or heals anything, and do not claim it will change the user's mood or health. Phrase such things as "may be a lighter option based on your preferences".
- Nutrition numbers are estimates; if you mention one, say "estimated".
- Do not claim live occupancy data. Crowd figures are our own estimates.
- Write in plain, warm, conversational English. No emoji. No bullet points. No headings.`;

/** Deterministic explanation built directly from the factor breakdown. */
export function templateExplanation(item, ctx) {
  const food = item.food;
  const restaurant = item.restaurant;
  const reasons = [];

  const factor = (key) => item.factors?.find((f) => f.key === key);

  if (ctx.budget && food) {
    reasons.push(
      food.price <= ctx.budget
        ? `it is ₹${food.price}, inside your ₹${ctx.budget} budget`
        : `it is ₹${food.price}, slightly over your ₹${ctx.budget} budget`
    );
  }
  if (ctx.hungerLevel && factor('hunger')?.passed) {
    const words = { light: 'a lighter plate', moderate: 'a regular-sized meal', very_hungry: 'a properly filling plate' };
    reasons.push(`it is ${words[ctx.hungerLevel]} at roughly ${Math.round(food?.nutrition?.calories ?? 0)} estimated calories`);
  }
  if (ctx.spiceLevel && factor('spice')?.passed && food) {
    reasons.push(`the spice level is ${food.spiceLevel}, close to what you asked for`);
  }
  if (ctx.dietType && factor('dietary')?.passed) {
    reasons.push(`it fits your ${ctx.dietType} preference`);
  }
  if (item.distanceKm != null) {
    reasons.push(`${restaurant?.name} is ${item.distanceKm < 1 ? `${Math.round(item.distanceKm * 1000)} m` : `${item.distanceKm.toFixed(1)} km`} away`);
  }
  if (item.crowd?.isOpen) {
    reasons.push(`it currently has an estimated ${item.crowd.levelLabel.toLowerCase()} with about a ${item.crowd.waitMinutes.label} wait`);
  }

  const craving = item.adjustments?.find((a) => a.key === 'craving');
  if (craving) reasons.unshift(craving.detail.toLowerCase());

  const weather = item.adjustments?.find((a) => a.key === 'weather' && a.delta > 0);
  if (weather) reasons.push(weather.detail.toLowerCase());

  if (!reasons.length) {
    return `${food?.name ?? restaurant?.name} came out on top for what you asked for right now.`;
  }

  const head = food ? `${food.name} at ${restaurant?.name}` : restaurant?.name;
  const list =
    reasons.length === 1
      ? reasons[0]
      : `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}`;

  return `We picked ${head} because ${list}.`;
}

/** Compact, factual payload — the only thing the model is allowed to use. */
function toPayload(item, ctx) {
  return {
    dish: item.food && {
      name: item.food.name,
      price: item.food.price,
      dietType: item.food.dietType,
      spiceLevel: item.food.spiceLevel,
      estimatedCalories: item.food.nutrition?.calories,
      estimatedProteinGrams: item.food.nutrition?.protein,
      cuisine: item.food.cuisine,
      prepTimeMinutes: item.food.prepTimeMinutes,
    },
    restaurant: item.restaurant && {
      name: item.restaurant.name,
      rating: item.restaurant.rating,
      priceCategory: item.restaurant.priceCategory,
    },
    distanceKm: item.distanceKm != null ? Number(item.distanceKm.toFixed(2)) : null,
    estimatedCrowd: item.crowd && {
      level: item.crowd.level,
      estimatedWait: item.crowd.waitMinutes.label,
      isOpen: item.crowd.isOpen,
    },
    matchPercent: item.matchPercent,
    userAskedFor: {
      mood: ctx.mood,
      hungerLevel: ctx.hungerLevel,
      budget: ctx.budget,
      dietType: ctx.dietType,
      spiceLevel: ctx.spiceLevel,
      wants: ctx.keywords,
      avoiding: ctx.avoid,
      maxWaitMinutes: ctx.maxWaitMinutes,
      weather: ctx.weather?.condition,
    },
    factorBreakdown: item.factors?.map((f) => ({
      factor: f.label,
      weightPercent: Math.round(f.weight * 100),
      scorePercent: Math.round(f.score * 100),
      reason: f.detail,
    })),
    bonuses: item.adjustments?.map((a) => a.detail),
  };
}

/** Explains the single top recommendation in two sentences. */
export async function explainRecommendation(item, ctx) {
  const fallback = templateExplanation(item, ctx);

  const { value, source } = await safeLlmCall(
    async (anthropic) => {
      const response = await anthropic.messages.create({
        model: AI_MODEL,
        // A two-sentence explanation — a bigger budget buys nothing here.
        max_tokens: 400,
        output_config: { effort: 'low' },
        system: `You explain why a food recommendation engine ranked an option first. Write two sentences, at most 55 words.\n\n${SAFETY_RULES}`,
        messages: [{ role: 'user', content: JSON.stringify(toPayload(item, ctx)) }],
      });

      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
      if (!text) throw new Error('Empty explanation');
      return text;
    },
    fallback,
    { label: 'explain' }
  );

  return { explanation: value, explanationSource: source === 'llm' ? 'llm' : 'template' };
}

/**
 * Explains a whole result set in one call rather than N — keeps latency and
 * cost sane when the UI shows six cards.
 */
export async function explainAll(items, ctx, { llmLimit = 3 } = {}) {
  const explained = items.map((item) => ({
    ...item,
    ...({ explanation: templateExplanation(item, ctx), explanationSource: 'template' }),
  }));

  if (!items.length) return explained;

  const { value, source } = await safeLlmCall(
    async (anthropic) => {
      const payload = items.slice(0, llmLimit).map((item, index) => ({ index, ...toPayload(item, ctx) }));

      const response = await anthropic.messages.create({
        model: AI_MODEL,
        max_tokens: 1200,
        output_config: { effort: 'low' },
        system:
          'You explain why a food recommendation engine ranked each option where it did. ' +
          'Return ONLY a JSON array of objects {"index": number, "explanation": string}. ' +
          'Each explanation is one or two sentences, at most 45 words.\n\n' + SAFETY_RULES,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      });

      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) throw new Error('Explanation payload was not an array');
      return parsed;
    },
    null,
    { label: 'explain-batch' }
  );

  if (value && source === 'llm') {
    for (const entry of value) {
      const target = explained[entry.index];
      if (target && typeof entry.explanation === 'string' && entry.explanation.trim()) {
        target.explanation = entry.explanation.trim();
        target.explanationSource = 'llm';
      }
    }
  }

  return explained;
}
