import { assertConfig, env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { seedDatabase } from './seedData.js';

/**
 * Usage: npm run seed  (from /server, or `npm run seed` at the repo root)
 *
 * Destructive — it clears the collections it owns before inserting the demo
 * dataset. Point MONGODB_URI at a scratch database.
 */
async function main() {
  assertConfig();

  if (env.USE_MEMORY_DB) {
    console.error(
      'USE_MEMORY_DB=true means the database only exists while the server runs, so seeding it from a\n' +
      'separate process has no effect. The server seeds it automatically on boot — just run `npm run dev`.'
    );
    process.exit(1);
  }

  await connectDatabase();
  console.log(`[seed] target: ${env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}`);

  // `npm run seed -- --lat 10.93 --lng 78.72` places the demo menus around a
  // given point, so the dish-level features work wherever you actually are.
  const argv = process.argv.slice(2);
  const readFlag = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? Number(argv[index + 1]) : NaN;
  };
  const lat = readFlag('lat');
  const lng = readFlag('lng');
  const center = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  if (center) console.log(`[seed] centring the demo dataset on ${lat}, ${lng}`);

  const summary = await seedDatabase({ center });

  console.log('\n  Seed complete');
  console.log(`  centre: ${summary.center.lat}, ${summary.center.lng}`);
  console.log(`  ${summary.restaurants} restaurants · ${summary.foods} menu items · ${summary.photos} real dish photos`);
  console.log(`  ${summary.crowdReports} crowd reports · ${summary.checkIns} live check-ins · ${summary.snapshots} snapshots`);
  console.log('\n  Demo accounts:');
  for (const account of summary.accounts) {
    console.log(`    ${account.email}  /  ${account.password}`);
  }
  console.log('');

  await disconnectDatabase();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('[seed] failed:', error);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
