import { NextResponse } from "next/server";
import { resetDatabase } from "@/lib/db/reset";

export async function POST() {
  await resetDatabase();
  return NextResponse.json({ ok: true });
}
