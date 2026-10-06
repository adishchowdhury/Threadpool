import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wallet = await db.wallet.findUnique({ where: { id } });
  if (!wallet) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ wallet });
}
