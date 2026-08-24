import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { assertConfig } from '../config/env.js';
import { backfillFoodImages } from '../services/images/backfill.js';

/**
 * Re-runs dish photo resolution for anything still missing an image.
 * Safe to run repeatedly: it only touches items whose `imageUrl` is empty.
 *
 *   npm run backfill:images --workspace server
 */
async function main() {
  assertConfig();
  await connectDatabase();

  const result = await backfillFoodImages();
  console.log('[images] done:', result);

  await disconnectDatabase();
}

main().catch((error) => {
  console.error('[images] backfill failed:', error.message);
  process.exit(1);
});
