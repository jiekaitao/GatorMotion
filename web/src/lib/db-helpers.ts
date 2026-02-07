import { getDb } from "./mongodb";
import { ObjectId } from "mongodb";
import crypto from "crypto";

// ── Users ──

export interface DbUser {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  role: "patient" | "therapist";
  therapistId?: string;
  createdAt: Date;
}

export async function createUser(data: {
  email: string;
  passwordHash: string;
  name: string;
  role: "patient" | "therapist";
}) {
  const db = await getDb();
  const result = await db.collection("users").insertOne({
    ...data,
    createdAt: new Date(),
  });
  return result.insertedId;
}

export async function findUserByEmail(email: string) {
  const db = await getDb();
  return db.collection<DbUser>("users").findOne({ email: email.toLowerCase() });
}

// ── Exercises ──

export interface DbExercise {
  _id: ObjectId;
  name: string;
  description: string;
  category: string;
  defaultSets: number;
  defaultReps: number;
  defaultHoldSec: number;
  imageUrl?: string;
  createdAt: Date;
}

export async function listExercises() {
  const db = await getDb();
  return db.collection<DbExercise>("exercises").find().sort({ name: 1 }).toArray();
}

export async function createExercise(data: Omit<DbExercise, "_id" | "createdAt">) {
  const db = await getDb();
  const result = await db.collection("exercises").insertOne({
    ...data,
    createdAt: new Date(),
  });
  return result.insertedId;
}

export async function getExercise(id: string) {
  const db = await getDb();
  return db.collection<DbExercise>("exercises").findOne({ _id: new ObjectId(id) });
}

export async function deleteExercise(id: string) {
  const db = await getDb();
  return db.collection("exercises").deleteOne({ _id: new ObjectId(id) });
}

// ── Assignments ──

export interface AssignmentExercise {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  holdSec: number;
  completed: boolean;
  completedAt?: Date;
}

export interface DbAssignment {
  _id: ObjectId;
  userId: string;
  date: string; // YYYY-MM-DD
  exercises: AssignmentExercise[];
  allCompleted: boolean;
  createdAt: Date;
}

export async function getAssignmentForDate(userId: string, date: string) {
  const db = await getDb();
  return db.collection<DbAssignment>("assignments").findOne({ userId, date });
}

export async function getTodayAssignment(userId: string) {
  const today = new Date().toISOString().split("T")[0];
  return getAssignmentForDate(userId, today);
}

export async function createAssignment(data: {
  userId: string;
  date: string;
  exercises: AssignmentExercise[];
}) {
  const db = await getDb();
  const result = await db.collection("assignments").insertOne({
    ...data,
    allCompleted: false,
    createdAt: new Date(),
  });
  return result.insertedId;
}

export async function completeExerciseInAssignment(
  assignmentId: string,
  exerciseId: string
) {
  const db = await getDb();
  const assignment = await db
    .collection<DbAssignment>("assignments")
    .findOne({ _id: new ObjectId(assignmentId) });

  if (!assignment) return null;

  const updatedExercises = assignment.exercises.map((ex) =>
    ex.exerciseId === exerciseId
      ? { ...ex, completed: true, completedAt: new Date() }
      : ex
  );

  const allCompleted = updatedExercises.every((ex) => ex.completed);

  await db.collection("assignments").updateOne(
    { _id: new ObjectId(assignmentId) },
    { $set: { exercises: updatedExercises, allCompleted } }
  );

  return { allCompleted, exercises: updatedExercises };
}

export async function getUserAssignments(userId: string) {
  const db = await getDb();
  return db
    .collection<DbAssignment>("assignments")
    .find({ userId })
    .sort({ date: -1 })
    .limit(30)
    .toArray();
}

// ── Streaks ──

export interface DbStreak {
  _id: ObjectId;
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate: string | null; // YYYY-MM-DD
  history: string[]; // Array of YYYY-MM-DD dates
}

