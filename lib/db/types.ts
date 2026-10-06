// Enum string-literal unions for the string-enum fields in lib/db/models.ts.

export type WalletType = "MANAGER" | "AGENT" | "USER";
export type AgentStatus = "ACTIVE" | "INACTIVE" | "REVOKED";
export type AgentLifecycleStatus = "PENDING" | "CALIBRATING" | "ACTIVE" | "PAUSED" | "SUSPENDED" | "FAILED_CALIBRATION";
export type ProviderStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";
export type TaskStatus =
  | "CREATED"
  | "PLANNING"
  | "IN_PROGRESS"
  | "AWAITING_QA"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLING"
  | "CANCELLED";
export type SubtaskStatus =
  | "PENDING"
  | "BIDDING"
  | "ASSIGNED"
  | "EXECUTING"
  | "AWAITING_QA"
  | "DONE"
  | "FAILED";
export type EscrowStatus = "LOCKED" | "RELEASED" | "REFUNDED";
export type TxType = "LOCK" | "PAYOUT" | "REFUND" | "BLOCKED_ATTEMPT";
export type TxStatus = "APPROVED" | "BLOCKED";
export type CredentialStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "CONSUMED";
export type OrgRole = "OWNER" | "ADMIN" | "OPERATOR" | "VIEWER";

// The shape callers depend on for `db` and for the `tx` arg inside
// `db.$transaction(async (tx) => …)`. Both share one API;
// inside a transaction its delegates are bound to a Mongoose session.
export type { DbClient, DbClient as TransactionClient } from "@/lib/db/client";
