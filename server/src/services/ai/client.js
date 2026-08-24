import Anthropic from '@anthropic-ai/sdk';
import { env, isLlmAvailable } from '../../config/env.js';

let client = null;

/** Lazily constructed so the server boots fine with no API key configured. */
export function getClient() {
  if (!isLlmAvailable()) return null;
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Wraps an LLM call so a failure never breaks a request — every AI feature in
 * this app has a deterministic fallback and this is where we switch to it.
 */
export async function safeLlmCall(operation, fallbackValue, { label = 'llm' } = {}) {
  const anthropic = getClient();
  if (!anthropic) return { value: fallbackValue, source: 'fallback', reason: 'llm_unavailable' };

  try {
    const value = await operation(anthropic);
    return { value, source: 'llm' };
  } catch (error) {
    const reason =
      error instanceof Anthropic.AuthenticationError ? 'invalid_api_key'
        : error instanceof Anthropic.RateLimitError ? 'rate_limited'
          : error instanceof Anthropic.APIError ? `api_error_${error.status}`
            : 'unexpected_error';

    console.warn(`[ai/${label}] falling back (${reason}): ${error.message}`);
    return { value: fallbackValue, source: 'fallback', reason };
  }
}

export const AI_MODEL = env.AI_MODEL;

export const aiStatus = () => ({
  enabled: isLlmAvailable(),
  model: isLlmAvailable() ? env.AI_MODEL : null,
  fallback: 'rule-based NLU + template explanations',
});