export async function getStreak(userId: string) {
  const db = await getDb();
  let streak = await db.collection<DbStreak>("streaks").findOne({ userId });

  if (!streak) {
    await db.collection("streaks").insertOne({
      userId,
      currentStreak: 0,
      longestStreak: 0,
      lastCompletedDate: null,
      history: [],
    });
    streak = await db.collection<DbStreak>("streaks").findOne({ userId });
  }

  return streak!;
}

export async function incrementStreak(userId: string, date: string) {
  const db = await getDb();
  const streak = await getStreak(userId);

  // Already counted this day
  if (streak.history.includes(date)) {
    return streak;
  }

  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const isConsecutive = streak.lastCompletedDate === yesterdayStr;
  const isSameDay = streak.lastCompletedDate === date;

  let newCurrentStreak: number;
  if (isSameDay) {
    newCurrentStreak = streak.currentStreak;
  } else if (isConsecutive) {
    newCurrentStreak = streak.currentStreak + 1;
  } else {
    newCurrentStreak = 1;
  }

  const newLongest = Math.max(streak.longestStreak, newCurrentStreak);

  await db.collection("streaks").updateOne(
    { userId },
    {
      $set: {
        currentStreak: newCurrentStreak,
        longestStreak: newLongest,
        lastCompletedDate: date,
      },
      $addToSet: { history: date },
    }
  );

  return {
    ...streak,
    currentStreak: newCurrentStreak,
    longestStreak: newLongest,
    lastCompletedDate: date,
    history: [...streak.history, date],
  };
}

export async function setStreakManual(
  userId: string,
  currentStreak: number,
  history: string[]
) {
  const db = await getDb();
  const longestStreak = Math.max(currentStreak, history.length);
  const lastCompletedDate = history.length > 0 ? history[history.length - 1] : null;

  await db.collection("streaks").updateOne(
    { userId },
    {
      $set: {
        currentStreak,
        longestStreak,
        lastCompletedDate,
        history,
      },
    },
    { upsert: true }
  );
}

// ── Invites ──

export interface DbInvite {
  _id: ObjectId;
  therapistId: string;
  therapistName: string;
  patientEmail: string;
  token: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  createdAt: Date;
  expiresAt: Date;
}

export async function createInvite(data: {
  therapistId: string;
  therapistName: string;
  patientEmail: string;
}) {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 day expiry

  const result = await db.collection("invites").insertOne({
    ...data,
    patientEmail: data.patientEmail.toLowerCase(),
    token,
    status: "pending",
    createdAt: new Date(),
    expiresAt,
  });

  return { insertedId: result.insertedId, token };
}

export async function findInviteByToken(token: string) {
  const db = await getDb();
  return db.collection<DbInvite>("invites").findOne({ token });
}

