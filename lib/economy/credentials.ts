// Scoped authorization credentials - a SECOND, INDEPENDENT gate alongside
// the Circuit Breaker (lib/economy/circuitBreaker.ts). It never replaces the
// amount/status/escrow checks there: a transaction must clear BOTH to
// proceed. A credential adds what the breaker doesn't model - a specific
// task/subtask/agent triple, a bounded set of allowed operations, a spend
// ceiling independent of the escrow amount, and an expiration.
//
// Like the breaker, this only reads/writes numbers and enums already
// persisted in the DB - never anything derived live from an LLM response.

import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import type { DbClient } from "@/lib/db/client";

export const CREDENTIAL_OPERATIONS = ["LOCK_ESCROW", "RELEASE_ESCROW"] as const;
export type CredentialOperation = (typeof CREDENTIAL_OPERATIONS)[number];

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour - comfortably longer than any demo task run

export interface IssuedCredential {
  id: string;
  taskId: string;
  subtaskId: string | null;
  agentId: string;
  maxSpend: number;
  expiresAt: Date;
}

// Issues a task/subtask-scoped credential for an agent right after it is
// selected (orchestrator.ts's assign()), before any escrow lock. Logs both a
// generic Event and a SecurityEvent so issuance is part of the audit trail
// (§5) regardless of what happens to the credential afterwards.
export async function issueCredential(params: {
  taskId: string;
  subtaskId?: string | null;
  agentId: string;
  allowedOperations: readonly CredentialOperation[];
  maxSpend: number;
  ttlMs?: number;
}): Promise<IssuedCredential> {
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? DEFAULT_TTL_MS));
  const row = await db.authorizationCredential.create({
    data: {
      taskId: params.taskId,
      subtaskId: params.subtaskId ?? null,
      agentId: params.agentId,
      allowedOperations: JSON.stringify(params.allowedOperations),
      maxSpend: params.maxSpend,
      spent: 0,
      status: "ACTIVE",
      expiresAt,
    },
  });

  await db.securityEvent.create({
    data: {
      taskId: params.taskId,
      agentId: params.agentId,
      type: "PERMISSION_ISSUED",
      reason: "credential issued for selected agent",
      payload: JSON.stringify({ credentialId: row.id, allowedOperations: params.allowedOperations, maxSpend: params.maxSpend, expiresAt }),
    },
  });
  await emitEvent(db, {
    taskId: params.taskId,
    actor: "manager",
    eventType: "PERMISSION_ISSUED",
    payload: { credentialId: row.id, agentId: params.agentId, maxSpend: params.maxSpend, allowedOperations: params.allowedOperations },
  });

  return { id: row.id, taskId: row.taskId, subtaskId: row.subtaskId, agentId: row.agentId, maxSpend: row.maxSpend, expiresAt: row.expiresAt };
}

export type CredentialDecision = { allowed: true; credentialId: string } | { allowed: false; reason: string };

export interface CredentialSnapshot {
  id: string;
  taskId: string;
  agentId: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "CONSUMED";
  allowedOperations: string; // JSON-encoded string[]
  spent: number;
  maxSpend: number;
  expiresAt: Date | string;
}

// Pure, deterministic evaluation - no DB, no I/O - mirroring the style of
// circuitBreaker.ts's evaluateTransaction. Takes an explicit `now` so
// expiry is testable without faking the clock. Lazy expiry is modeled by
// returning the EXPIRED reason instead of mutating - the caller
// (enforceCredential) persists that transition.
export function evaluateCredential(
  credential: CredentialSnapshot | null,
  params: { operation: CredentialOperation; amount: number },
  now: number = Date.now(),
): { decision: "ALLOW" } | { decision: "DENY"; reason: string; expired?: boolean } {
  if (!credential) return { decision: "DENY", reason: "credential not found" };

  const isExpired = credential.status === "ACTIVE" && new Date(credential.expiresAt).getTime() < now;
  const effectiveStatus = isExpired ? "EXPIRED" : credential.status;
  if (effectiveStatus !== "ACTIVE") {
    return { decision: "DENY", reason: `credential is ${effectiveStatus.toLowerCase()}`, expired: isExpired };
  }

  const allowedOperations: string[] = JSON.parse(credential.allowedOperations);
  if (!allowedOperations.includes(params.operation)) {
    return { decision: "DENY", reason: `operation '${params.operation}' not permitted by this credential` };
  }

  if (credential.spent + params.amount > credential.maxSpend) {
    return {
      decision: "DENY",
      reason: `amount exceeds credential ceiling (spent ${credential.spent} + requested ${params.amount} > max ${credential.maxSpend})`,
    };
  }

  return { decision: "ALLOW" };
}

