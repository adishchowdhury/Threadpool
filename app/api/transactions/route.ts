import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId") ?? undefined;

  const transactions = await prisma.centralLedger.findMany({
    where: taskId ? { taskId } : undefined,
    orderBy: { timestamp: "desc" },
    take: 200,
    include: { fromWallet: true, toWallet: true },
  });

  return NextResponse.json({ transactions });
}
