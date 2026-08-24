import mongoose from 'mongoose';
import { env } from './env.js';

let memoryServer = null;

/**
 * Connects to MongoDB.
 *
 * Two modes:
 *  - USE_MEMORY_DB=false -> connects to MONGODB_URI (local mongod or Atlas).
 *  - USE_MEMORY_DB=true  -> boots an ephemeral in-process MongoDB so the project
 *                           runs with zero external installs. Data is lost on exit.
 */
export async function connectDatabase() {
  mongoose.set('strictQuery', true);

  let uri = env.MONGODB_URI;

  if (env.USE_MEMORY_DB) {
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri('food_ai');
      console.log('[db] in-memory MongoDB started (data is ephemeral)');
    } catch (error) {
      throw new Error(
        'USE_MEMORY_DB=true but `mongodb-memory-server` could not start. ' +
          'Run `npm install` inside /server, or set USE_MEMORY_DB=false and point ' +
          `MONGODB_URI at a real MongoDB. Original error: ${error.message}`
      );
    }
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: env.USE_MEMORY_DB ? 10000 : 8000,
    autoIndex: true,
  });

  const { host, name } = mongoose.connection;
  console.log(`[db] connected -> ${host}/${name}`);

  mongoose.connection.on('error', (error) => console.error('[db] connection error:', error.message));
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));

  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.connection.close();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

export const isMemoryDb = () => Boolean(memoryServer);
