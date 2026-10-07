import { createId } from "@paralleldrive/cuid2";
import { mongoose } from "@/lib/db/mongoose";
import { Schema, type Model } from "mongoose";

// ─────────────────────────────────────────────────────────────────────────
// Mongoose models for Kraven.
//
// Every document uses a string `_id` (cuid) to preserve the id semantics the
// rest of the codebase relies on (fixed ids like "wallet-manager",
// "demo-user", seeded agent ids, and cuid task/subtask ids). The
// compatible facade in lib/db.ts maps `id` <-> `_id` at its boundary, so
// application code keeps using `.id`.
// ─────────────────────────────────────────────────────────────────────────

const idField = { type: String, default: () => createId() };

function model(name: string, schema: Schema<any>): Model<any> {
  const existing = mongoose.models[name] as unknown as Model<any> | undefined;
  if (existing) {
    // Dev hot-reload keeps the first-compiled model alive, and Mongoose's
    // strict mode silently drops any field added since (e.g. a task's
    // dataSensitivity would never be saved). Recompile when the schema grew.
    const same = Object.keys(schema.paths).every((p) => p in existing.schema.paths);
    if (same) return existing;
    mongoose.deleteModel(name);
  }
  return mongoose.model<any>(name, schema) as Model<any>;
}

const WALLET_TYPES = ["MANAGER", "AGENT", "USER"] as const;
const AGENT_STATUSES = ["ACTIVE", "INACTIVE", "REVOKED"] as const;
const AGENT_LIFECYCLE_STATUSES = ["PENDING", "CALIBRATING", "ACTIVE", "PAUSED", "SUSPENDED", "FAILED_CALIBRATION"] as const;
const PROVIDER_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"] as const;
const TASK_STATUSES = [
  "CREATED",
  "PLANNING",
  "IN_PROGRESS",
  "AWAITING_QA",
  "COMPLETED",
  // A deliverable was produced but one or more subtasks exhausted retries and
  // reassignment with no replacement agent available - the gap is disclosed
  // in the report rather than discarding everything that DID succeed.
  "PARTIAL",
  "FAILED",
  "CANCELLING",
  "CANCELLED",
] as const;
const SUBTASK_STATUSES = [
  "PENDING",
  "BIDDING",
  "ASSIGNED",
  "EXECUTING",
  "AWAITING_QA",
  "DONE",
  "FAILED",
] as const;
const ESCROW_STATUSES = ["LOCKED", "RELEASED", "REFUNDED"] as const;
const TX_TYPES = ["LOCK", "PAYOUT", "REFUND", "BLOCKED_ATTEMPT"] as const;
const TX_STATUSES = ["APPROVED", "BLOCKED"] as const;
const CREDENTIAL_STATUSES = ["ACTIVE", "EXPIRED", "REVOKED", "CONSUMED"] as const;
const ORG_ROLES = ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const;

