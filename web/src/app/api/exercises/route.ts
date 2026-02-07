import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listExercises, createExercise, deleteExercise } from "@/lib/db-helpers";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const exercises = await listExercises();
  return NextResponse.json({ exercises });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { name, description, category, defaultSets, defaultReps, defaultHoldSec, imageUrl } = body;

  if (!name) {
    return NextResponse.json({ error: "Exercise name is required" }, { status: 400 });
  }

  const id = await createExercise({
    name,
    description: description || "",
    category: category || "general",
    defaultSets: defaultSets || 3,
    defaultReps: defaultReps || 10,
    defaultHoldSec: defaultHoldSec || 0,
    imageUrl: imageUrl || undefined,
  });

  return NextResponse.json({ success: true, id: id.toString() });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Exercise ID is required" }, { status: 400 });
  }

  await deleteExercise(id);
  return NextResponse.json({ success: true });
}
