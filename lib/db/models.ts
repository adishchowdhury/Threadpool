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
  return (mongoose.models[name] as Model<any>) ?? mongoose.model<any>(name, schema);
}

const WALLET_TYPES = ["MANAGER", "AGENT", "USER"] as const;
const AGENT_STATUSES = ["ACTIVE", "INACTIVE", "REVOKED"] as const;
const TASK_STATUSES = [
  "CREATED",
  "PLANNING",
  "IN_PROGRESS",
  "AWAITING_QA",
  "COMPLETED",
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
  },
  { timestamps: true, versionKey: false },
);

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
    pinned: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);
taskSchema.index({ userId: 1 });

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
    // JSON SubtaskArtifacts (lib/capabilities/types.ts): retrieved sources,
    // structured comparables, datasets, computed results, review verdict,
    // tool calls. What downstream workers and QA consume besides `output`.
    artifacts: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

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
  },
  { timestamps: true, versionKey: false },
);

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
    actor: { type: String, required: true },
    eventType: { type: String, required: true },
    payload: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

const securityEventSchema = new Schema<any>(
  {
    _id: idField,
    taskId: { type: String, default: null },
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
  Task: model("Task", taskSchema),
  Subtask: model("Subtask", subtaskSchema),
  Bid: model("Bid", bidSchema),
  CentralEscrow: model("CentralEscrow", centralEscrowSchema),
  AgentEscrow: model("AgentEscrow", agentEscrowSchema),
  CentralLedger: model("CentralLedger", centralLedgerSchema),
  AgentLedger: model("AgentLedger", agentLedgerSchema),
  AgentPerformance: model("AgentPerformance", agentPerformanceSchema),
  AgentCalibration: model("AgentCalibration", agentCalibrationSchema),
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
};
