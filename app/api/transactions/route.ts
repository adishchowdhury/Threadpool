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

  const paymentIntents = taskId ? await prisma.paymentIntent.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  }) : [];

  const blockchainTransactions = taskId && paymentIntents.length > 0 ? await prisma.blockchainTransaction.findMany({
    where: {
      paymentIntentId: {
        in: paymentIntents.map((pi) => pi.id),
      },
    },
  }) : [];

  const blockchainWorkflowEvents = taskId ? await prisma.blockchainWorkflowEvent.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
  }) : [];

  return NextResponse.json({
    transactions,
    paymentIntents,
    blockchainTransactions,
    blockchainWorkflowEvents,
  });
}
