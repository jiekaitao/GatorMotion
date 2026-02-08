import { getDb } from "./mongodb";

const DAILY_LIMIT = 50;

export interface TtsUsageDoc {
  userId: string;
  characters: number;
  createdAt: Date;
}

export async function checkTtsRateLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const db = await getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todayCount = await db.collection<TtsUsageDoc>("tts_usage").countDocuments({
    userId,
    createdAt: { $gte: startOfDay },
  });

  return {
    allowed: todayCount < DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - todayCount),
  };
}

export async function logTtsUsage(userId: string, characters: number): Promise<void> {
  const db = await getDb();
  await db.collection("tts_usage").insertOne({
    userId,
    characters,
    createdAt: new Date(),
  });
}

export async function getTtsUsageStats(userId: string) {
  const db = await getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [todayAgg, totalAgg] = await Promise.all([
    db.collection<TtsUsageDoc>("tts_usage").aggregate([
      { $match: { userId, createdAt: { $gte: startOfDay } } },
      { $group: { _id: null, count: { $sum: 1 }, characters: { $sum: "$characters" } } },
    ]).toArray(),
    db.collection<TtsUsageDoc>("tts_usage").aggregate([
      { $match: { userId } },
      { $group: { _id: null, count: { $sum: 1 }, characters: { $sum: "$characters" } } },
    ]).toArray(),
  ]);

  return {
    todayCount: todayAgg[0]?.count ?? 0,
    todayCharacters: todayAgg[0]?.characters ?? 0,
    totalCount: totalAgg[0]?.count ?? 0,
    totalCharacters: totalAgg[0]?.characters ?? 0,
    dailyLimit: DAILY_LIMIT,
  };
}
