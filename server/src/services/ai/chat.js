import { AI_MODEL, safeLlmCall } from './client.js';
import { buildContext } from '../recommendation/context.js';
import { recommendFoods, recommendPlaces } from '../recommendation/engine.js';
import { explainAll } from './explain.js';
import { extractIntent, intentToContextInput } from './intent.js';

/**
 * "Ask AI what should I eat?"
 *
 * Pipeline — the LLM appears twice and decides nothing in between:
 *
 *   message ──► [LLM #1] structured intent ──► recommendation engine (DB)
 *                                                      │
 *               [LLM #2] conversational reply ◄─────────┘  (grounded in results)
 *
 * If either LLM call is unavailable, rule-based parsing and a template reply
 * take over and the feature keeps working.
 */

const REPLY_SYSTEM = `You are the assistant inside a food recommendation app. A deterministic engine has already chosen the options from the app's own database; your job is only to present them conversationally.

Hard rules:
- Recommend ONLY the options in the JSON. Never invent a dish, restaurant, price, distance or wait time.
- If the options array is empty, say you could not find a match and suggest relaxing one specific constraint the user gave.
- Never make health or medical claims. Do not say food cures, treats or fixes anything. Say "may be a lighter option based on your preferences" instead.
- Call nutrition figures estimates.
- Crowd levels are this app's own estimates, not live occupancy data from any map provider. Never claim otherwise.
- Keep it to 2-4 short sentences. Mention the top option by name with its price, and at most one alternative. No bullet lists, no headings, at most one emoji.`;

export async function askAi({ message, history = [], location = null, userId = null, mode = 'auto' }) {
  const startedAt = Date.now();

  const { intent, source: intentSource, fallbackReason } = await extractIntent(message);

  const ctx = await buildContext(intentToContextInput(intent, { location }), { userId });

  // "somewhere near me" / "I want to go out" -> rank places; otherwise dishes.
  const wantsPlaces =
    mode === 'places' || (mode === 'auto' && (intent.useLocation || intent.fulfilment === 'dinein' || intent.avoidWaiting));

  const engineResult = wantsPlaces
    ? await recommendPlaces(ctx, { limit: 5 })
    : await recommendFoods(ctx, { limit: 6 });

  const items = await explainAll(engineResult.items, ctx, { llmLimit: 3 });

  const reply = await composeReply({ message, history, intent, ctx, items, wantsPlaces });

  return {
    reply: reply.text,
    replySource: reply.source,
    intent,
    intentSource,
    fallbackReason,
    resolvedContext: {
      mood: ctx.mood,
      hungerLevel: ctx.hungerLevel,
      budget: ctx.budget,
      dietType: ctx.dietType,
      spiceLevel: ctx.spiceLevel,
      maxWaitMinutes: ctx.maxWaitMinutes,
      maxDistanceKm: ctx.maxDistanceKm,
      cuisines: ctx.cuisines,
      keywords: ctx.keywords,
      avoid: ctx.avoid,
      mealSlot: ctx.mealSlot,
      weather: ctx.weather,
      usingApproxLocation: ctx.location?.source === 'default_city',
    },
    resultType: wantsPlaces ? 'places' : 'foods',
    items,
    tookMs: Date.now() - startedAt,
  };
}

async function composeReply({ message, history, intent, ctx, items, wantsPlaces }) {
  const fallback = templateReply({ intent, ctx, items, wantsPlaces });
  if (!items.length) return { text: fallback, source: 'template' };

  const payload = {
    userMessage: message,
    understoodAs: {
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
    resultType: wantsPlaces ? 'restaurants' : 'dishes',
    options: items.slice(0, 3).map((item) => ({
      dish: item.food?.name,
      price: item.food?.price,
      restaurant: item.restaurant?.name,
      distanceKm: item.distanceKm != null ? Number(item.distanceKm.toFixed(1)) : null,
      matchPercent: item.matchPercent,
      estimatedCrowdLevel: item.crowd?.level,
      estimatedWait: item.crowd?.waitMinutes?.label,
      estimatedCalories: item.food?.nutrition?.calories,
      whyItRanked: item.explanation,
    })),
  };

  const { value, source } = await safeLlmCall(
    async (anthropic) => {
      const trimmedHistory = history
        .slice(-6)
        .filter((m) => m?.content && ['user', 'assistant'].includes(m.role))
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 1200) }));

      const response = await anthropic.messages.create({
        model: AI_MODEL,
        // Deliberately short conversational turn.
        max_tokens: 600,
        output_config: { effort: 'low' },
        system: REPLY_SYSTEM,
        messages: [
          ...trimmedHistory,
          { role: 'user', content: `User said: ${message}\n\nEngine results:\n${JSON.stringify(payload)}` },
        ],
      });

      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
      if (!text) throw new Error('Empty reply');
      return text;
    },
    fallback,
    { label: 'chat' }
  );

  return { text: value, source: source === 'llm' ? 'llm' : 'template' };
}

function templateReply({ intent, ctx, items, wantsPlaces }) {
  if (!items.length) {
    const constraints = [];
    if (ctx.budget) constraints.push(`the ₹${ctx.budget} budget`);
    if (ctx.maxWaitMinutes) constraints.push(`the ${ctx.maxWaitMinutes} minute wait limit`);
    if (ctx.avoid?.length) constraints.push(`avoiding ${ctx.avoid.join(', ')}`);
    if (ctx.dietType) constraints.push(`the ${ctx.dietType} filter`);

    return constraints.length
      ? `I could not find anything open nearby that fits ${constraints.join(', ')}. Try relaxing ${constraints[0]} and I will look again.`
      : 'I could not find a match nearby right now. Try widening the distance or trying a different craving.';
  }

  const top = items[0];
  const second = items[1];

  const bits = [];
  if (intent.mood) bits.push(`you are feeling ${intent.mood.replace(/_/g, ' ')}`);
  if (ctx.budget) bits.push(`your budget is ₹${ctx.budget}`);
  if (ctx.avoid?.length) bits.push(`you are avoiding ${ctx.avoid.join(' and ')}`);

  const opener = bits.length ? `Going by ${bits.join(' and ')}, ` : '';
  const crowdNote = top.crowd?.isOpen
    ? ` It is showing an estimated ${top.crowd.levelLabel.toLowerCase()} with about a ${top.crowd.waitMinutes.label} wait.`
    : '';
  const alt = second
    ? ` If that does not appeal, ${second.food?.name ?? second.restaurant?.name} at ₹${second.food?.price ?? second.restaurant?.avgCostForOne} is the next best fit.`
    : '';

  const head = wantsPlaces
    ? `${top.restaurant.name} is my pick — their ${top.food.name} is ₹${top.food.price}${top.distanceKm != null ? `, ${top.distanceKm.toFixed(1)} km away` : ''}`
    : `I would go with ${top.food.name} from ${top.restaurant.name} at ₹${top.food.price}`;

  return `${opener}${head} (${top.matchPercent}% match).${crowdNote}${alt}`;
}