export async function getInvitesByTherapist(therapistId: string) {
  const db = await getDb();
  return db
    .collection<DbInvite>("invites")
    .find({ therapistId })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function acceptInvite(token: string, patientId: string) {
  const db = await getDb();
  const invite = await findInviteByToken(token);
  if (!invite || invite.status !== "pending") return null;
  if (new Date() > invite.expiresAt) {
    await db.collection("invites").updateOne({ token }, { $set: { status: "expired" } });
    return null;
  }

  // Mark invite accepted
  await db.collection("invites").updateOne(
    { token },
    { $set: { status: "accepted" } }
  );

  // Link patient to therapist
  await db.collection("users").updateOne(
    { _id: new ObjectId(patientId) },
    { $set: { therapistId: invite.therapistId } }
  );

  return invite;
}

export async function revokeInvite(token: string, therapistId: string) {
  const db = await getDb();
  const result = await db.collection("invites").updateOne(
    { token, therapistId, status: "pending" },
    { $set: { status: "revoked" } }
  );
  return result.modifiedCount > 0;
}

export async function getPatientsByTherapist(therapistId: string) {
  const db = await getDb();
  const patients = await db
    .collection<DbUser>("users")
    .find({ therapistId, role: "patient" })
    .project({ passwordHash: 0 })
    .sort({ name: 1 })
    .toArray();

  // Fetch streak data for each patient
  const patientIds = patients.map((p) => p._id.toString());
  const streaks = await db
    .collection<DbStreak>("streaks")
    .find({ userId: { $in: patientIds } })
    .toArray();

  const streakMap = new Map(streaks.map((s) => [s.userId, s]));

  return patients.map((p) => ({
    ...p,
    streak: streakMap.get(p._id.toString()) || null,
  }));
}

// ── Messages ──

export interface DbMessage {
  _id: ObjectId;
  senderId: string;
  receiverId: string;
  content: string;
  read: boolean;
  createdAt: Date;
}

export async function sendMessage(data: {
  senderId: string;
  receiverId: string;
  content: string;
}) {
  const db = await getDb();
  const result = await db.collection("messages").insertOne({
    ...data,
    read: false,
    createdAt: new Date(),
  });
  return result.insertedId;
}

export async function getConversation(userId1: string, userId2: string, limit = 50) {
  const db = await getDb();
  return db
    .collection<DbMessage>("messages")
    .find({
      $or: [
        { senderId: userId1, receiverId: userId2 },
        { senderId: userId2, receiverId: userId1 },
      ],
    })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
}

export async function getConversationList(userId: string) {
  const db = await getDb();

  // Find all unique users this person has messaged with
  const sent = await db.collection<DbMessage>("messages").distinct("receiverId", { senderId: userId });
  const received = await db.collection<DbMessage>("messages").distinct("senderId", { receiverId: userId });

  const partnerIds = [...new Set([...sent, ...received])];

  // For each partner, get the last message and unread count
  const conversations = await Promise.all(
    partnerIds.map(async (partnerId) => {
      const lastMessage = await db
        .collection<DbMessage>("messages")
        .find({
          $or: [
            { senderId: userId, receiverId: partnerId },
            { senderId: partnerId, receiverId: userId },
          ],
        })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();

      const unread = await db.collection<DbMessage>("messages").countDocuments({
        senderId: partnerId,
        receiverId: userId,
        read: false,
      });

      // Get partner info
      const partner = await db
        .collection<DbUser>("users")
        .findOne({ _id: new ObjectId(partnerId) }, { projection: { passwordHash: 0 } });

      return {
        partnerId,
        partnerName: partner?.name || "Unknown",
        partnerRole: partner?.role || "patient",
        lastMessage: lastMessage[0] || null,
        unreadCount: unread,
      };
    })
  );

  // Sort by most recent message
  return conversations.sort((a, b) => {
    const aTime = a.lastMessage?.createdAt?.getTime() || 0;
    const bTime = b.lastMessage?.createdAt?.getTime() || 0;
    return bTime - aTime;
  });
}

export async function markMessagesRead(senderId: string, receiverId: string) {
  const db = await getDb();
  await db.collection("messages").updateMany(
    { senderId, receiverId, read: false },
    { $set: { read: true } }
  );
}

// ── User Profile Updates ──

export async function updateUserProfile(userId: string, data: { name?: string; email?: string }) {
  const db = await getDb();
  const update: Record<string, string> = {};
  if (data.name) update.name = data.name;
  if (data.email) update.email = data.email.toLowerCase();

  if (Object.keys(update).length === 0) return false;

  const result = await db.collection("users").updateOne(
    { _id: new ObjectId(userId) },
    { $set: update }
  );
  return result.modifiedCount > 0;
}

export async function updateUserPassword(userId: string, newPasswordHash: string) {
  const db = await getDb();
  const result = await db.collection("users").updateOne(
    { _id: new ObjectId(userId) },
    { $set: { passwordHash: newPasswordHash } }
  );
  return result.modifiedCount > 0;
}

export async function findUserById(userId: string) {
  const db = await getDb();
  return db.collection<DbUser>("users").findOne({ _id: new ObjectId(userId) });
}
