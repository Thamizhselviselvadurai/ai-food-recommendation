import { FoodItem } from '../../models/index.js';
import { env } from '../../config/env.js';
import { DISH_ARTICLE, resolveFoodImages } from './foodImages.js';

/**
 * ---------------------------------------------------------------------------
 * Fills in missing dish photographs after the fact.
 * ---------------------------------------------------------------------------
 * Photos are normally resolved once at seed time, but that single network call
 * is a single point of failure: if Wikimedia is unreachable during the seed —
 * which is exactly what happened to this database — every dish is left with
 * `imageUrl: null` and the whole app falls back to emoji tiles forever, with
 * nothing to retry it.
 *
 * This makes the resolution recoverable. It runs on boot for anything still
 * missing, and can be re-run by hand with `npm run backfill:images`.
 * Non-fatal by design: no photo just means the emoji tile, same as before.
 * ---------------------------------------------------------------------------
 */

/** Recovers the catalogue dish key from a FoodItem slug (`<restaurant>-<key>`). */
function dishKeyForSlug(slug) {
  if (!slug) return null;
  // Slugs are `${restaurantSlug}-${dishKey}` and dish keys contain underscores,
  // so match the longest known key that the slug ends with.
  let best = null;
  for (const key of Object.keys(DISH_ARTICLE)) {
    if (slug.endsWith(`-${key}`) && (!best || key.length > best.length)) best = key;
  }
  return best;
}

/**
 * Resolves photos for every dish that still has none.
 * Returns { missing, resolved, updated } and never throws.
 */
export async function backfillFoodImages({ quiet = false } = {}) {
  const log = (...args) => { if (!quiet) console.log(...args); };

  if (!env.FOOD_IMAGES_ENABLED) return { missing: 0, resolved: 0, updated: 0, skipped: 'disabled' };

  try {
    const missing = await FoodItem.find(
      {
        $or: [{ imageUrl: null }, { imageUrl: { $exists: false } }, { imageUrl: '' }],
        // Skip dishes we already tried and could not find a photo for; otherwise
        // the same hopeless lookups run on every boot, forever.
        imageResolvedAt: { $exists: false },
      },
      { slug: 1 }
    ).lean();

    if (!missing.length) return { missing: 0, resolved: 0, updated: 0 };

    // Map each dish key to every FoodItem slug that needs it (the same dish
    // appears on many restaurants' menus, so one lookup covers all of them).
    const slugsByKey = new Map();
    for (const item of missing) {
      const key = dishKeyForSlug(item.slug);
      if (!key) continue;
      if (!slugsByKey.has(key)) slugsByKey.set(key, []);
      slugsByKey.get(key).push(item.slug);
    }

    if (!slugsByKey.size) return { missing: missing.length, resolved: 0, updated: 0 };

    log(`[images] resolving photographs for ${slugsByKey.size} dishes (${missing.length} menu items)…`);
    const resolved = await resolveFoodImages([...slugsByKey.keys()]);

    const attemptedAt = new Date();
    const operations = [];

    for (const [key, slugs] of slugsByKey) {
      if (!slugs.length) continue;
      const image = resolved.get(key);
      operations.push({
        updateMany: {
          filter: { slug: { $in: slugs } },
          // Stamp every dish we looked at, with or without a photo, so a dish
          // whose article has no image is not retried on the next boot.
          update: {
            $set: image
              ? { imageUrl: image.imageUrl, imageAttribution: image.imageAttribution, imageResolvedAt: attemptedAt }
              : { imageResolvedAt: attemptedAt },
          },
        },
      });
    }

    const result = operations.length ? await FoodItem.bulkWrite(operations, { ordered: false }) : null;
    const updated = result?.modifiedCount ?? 0;

    if (!resolved.size) {
      log('[images] no photographs resolved this pass — those dishes keep their emoji tiles');
    } else {
      log(`[images] ${resolved.size}/${slugsByKey.size} dishes resolved — ${updated} menu items updated`);
    }
    return { missing: missing.length, resolved: resolved.size, updated };
  } catch (error) {
    console.warn(`[images] backfill failed (non-fatal): ${error.message}`);
    return { missing: 0, resolved: 0, updated: 0, error: error.message };
  }
}
