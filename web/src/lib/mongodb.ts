import { MongoClient, Db } from "mongodb";

let cachedMongoUri: string | null = null;

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

function getMongoUri(): string {
  if (cachedMongoUri) return cachedMongoUri;

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not defined in environment variables");
  }

  cachedMongoUri = mongoUri;
  return cachedMongoUri;
}

export async function getClient(): Promise<MongoClient> {
  if (cache.client) return cache.client;

  if (!cache.promise) {
    cache.promise = MongoClient.connect(getMongoUri());
  }

  cache.client = await cache.promise;
  return cache.client;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db("pt_app");
}