// DB-touching wrapper: loads the credential, persists lazy expiry, calls the
// pure evaluator above, and ALWAYS records a SecurityEvent - a permission
// check that silently succeeds leaves no trail, which defeats §5.
export async function enforceCredential(
  dbClient: DbClient,
  params: { credentialId: string; operation: CredentialOperation; amount: number },
): Promise<CredentialDecision> {
  const credential = await dbClient.authorizationCredential.findUnique({ where: { id: params.credentialId } });
  const evaluation = evaluateCredential(credential as CredentialSnapshot | null, params);

  if (evaluation.decision === "DENY") {
    if (credential && evaluation.expired) {
      await dbClient.authorizationCredential.update({ where: { id: credential.id }, data: { status: "EXPIRED" } });
    }
    return denyAndLog(dbClient, credential, params, evaluation.reason);
  }

  await dbClient.securityEvent.create({
    data: {
      taskId: credential.taskId,
      agentId: credential.agentId,
      type: "PERMISSION_CHECKED",
      reason: "credential check passed",
      payload: JSON.stringify({ credentialId: credential.id, operation: params.operation, amount: params.amount }),
    },
  });

  return { allowed: true, credentialId: credential.id };
}

async function denyAndLog(
  dbClient: DbClient,
  credential: { id: string; taskId: string; agentId: string } | null,
  params: { credentialId: string; operation: CredentialOperation; amount: number },
  reason: string,
): Promise<CredentialDecision> {
  await dbClient.securityEvent.create({
    data: {
      taskId: credential?.taskId ?? null,
      agentId: credential?.agentId ?? null,
      type: "PERMISSION_DENIED",
      reason,
      payload: JSON.stringify({ credentialId: params.credentialId, operation: params.operation, amount: params.amount }),
      severity: "HIGH",
      requestedAmount: params.amount,
    },
  });
  if (credential) {
    await emitEvent(dbClient, {
      taskId: credential.taskId,
      actor: "circuit_breaker",
      eventType: "PERMISSION_DENIED",
      payload: { credentialId: params.credentialId, agentId: credential.agentId, operation: params.operation, amount: params.amount, reason },
    });
  }
  return { allowed: false, reason };
}

// Atomic claim of spend against the credential - same compare-and-set
// pattern already used for escrow release/refund (lib/economy/escrow.ts).
// Must be called AFTER the underlying financial mutation is known to have
// succeeded, inside the same transaction.
export async function markCredentialSpent(dbClient: DbClient, credentialId: string, amount: number): Promise<void> {
  await dbClient.authorizationCredential.update({
    where: { id: credentialId },
    data: { spent: { increment: amount } },
  });
}

export async function revokeCredential(credentialId: string, reason: string): Promise<void> {
  const credential = await db.authorizationCredential.findUnique({ where: { id: credentialId } });
  if (!credential || credential.status !== "ACTIVE") return;
  await db.authorizationCredential.update({ where: { id: credentialId }, data: { status: "REVOKED", revokedReason: reason } });
  await db.securityEvent.create({
    data: {
      taskId: credential.taskId,
      agentId: credential.agentId,
      type: "PERMISSION_REVOKED",
      reason,
      payload: JSON.stringify({ credentialId }),
    },
  });
  await emitEvent(db, {
    taskId: credential.taskId,
    actor: "system",
    eventType: "PERMISSION_REVOKED",
    payload: { credentialId, agentId: credential.agentId, reason },
  });
}
