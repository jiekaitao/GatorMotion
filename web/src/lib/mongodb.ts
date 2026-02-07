import { MongoClient, Db } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI!;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not defined in environment variables");
}

interface MongoCache {
  client: MongoClient | null;
  promise: Promise<MongoClient> | null;
}

const globalWithMongo = globalThis as typeof globalThis & {
  _mongoCache: MongoCache;
};

if (!globalWithMongo._mongoCache) {
  globalWithMongo._mongoCache = { client: null, promise: null };
}

const cache = globalWithMongo._mongoCache;

export async function getClient(): Promise<MongoClient> {
  if (cache.client) return cache.client;

  if (!cache.promise) {
    cache.promise = MongoClient.connect(MONGODB_URI);
  }

  cache.client = await cache.promise;
  return cache.client;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db("pt_app");
}
