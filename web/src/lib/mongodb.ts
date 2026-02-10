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

function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !process.env.MONGODB_URI;
}

function getMongoUri(): string {
  if (cachedMongoUri) return cachedMongoUri;

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    if (isDemoMode()) {
      return "";
    }
    throw new Error("MONGODB_URI is not defined in environment variables");
  }

  cachedMongoUri = mongoUri;
  return cachedMongoUri;
}

export async function getClient(): Promise<MongoClient> {
  const uri = getMongoUri();
  if (!uri) {
    throw new Error("Cannot connect to MongoDB in demo mode");
  }

  if (cache.client) return cache.client;

  if (!cache.promise) {
    cache.promise = MongoClient.connect(uri);
  }

  cache.client = await cache.promise;
  return cache.client;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db("pt_app");
}
