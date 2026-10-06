import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId") ?? undefined;

  const transactions = await db.centralLedger.findMany({
    where: taskId ? { taskId } : undefined,
    orderBy: { timestamp: "desc" },
    take: 200,
    include: { fromWallet: true, toWallet: true },
  });

  const paymentIntents = taskId ? await db.paymentIntent.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  }) : [];

  const blockchainTransactions = taskId && paymentIntents.length > 0 ? await db.blockchainTransaction.findMany({
    where: {
      paymentIntentId: {
        in: paymentIntents.map((pi) => pi.id),
      },
    },
  }) : [];

  const blockchainWorkflowEvents = taskId ? await db.blockchainWorkflowEvent.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
  }) : [];

  const algorandTransactions = taskId ? await db.algorandLedgerTransaction.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
    take: 50,
  }) : [];

  const securityEvents = taskId ? await db.securityEvent.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
    take: 50,
  }) : [];

  return NextResponse.json({
    transactions,
    paymentIntents,
    blockchainTransactions,
    blockchainWorkflowEvents,
    algorandTransactions,
    securityEvents,
  });
}
