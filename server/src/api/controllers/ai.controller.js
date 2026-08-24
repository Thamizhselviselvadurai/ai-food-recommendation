import { z } from 'zod';
import { askAi } from '../../services/ai/chat.js';
import { extractIntent } from '../../services/ai/intent.js';
import { aiStatus } from '../../services/ai/client.js';
import { RecommendationHistory } from '../../models/index.js';
import { ENGINE_VERSION } from '../../services/recommendation/engine.js';
import { coarsenLocation } from '../../utils/geo.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { serializeRecommendation } from '../serializers.js';

export const chatSchema = z.object({
  message: z.string().min(1, 'Type something first').max(600),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
    .max(20)
    .optional(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable()
    .optional(),
  mode: z.enum(['auto', 'foods', 'places']).optional(),
});

export const parseSchema = z.object({ message: z.string().min(1).max(600) });

export const chat = asyncHandler(async (req, res) => {
  const { message, history = [], location = null, mode = 'auto' } = req.body;

  const result = await askAi({ message, history, location, userId: req.userId, mode });

  if (req.userId && result.items.length) {
    await RecommendationHistory.create({
      user: req.userId,
      surface: 'chat',
      query: message,
      intentSource: result.intentSource,
      engineVersion: ENGINE_VERSION,
      context: {
        ...result.resolvedContext,
        weather: result.resolvedContext.weather
          ? { condition: result.resolvedContext.weather.condition, temperatureC: result.resolvedContext.weather.temperatureC }
          : undefined,
        approxLocation: location ? coarsenLocation(location) : undefined,
      },
      results: result.items.slice(0, 6).map((item) => ({
        food: item.food?._id,
        restaurant: item.restaurant?._id,
        score: item.score,
        matchPercent: item.matchPercent,
        factors: item.factors,
        explanation: item.explanation,
        explanationSource: item.explanationSource,
      })),
    }).catch((error) => console.warn('[ai] could not persist chat history:', error.message));
  }

  res.json({
    reply: result.reply,
    replySource: result.replySource,
    intent: result.intent,
    intentSource: result.intentSource,
    resolvedContext: result.resolvedContext,
    resultType: result.resultType,
    items: result.items.map(serializeRecommendation),
    meta: { tookMs: result.tookMs, fallbackReason: result.fallbackReason, ...aiStatus() },
  });
});

/** Exposed for the UI's "here's what I understood" chip row, and for debugging. */
export const parse = asyncHandler(async (req, res) => {
  const { intent, source, fallbackReason } = await extractIntent(req.body.message);
  res.json({ intent, source, fallbackReason });
});

export const status = (req, res) => res.json(aiStatus());
