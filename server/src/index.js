import { createApp } from './app.js';
import { assertConfig, env, isLlmAvailable } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { Restaurant } from './models/index.js';
import { seedDatabase } from './scripts/seedData.js';
import { backfillFoodImages } from './services/images/backfill.js';

/**
 * Binds the port, retrying briefly if it is still held.
 *
 * `npm run dev` runs under `node --watch`, which starts a replacement process
 * before the outgoing one has fully released the socket. Failing hard on the
 * first EADDRINUSE left the watcher permanently wedged ("Waiting for file
 * changes before restarting…") with no API running — which looked exactly like
 * the app being broken. A few short retries make a restart race self-heal.
 */
function listenWithRetry(app, port, { attempts = 6, delayMs = 400 } = {}) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryListen = () => {
      attempt += 1;
      const server = app.listen(port);

      const onError = (error) => {
        server.removeListener('listening', onListening);

        if (error.code === 'EADDRINUSE' && attempt < attempts) {
          console.warn(`[boot] port ${port} busy — retrying (${attempt}/${attempts - 1})…`);
          setTimeout(tryListen, delayMs);
          return;
        }

        if (error.code === 'EADDRINUSE') {
          reject(
            new Error(
              `port ${port} is already in use.\n` +
                '       Another copy of the API is still running. Stop it, or set PORT in server/.env.'
            )
          );
          return;
        }
        reject(error);
      };

      const onListening = () => {
        server.removeListener('error', onError);
        // From here on, a socket error must not be mistaken for a bind failure.
        server.on('error', (error) => console.error('[server] error:', error.message));
        resolve(server);
      };

      server.once('error', onError);
      server.once('listening', onListening);
    };

    tryListen();
  });
}

async function start() {
  assertConfig();
  await connectDatabase();

  // The zero-install demo database is empty on every boot — seed it so the app
  // is usable immediately. A real database is never auto-seeded.
  if (env.USE_MEMORY_DB && (await Restaurant.estimatedDocumentCount()) === 0) {
    console.log('[boot] seeding the in-memory demo database…');
    await seedDatabase({ quiet: true });
  }

  const app = createApp();
  const server = await listenWithRetry(app, env.PORT);

  console.log('');
  console.log(`  Food AI API   http://localhost:${env.PORT}`);
  console.log(`  Health        http://localhost:${env.PORT}/api/health`);
  console.log(`  Environment   ${env.NODE_ENV}`);
  console.log(`  AI            ${isLlmAvailable() ? `${env.AI_MODEL} (live)` : 'rule-based fallback (no ANTHROPIC_API_KEY set)'}`);
  console.log(`  Crowd engine  ${env.ML_CROWD_SERVICE_URL ? 'ML service + rule fallback' : 'rule-based'}`);
  console.log('');

  // Dish photos are resolved at seed time, but that lookup can fail (and did —
  // it is why every dish fell back to an emoji tile). Retry the stragglers in
  // the background so the API is serving immediately either way.
  backfillFoodImages().catch(() => {});

  /**
   * Shutdown has to release the port *fast*, because a replacement process is
   * usually already starting. `server.close()` on its own waits for idle
   * keep-alive sockets, which held the port open for seconds.
   */
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[boot] ${signal} received — shutting down`);

    server.close(() => {});
    // Node 18.2+. Without this, idle browser keep-alive connections hold the port.
    server.closeAllConnections?.();

    try {
      await disconnectDatabase();
    } catch {
      /* already closing — nothing useful to do */
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('[boot] failed to start:', error.message);
  process.exit(1);
});