// ── USERS ──────────────────────────────────────────────────────────────
const userSchema = new Schema<any>(
  {
    _id: idField,
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

// ── WALLETS ────────────────────────────────────────────────────────────
const walletSchema = new Schema<any>(
  {
    _id: idField,
    type: { type: String, enum: WALLET_TYPES, required: true },
    agentId: { type: String, default: null },
    balance: { type: Number, default: 0 },
    algorandAddress: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);
// Partial (not sparse) so multiple wallets can carry agentId: null - sparse
// indexes still collide on an explicit null, only a partialFilterExpression gives "unique when set" semantics.
walletSchema.index(
  { agentId: 1 },
  { unique: true, partialFilterExpression: { agentId: { $type: "string" } } },
);

// ── AGENTS ─────────────────────────────────────────────────────────────
const agentSchema = new Schema<any>(
  {
    _id: idField,
    name: { type: String, required: true },
    capabilities: { type: String, required: true }, // JSON-encoded string[]
    // 0 = not priced yet: price is derived from measured token usage during
    // calibration (lib/agents/pricing.ts), and unpriced agents cannot be hired.
    price: { type: Number, default: 0 },
    endpoint: { type: String, default: null },
    status: { type: String, enum: AGENT_STATUSES, default: "ACTIVE" },
    isSeeded: { type: Boolean, default: true },
    provider: { type: String, default: "local" },
    model: { type: String, default: null },
    // false = internal identity that never appears in the registry (e.g. the
    // Circuit Breaker demo fixture).
    listed: { type: Boolean, default: true },
    role: { type: String, default: null },
    systemPrompt: { type: String, default: null },
    totalJobs: { type: Number, default: 0 },
    // Measured samples (benchmark calibration + real jobs) behind the stats
    // below. 0 means the agent is unrated: its stat fields carry no signal.
    sampleCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    successRate: { type: Number, default: 0 },
    avgQuality: { type: Number, default: 0 },
    avgLatencyMs: { type: Number, default: 0 },
    avgCost: { type: Number, default: 0 },
    reputation: { type: Number, default: 50 },
    // ── External agent marketplace fields (unused/default for built-ins) ──
    isExternal: { type: Boolean, default: false },
    providerId: { type: String, default: null },
    // AES-256-GCM ciphertext of the provider-supplied outbound auth token
    // Kraven sends TO the external endpoint. Never returned to any client.
    externalAuthSecretEncrypted: { type: String, default: null },
    // Separate from `status` (the routing gate, unchanged semantics): this
    // tracks WHERE an external agent is in onboarding. Transitions here
    // drive `status`, never the reverse.
    lifecycleStatus: { type: String, enum: AGENT_LIFECYCLE_STATUSES, default: null },
    // ── Governance (§7 polish) ──────────────────────────────────────────
    // Rolling failure counter since the last success - reset on any success.
    // Reaching the threshold auto-demotes ACTIVE -> INACTIVE (reversible),
    // distinct from the permanent severe-violation REVOKE in circuitBreaker.ts.
    consecutiveFailures: { type: Number, default: 0 },
    // When the agent was last auto-demoted; drives cooldown reinstatement
    // (lib/economy/reputation.ts reinstateForCapability).
    demotedAt: { type: Date, default: null },
    lastHealthCheckAt: { type: Date, default: null },
    lastHealthStatus: { type: String, default: null },
    // Tenancy class (lib/discovery/access.ts): CERTIFIED | PRIVATE | MARKETPLACE.
    // null = legacy row: built-ins resolve to CERTIFIED, external to PRIVATE.
    // Bumped whenever the endpoint changes: earlier benchmarks no longer describe
    // what is being called, so the agent must be re-benchmarked.
    version: { type: Number, default: 1 },
    // What the owner WANTS: MARKETPLACE only takes effect (visibility flips)
    // once Kraven's benchmark has activated the agent. Survives re-benchmarking.
    visibilityPreference: { type: String, enum: ["PRIVATE", "MARKETPLACE"], default: "PRIVATE" },
    visibility: { type: String, enum: ["CERTIFIED", "PRIVATE", "MARKETPLACE"], default: null },
  },
  { timestamps: true, versionKey: false },
);

// ── AGENT PROVIDERS ────────────────────────────────────────────────────
// A provider/org is owned by exactly one logged-in user (their Firebase uid,
// or DEMO_USER_ID in local demo mode with no Firebase configured) - this is
// the "Organization mode" a user switches into, not a separately-keyed
// account. One org per user for the MVP (lib/auth/session.ts resolves the
// owner; ownership of each agent is still checked against providerId).
const agentProviderSchema = new Schema<any>(
  {
    _id: idField,
    name: { type: String, required: true },
    description: { type: String, default: null },
    contactEmail: { type: String, default: null },
    ownerUserId: { type: String, required: true, unique: true },
    status: { type: String, enum: PROVIDER_STATUSES, default: "ACTIVE" },
  },
  { timestamps: true, versionKey: false },
);

// ── ORGANIZATION MEMBERSHIP (multi-tenancy §6) ────────────────────────
// An AgentProvider row doubles as the tenant/"organization" record (it was
// already a 1-user-owned org with its own status) - this table is what
// turns that into real multi-user RBAC instead of a parallel Organization
// model duplicating the same concept.
const organizationMemberSchema = new Schema<any>(
  {
    _id: idField,
    organizationId: { type: String, required: true }, // == AgentProvider._id
    userId: { type: String, required: true },
    role: { type: String, enum: ORG_ROLES, required: true, default: "VIEWER" },
  },
  { timestamps: true, versionKey: false },
);
organizationMemberSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

// ── AUTHORIZATION CREDENTIALS (scoped permissions §4) ─────────────────
// A credential is a second, independent gate alongside the Circuit Breaker
// (lib/economy/circuitBreaker.ts): it never replaces the amount/status/
// escrow checks there, it adds a task/subtask-scoped, time-bounded,
// operation-scoped ceiling that is checked separately.
const authorizationCredentialSchema = new Schema<any>(
  {
    _id: idField,
    taskId: { type: String, required: true },
    subtaskId: { type: String, default: null },
    agentId: { type: String, required: true },
    allowedOperations: { type: String, required: true }, // JSON-encoded string[]
    maxSpend: { type: Number, required: true },
    spent: { type: Number, default: 0 },
    status: { type: String, enum: CREDENTIAL_STATUSES, default: "ACTIVE" },
    expiresAt: { type: Date, required: true },
    revokedReason: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);
authorizationCredentialSchema.index({ taskId: 1, agentId: 1 });

// ── AGENT CAPABILITY STATS ─────────────────────────────────────────────
// Per-(agent, capability) measured stats - a strict superset of the
// agent-level aggregate on `Agent` (lib/agents/stats.ts writes both from the
// same underlying samples). An agent can be excellent at one capability and
// mediocre at another; routing should see that, not one blended number.
const agentCapabilityStatSchema = new Schema<any>(
  {
    _id: idField,
    agentId: { type: String, required: true },
    capability: { type: String, required: true },
    sampleCount: { type: Number, default: 0 },
    successRate: { type: Number, default: 0 },
    avgQuality: { type: Number, default: 0 },
    avgLatencyMs: { type: Number, default: 0 },
    avgCost: { type: Number, default: 0 },
    reputation: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);
agentCapabilityStatSchema.index({ agentId: 1, capability: 1 }, { unique: true });

// ── TASKS ──────────────────────────────────────────────────────────────
const taskSchema = new Schema<any>(
  {
    _id: idField,
    prompt: { type: String, required: true },
    budget: { type: Number, required: true },
    remainingBudget: { type: Number, required: true },
    qualityThreshold: { type: Number, default: 70 },
    deadline: { type: Date, default: null },
    status: { type: String, enum: TASK_STATUSES, default: "CREATED" },
    managerId: { type: String, default: "manager-agent" },
    finalOutput: { type: String, default: null },
    userId: { type: String, default: "demo-user" },
    // Tenancy boundary (§6) - the AgentProvider id acting as this task's
    // organization. Nullable so pre-existing tasks and the bare demo-user
    // fallback (Firebase unconfigured) keep working unscoped.
    organizationId: { type: String, default: null },
    pinned: { type: Boolean, default: false },
    // Which agents may receive this task's data (lib/discovery/access.ts).
    dataSensitivity: { type: String, enum: ["PUBLIC", "INTERNAL", "SENSITIVE"], default: "PUBLIC" },
    // JSON TaskContract (lib/manager/contract.ts): fixed after planning,
    // evaluated deterministically at completion.
    contract: { type: String, default: null },
    // JSON string[]: agents the user explicitly allowed to receive this task's data.
    approvedAgentIds: { type: String, default: "[]" },
    domain: { type: String, default: "general" },
    // Durable execution (lib/manager/taskRunner.ts): a task runs as a chain
    // of bounded segments, one serverless invocation each. `leaseUntil` makes
    // sure only one segment runs at a time; `segment` counts them.
    leaseUntil: { type: Date, default: null },
    segment: { type: Number, default: 0 },
    // JSON ReworkOutcome of the final review, kept here so a later segment
    // can assemble the report.
    reviewOutcome: { type: String, default: null },
    // JSON ReworkProgress (lib/manager/rework.ts) while a rework round is
    // spread over several segments.
    reworkProgress: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);
taskSchema.index({ userId: 1 });
taskSchema.index({ organizationId: 1 });

// ── SUBTASKS ───────────────────────────────────────────────────────────
const subtaskSchema = new Schema<any>(
  {
    _id: idField,
    taskId: { type: String, required: true },
    type: { type: String, required: true },
    requiredCapability: { type: String, required: true },
    // The planner's concrete instruction for the worker (type is only a slug).
    description: { type: String, default: null },
    status: { type: String, enum: SUBTASK_STATUSES, default: "PENDING" },
    sequence: { type: Number, default: 0 },
    dependsOn: { type: String, default: "[]" },
    assignedAgentId: { type: String, default: null },
    attemptCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 2 },
    output: { type: String, default: null },
    qaScore: { type: Number, default: null },
    qaReason: { type: String, default: null },
    // Why the step was skipped (no agent, exhausted retries, out of time) -
    // disclosed in the final report.
    skipReason: { type: String, default: null },
    // SkipKind (lib/manager/incompleteSteps.ts) - drives the plain-language wording.
    skipKind: { type: String, default: null },
    // JSON SubtaskArtifacts (lib/capabilities/types.ts): retrieved sources,
    // structured comparables, datasets, computed results, review verdict,
    // tool calls. What downstream workers and QA consume besides `output`.
    artifacts: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);
subtaskSchema.index({ taskId: 1, sequence: 1 });

// ── BIDS ───────────────────────────────────────────────────────────────
const bidSchema = new Schema<any>(
  {
    _id: idField,
    subtaskId: { type: String, required: true },
    agentId: { type: String, required: true },
    amount: { type: Number, required: true },
    proposal: { type: String, required: true },
  },
  {
    timestamps: { createdAt: "submittedAt", updatedAt: false },
    versionKey: false,
  },
);

// ── ECONOMY ────────────────────────────────────────────────────────────
const centralEscrowSchema = new Schema<any>(
  {
    _id: idField,
    taskId: { type: String, required: true, unique: true },
    totalLocked: { type: Number, default: 0 },
    totalReleased: { type: Number, default: 0 },
    totalRefunded: { type: Number, default: 0 },
    status: { type: String, default: "ACTIVE" },
  },
  { timestamps: true, versionKey: false },
);

const agentEscrowSchema = new Schema<any>(
  {
    _id: idField,
    taskId: { type: String, required: true },
    subtaskId: { type: String, required: true },
    agentId: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ESCROW_STATUSES, default: "LOCKED" },
    // Links this escrow to the scoped credential that authorized it (§4).
    // Null for callers that don't issue one (e.g. existing tests, the x402
    // flow) - enforcement simply skips the credential gate when absent.
    credentialId: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);
agentEscrowSchema.index({ taskId: 1, status: 1 });

const centralLedgerSchema = new Schema<any>(
  {
    _id: idField,
    taskId: { type: String, required: true },
    agentEscrowId: { type: String, default: null },
    fromWalletId: { type: String, required: true },
    toWalletId: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "VIRTUAL_TOKEN" },
    purpose: { type: String, required: true },
    type: { type: String, enum: TX_TYPES, required: true },
    status: { type: String, enum: TX_STATUSES, required: true },
    reason: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "timestamp", updatedAt: false },
    versionKey: false,
  },
);

const agentLedgerSchema = new Schema<any>(
  {
    _id: idField,
    agentId: { type: String, required: true },
    taskId: { type: String, required: true },
    subtaskId: { type: String, default: null },
    agentEscrowId: { type: String, default: null },
    centralLedgerId: { type: String, default: null },
    direction: { type: String, required: true },
    amount: { type: Number, required: true },
    purpose: { type: String, required: true },
    type: { type: String, enum: TX_TYPES, required: true },
    status: { type: String, enum: TX_STATUSES, required: true },
    reason: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "timestamp", updatedAt: false },
    versionKey: false,
  },
);

// ── PERFORMANCE / MEMORY ───────────────────────────────────────────────
const agentPerformanceSchema = new Schema<any>(
  {
    _id: idField,
    agentId: { type: String, required: true },
    taskId: { type: String, required: true },
    subtaskId: { type: String, required: true },
    taskType: { type: String, required: true },
    capabilities: { type: String, required: true },
    expectedCost: { type: Number, required: true },
    actualCost: { type: Number, required: true },
    expectedLatencyMs: { type: Number, required: true },
    actualLatencyMs: { type: Number, required: true },
    qaScore: { type: Number, required: true },
    success: { type: Boolean, required: true },
    domain: { type: String, default: "general" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// Benchmark runs of an agent against a fixed, capability-specific task,
// scored by the independent QA reviewer. Kept in its own collection so a
// demo reset (which wipes jobs) does not throw away measured agent quality.
const agentCalibrationSchema = new Schema<any>(
  {
    _id: idField,
    agentId: { type: String, required: true },
    capability: { type: String, required: true },
    model: { type: String, required: true },
    latencyMs: { type: Number, required: true },
    // Measured Sarvam token usage of the worker call - the basis for pricing.
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    qaScore: { type: Number, required: true },
    passed: { type: Boolean, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
agentCalibrationSchema.index({ agentId: 1, capability: 1 });

// User ratings are their own source of truth: they never feed benchmark
// numbers. One rating per (agent, task); only orgs that actually used the
// agent on that task can rate it (enforced in the route).
const agentRatingSchema = new Schema<any>(
  {
    _id: idField,
    agentId: { type: String, required: true },
    taskId: { type: String, required: true },
    organizationId: { type: String, required: true },
    rating: { type: Number, required: true },
    comment: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
agentRatingSchema.index({ agentId: 1, taskId: 1 }, { unique: true });

const workflowMemorySchema = new Schema<any>(
  {
    _id: idField,
    taskType: { type: String, required: true },
    taskFeatures: { type: String, required: true },
    subtasks: { type: String, required: true },
    agentsUsed: { type: String, required: true },
    sequence: { type: String, required: true },
    dependencies: { type: String, required: true },
    cost: { type: Number, required: true },
    latencyMs: { type: Number, required: true },
    quality: { type: Number, required: true },
    success: { type: Boolean, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// ── EVENTS / SECURITY / PAYMENTS ───────────────────────────────────────
const eventSchema = new Schema<any>(
  {
    _id: idField,
    taskId: { type: String, default: null },
    organizationId: { type: String, default: null },
    actor: { type: String, required: true },
    eventType: { type: String, required: true },
    payload: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
eventSchema.index({ organizationId: 1, createdAt: 1 });
// The dashboard polls a running task's events every few seconds.
eventSchema.index({ taskId: 1, createdAt: 1 });

const securityEventSchema = new Schema<any>(
  {
    _id: idField,
    taskId: { type: String, default: null },
    organizationId: { type: String, default: null },
    agentId: { type: String, default: null },
    type: { type: String, required: true },
    reason: { type: String, required: true },
    payload: { type: String, required: true },
    severity: { type: String, default: null },
    requestedAmount: { type: Number, default: null },
    allowedAmount: { type: Number, default: null },
    metadata: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
securityEventSchema.index({ organizationId: 1, createdAt: 1 });

const paymentIntentSchema = new Schema<any>(
  {
    _id: idField,
    taskId: { type: String, required: true },
    requestingAgentId: { type: String, required: true },
    recipientServiceId: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    status: { type: String, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    blockchainTxId: { type: String, default: null },
    network: { type: String, default: null },
    failureReason: { type: String, default: null },
    settledAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

const blockchainTransactionSchema = new Schema<any>(
  {
    _id: idField,
    paymentIntentId: { type: String, required: true },
    network: { type: String, required: true },
    transactionId: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    asset: { type: String, required: true },
    status: { type: String, required: true },
    confirmedAt: { type: Date, default: null },
    rawMetadata: { type: String, default: null },
  },
  { timestamps: false, versionKey: false },
);

const algorandLedgerTransactionSchema = new Schema<any>(
  {
    _id: idField,
    taskId: { type: String, default: null },
    centralLedgerId: { type: String, default: null },
    fromWalletId: { type: String, required: true },
    toWalletId: { type: String, required: true },
    fromAddress: { type: String, required: true },
    toAddress: { type: String, required: true },
    amount: { type: Number, required: true },
    purpose: { type: String, required: true },
    type: { type: String, enum: TX_TYPES, required: true },
    txId: { type: String, required: true, unique: true },
    network: { type: String, required: true },
    status: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
algorandLedgerTransactionSchema.index(
  { centralLedgerId: 1 },
  { unique: true, partialFilterExpression: { centralLedgerId: { $type: "string" } } },
);

const blockchainWorkflowEventSchema = new Schema<any>(
  {
    _id: idField,
    workflowId: { type: String, required: true },
    taskId: { type: String, default: null },
    eventType: { type: String, required: true },
    fromAgentId: { type: String, default: null },
    toAgentId: { type: String, default: null },
    payloadHash: { type: String, required: true },
    canonicalPayloadVersion: { type: Number, default: 1 },
    network: { type: String, required: true },
    transactionId: { type: String, default: null },
    status: { type: String, required: true },
    failureReason: { type: String, default: null },
    confirmedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const models = {
  User: model("User", userSchema),
  Wallet: model("Wallet", walletSchema),
  Agent: model("Agent", agentSchema),
  AgentProvider: model("AgentProvider", agentProviderSchema),
  OrganizationMember: model("OrganizationMember", organizationMemberSchema),
  AuthorizationCredential: model("AuthorizationCredential", authorizationCredentialSchema),
  AgentCapabilityStat: model("AgentCapabilityStat", agentCapabilityStatSchema),
  Task: model("Task", taskSchema),
  Subtask: model("Subtask", subtaskSchema),
  Bid: model("Bid", bidSchema),
  CentralEscrow: model("CentralEscrow", centralEscrowSchema),
  AgentEscrow: model("AgentEscrow", agentEscrowSchema),
  CentralLedger: model("CentralLedger", centralLedgerSchema),
  AgentLedger: model("AgentLedger", agentLedgerSchema),
  AgentPerformance: model("AgentPerformance", agentPerformanceSchema),
  AgentCalibration: model("AgentCalibration", agentCalibrationSchema),
  AgentRating: model("AgentRating", agentRatingSchema),
  WorkflowMemory: model("WorkflowMemory", workflowMemorySchema),
  Event: model("Event", eventSchema),
  SecurityEvent: model("SecurityEvent", securityEventSchema),
  PaymentIntent: model("PaymentIntent", paymentIntentSchema),
  BlockchainTransaction: model("BlockchainTransaction", blockchainTransactionSchema),
  AlgorandLedgerTransaction: model(
    "AlgorandLedgerTransaction",
    algorandLedgerTransactionSchema,
  ),
  BlockchainWorkflowEvent: model(
    "BlockchainWorkflowEvent",
    blockchainWorkflowEventSchema,
  ),
} as const;

export type ModelName = keyof typeof models;

// Relation graph - consumed by the facade's `include` resolver.
export type RelationDef = {
  model: ModelName;
  type: "one" | "many";
  localField: string; // field on THIS model
  foreignField: string; // field on the RELATED model
};

export const relations: Partial<Record<ModelName, Record<string, RelationDef>>> = {
  Wallet: {
    agent: { model: "Agent", type: "one", localField: "agentId", foreignField: "_id" },
  },
  Agent: {
    wallet: { model: "Wallet", type: "one", localField: "_id", foreignField: "agentId" },
    bids: { model: "Bid", type: "many", localField: "_id", foreignField: "agentId" },
    subtasks: { model: "Subtask", type: "many", localField: "_id", foreignField: "assignedAgentId" },
  },
  Task: {
    user: { model: "User", type: "one", localField: "userId", foreignField: "_id" },
    subtasks: { model: "Subtask", type: "many", localField: "_id", foreignField: "taskId" },
    centralEscrow: { model: "CentralEscrow", type: "one", localField: "_id", foreignField: "taskId" },
    centralLedger: { model: "CentralLedger", type: "many", localField: "_id", foreignField: "taskId" },
    events: { model: "Event", type: "many", localField: "_id", foreignField: "taskId" },
  },
  Subtask: {
    task: { model: "Task", type: "one", localField: "taskId", foreignField: "_id" },
    assignedAgent: { model: "Agent", type: "one", localField: "assignedAgentId", foreignField: "_id" },
    bids: { model: "Bid", type: "many", localField: "_id", foreignField: "subtaskId" },
  },
  Bid: {
    subtask: { model: "Subtask", type: "one", localField: "subtaskId", foreignField: "_id" },
    agent: { model: "Agent", type: "one", localField: "agentId", foreignField: "_id" },
  },
  CentralLedger: {
    task: { model: "Task", type: "one", localField: "taskId", foreignField: "_id" },
    fromWallet: { model: "Wallet", type: "one", localField: "fromWalletId", foreignField: "_id" },
    toWallet: { model: "Wallet", type: "one", localField: "toWalletId", foreignField: "_id" },
  },
  CentralEscrow: {
    task: { model: "Task", type: "one", localField: "taskId", foreignField: "_id" },
  },
  AgentEscrow: {
    task: { model: "Task", type: "one", localField: "taskId", foreignField: "_id" },
    subtask: { model: "Subtask", type: "one", localField: "subtaskId", foreignField: "_id" },
    agent: { model: "Agent", type: "one", localField: "agentId", foreignField: "_id" },
  },
};

// Which scalar fields, other than `_id`, uniquely identify a row - used to
// resolve `where: { <uniqueField>: value }` lookups.
export const uniqueFields: Partial<Record<ModelName, string[]>> = {
  User: ["email"],
  Wallet: ["agentId", "algorandAddress"],
  CentralEscrow: ["taskId"],
  PaymentIntent: ["idempotencyKey"],
  BlockchainTransaction: ["transactionId"],
  AlgorandLedgerTransaction: ["txId", "centralLedgerId"],
  AgentProvider: ["ownerUserId"],
};
