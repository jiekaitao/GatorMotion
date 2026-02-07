import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPatientsByTherapist } from "@/lib/db-helpers";

// GET: Therapist-only — returns linked patients with streak data
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "therapist") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const patients = await getPatientsByTherapist(session.userId);
  return NextResponse.json({ patients });
}
