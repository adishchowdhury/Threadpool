import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wallet = await prisma.wallet.findUnique({ where: { id } });
  if (!wallet) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ wallet });
}
