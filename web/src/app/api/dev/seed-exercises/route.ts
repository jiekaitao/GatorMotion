import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

const SEED_EXERCISES = [
  {
    name: "Shoulder Raise",
    description: "Raise your arm out to the side, keeping it straight.",
    category: "upper body",
    defaultSets: 3,
    defaultReps: 10,
    defaultHoldSec: 0,
    exerciseKey: "arm_abduction",
    skeletonDataFile: "ex1_reference.json",
  },
  {
    name: "Arm VW Raise",
    description: "Raise both arms in a V-W pattern above your head.",
    category: "upper body",
    defaultSets: 3,
    defaultReps: 10,
    defaultHoldSec: 0,
    exerciseKey: "arm_vw",
    skeletonDataFile: "ex2_reference.json",
  },
  {
    name: "Squat",
    description: "Stand with feet shoulder-width apart. Lower your body by bending your knees.",
    category: "lower body",
    defaultSets: 3,
    defaultReps: 10,
    defaultHoldSec: 0,
    exerciseKey: "squat",
    skeletonDataFile: "ex6_reference.json",
  },
  {
    name: "Leg Abduction",
    description: "Stand on one leg and raise the other leg out to the side.",
    category: "lower body",
    defaultSets: 3,
    defaultReps: 10,
    defaultHoldSec: 0,
    exerciseKey: "leg_abduction",
    skeletonDataFile: "ex4_reference.json",
  },
];

export async function POST() {
  const db = await getDb();

  // Clear existing exercises
  await db.collection("exercises").deleteMany({});

  // Insert seed exercises
  const result = await db.collection("exercises").insertMany(
    SEED_EXERCISES.map((ex) => ({ ...ex, createdAt: new Date() }))
  );

  return NextResponse.json({
    success: true,
    inserted: result.insertedCount,
    exercises: SEED_EXERCISES.map((ex) => ex.name),
  });
}
