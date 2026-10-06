import "dotenv/config";
import type { ClientSession } from "mongoose";
import {
  connectMongoose,
  mongoose,
  transactionsSupported,
  disconnectMongoose,
} from "@/lib/db/mongoose";
import {
  models,
  relations,
  type ModelName,
  type RelationDef,
} from "@/lib/db/models";

// ─────────────────────────────────────────────────────────────────────────
// Typed data-access client over Mongoose.
//
// The economy / orchestration code was written against a small, consistent
// slice of an ORM-style API (findUnique / findMany / create / update /
// upsert / deleteMany / count, `where` operators, `include`, atomic
// `{ increment }` writes, and `$transaction`). Rather than rewrite ~500 call
// sites - and risk subtle bugs in the financial paths - this module re-
// implements exactly that slice on top of Mongoose models.
//
// `id` <-> `_id` mapping happens here so application code keeps using `.id`.
// ─────────────────────────────────────────────────────────────────────────

const OP_MAP: Record<string, string> = {
  equals: "$eq",
  not: "$ne",
  in: "$in",
  notIn: "$nin",
  gt: "$gt",
  gte: "$gte",
  lt: "$lt",
  lte: "$lte",
};

function isOperatorObject(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (value instanceof Date || Array.isArray(value)) return false;
  const keys = Object.keys(value as object);
  if (keys.length === 0) return false;
  return keys.every(
    (k) =>
      k in OP_MAP ||
      ["contains", "startsWith", "endsWith", "mode"].includes(k),
  );
}

function translateWhere(where: Record<string, any> | undefined): Record<string, any> {
  if (!where) return {};
  const out: Record<string, any> = {};
  for (const [rawKey, value] of Object.entries(where)) {
    if (value === undefined) continue;
    const key = rawKey === "id" ? "_id" : rawKey;
    if (isOperatorObject(value)) {
      const cond: Record<string, any> = {};
      for (const [op, opVal] of Object.entries(value as Record<string, any>)) {
        if (op in OP_MAP) cond[OP_MAP[op]] = opVal;
        else if (op === "contains") cond.$regex = escapeRegex(String(opVal)), (cond.$options = "i");
        else if (op === "startsWith") cond.$regex = "^" + escapeRegex(String(opVal));
        else if (op === "endsWith") cond.$regex = escapeRegex(String(opVal)) + "$";
      }
      out[key] = cond;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function translateOrderBy(
  orderBy: Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">> | undefined,
): Record<string, 1 | -1> | undefined {
  if (!orderBy) return undefined;
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  const sort: Record<string, 1 | -1> = {};
  for (const clause of list) {
    for (const [field, dir] of Object.entries(clause)) {
      sort[field === "id" ? "_id" : field] = dir === "desc" ? -1 : 1;
    }
  }
  return sort;
}

const WRITE_OPS = ["increment", "decrement", "set", "push", "multiply"];

function isWriteOperatorObject(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (value instanceof Date || Array.isArray(value)) return false;
  const keys = Object.keys(value as object);
  return keys.length > 0 && keys.every((k) => WRITE_OPS.includes(k));
}

function translateUpdateData(data: Record<string, any>): Record<string, any> {
  const $set: Record<string, any> = {};
  const $inc: Record<string, any> = {};
  const $push: Record<string, any> = {};
  const $mul: Record<string, any> = {};
  for (const [rawKey, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const key = rawKey === "id" ? "_id" : rawKey;
    if (isWriteOperatorObject(value)) {
      const v = value as Record<string, any>;
      if ("increment" in v) $inc[key] = v.increment;
      else if ("decrement" in v) $inc[key] = -v.decrement;
      else if ("multiply" in v) $mul[key] = v.multiply;
      else if ("push" in v) $push[key] = v.push;
      else if ("set" in v) $set[key] = v.set;
    } else {
      $set[key] = value;
    }
  }
  const update: Record<string, any> = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($inc).length) update.$inc = $inc;
  if (Object.keys($push).length) update.$push = $push;
  if (Object.keys($mul).length) update.$mul = $mul;
  return update;
}

function mapDataIn(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k === "id" ? "_id" : k] = v;
  }
  return out;
}

// Recursively rename `_id` -> `id` on plain objects (including nested
// relation payloads attached by the include resolver). Leaves Dates,
// primitives and null untouched.
function deepMapId(value: any): any {
  if (Array.isArray(value)) return value.map(deepMapId);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === "_id") out.id = typeof v === "object" && v !== null ? String(v) : v;
        else if (k === "__v") continue;
        else out[k] = deepMapId(v);
      }
      if (!("id" in out) && "_id" in value) out.id = (value as any)._id;
      return out;
    }
  }
  return value;
}

type IncludeArg = Record<string, boolean | { orderBy?: any; include?: IncludeArg; where?: any; take?: number }>;

async function resolveInclude(
  modelName: ModelName,
  docs: any[],
  include: IncludeArg,
  session?: ClientSession,
): Promise<void> {
  const rels = relations[modelName] ?? {};
  for (const [relName, relOpt] of Object.entries(include)) {
    if (!relOpt) continue;
    const def: RelationDef | undefined = rels[relName];
    if (!def) continue;
    const opt = typeof relOpt === "object" ? relOpt : {};

    const localValues = Array.from(
      new Set(docs.map((d) => d[def.localField]).filter((v) => v !== undefined && v !== null)),
    );

    const relModel = models[def.model];
    const filter: Record<string, any> = {
      ...translateWhere(opt.where),
      [def.foreignField]: { $in: localValues },
    };
    const q = relModel.find(filter);
    if (session) q.session(session);
    const sort = translateOrderBy(opt.orderBy);
    if (sort) q.sort(sort);
    if (opt.take) q.limit(opt.take);
    const related: any[] = await q.lean();

    if (opt.include && related.length) {
      await resolveInclude(def.model, related, opt.include, session);
    }

    const byKey = new Map<any, any[]>();
    for (const r of related) {
      const k = r[def.foreignField];
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(r);
    }

    for (const d of docs) {
      const matches = byKey.get(d[def.localField]) ?? [];
      d[relName] = def.type === "many" ? matches : matches[0] ?? null;
    }
  }
}

class Delegate {
  constructor(
    private readonly modelName: ModelName,
    private readonly getSession: () => ClientSession | undefined,
  ) {}

  private model() {
    return models[this.modelName];
  }

  private async ready() {
    await connectMongoose();
  }

  private async finalize(docs: any[], include?: IncludeArg) {
    if (include && docs.length) {
      await resolveInclude(this.modelName, docs, include, this.getSession());
    }
    return docs.map(deepMapId);
  }

  async findFirst(args: any = {}): Promise<any | null> {
    await this.ready();
    const q = this.model().findOne(translateWhere(args.where));
    const session = this.getSession();
    if (session) q.session(session);
    const sort = translateOrderBy(args.orderBy);
    if (sort) q.sort(sort);
    if (args.skip) q.skip(args.skip);
    const doc = await q.lean();
    if (!doc) return null;
    return (await this.finalize([doc], args.include))[0];
  }

  findUnique(args: any = {}) {
    return this.findFirst(args);
  }

  async findFirstOrThrow(args: any = {}) {
    const row = await this.findFirst(args);
    if (!row) throw new Error(`No ${this.modelName} found`);
    return row;
  }

  async findUniqueOrThrow(args: any = {}) {
    return this.findFirstOrThrow(args);
  }

  async findMany(args: any = {}): Promise<any[]> {
    await this.ready();
    const q = this.model().find(translateWhere(args.where));
    const session = this.getSession();
    if (session) q.session(session);
    const sort = translateOrderBy(args.orderBy);
    if (sort) q.sort(sort);
    if (args.skip) q.skip(args.skip);
    if (args.take) q.limit(args.take);
    const docs = await q.lean();
    return this.finalize(docs, args.include);
  }

  async create(args: any): Promise<any> {
    await this.ready();
    const session = this.getSession();
    const [doc] = await this.model().create([mapDataIn(args.data)], session ? { session } : {});
    return (await this.finalize([doc.toObject()], args.include))[0];
  }

  async createMany(args: any): Promise<{ count: number }> {
    await this.ready();
    const rows = (Array.isArray(args.data) ? args.data : [args.data]).map(mapDataIn);
    const session = this.getSession();
    const res = await this.model().insertMany(rows, session ? { session } : {});
    return { count: res.length };
  }

  async update(args: any): Promise<any> {
    await this.ready();
    const session = this.getSession();
    const doc = await this.model().findOneAndUpdate(
      translateWhere(args.where),
      translateUpdateData(args.data),
      { returnDocument: "after", session, runValidators: true },
    );
    if (!doc) throw new Error(`${this.modelName} to update not found`);
    return (await this.finalize([doc.toObject()], args.include))[0];
  }

  async updateMany(args: any): Promise<{ count: number }> {
    await this.ready();
    const session = this.getSession();
    const res = await this.model().updateMany(
      translateWhere(args.where),
      translateUpdateData(args.data),
      { session },
    );
    // Report rows *matched*; modifiedCount is 0 for a no-op write,
    // which would break compare-and-set style guards.
    return { count: res.matchedCount ?? 0 };
  }

  async upsert(args: any): Promise<any> {
    await this.ready();
    const session = this.getSession();
    const existing = await this.model()
      .findOne(translateWhere(args.where))
      .session(session ?? null);
    if (existing) {
      if (args.update && Object.keys(args.update).length > 0) {
        return this.update({ where: args.where, data: args.update, include: args.include });
      }
      return (await this.finalize([existing.toObject()], args.include))[0];
    }
    try {
      return await this.create({ data: args.create, include: args.include });
    } catch (err: any) {
      // Lost an insert race against a concurrent upsert (E11000). Outside a
      // transaction the row now exists, so retry via the update/read path.
      // Inside one the session is aborted - let withTransaction retry.
      if (err?.code === 11000 && !session) return this.upsert(args);
      throw err;
    }
  }

  async delete(args: any): Promise<any> {
    await this.ready();
    const session = this.getSession();
    const doc = await this.model().findOneAndDelete(translateWhere(args.where), { session });
    if (!doc) throw new Error(`${this.modelName} to delete not found`);
    return deepMapId(doc.toObject());
  }

  async deleteMany(args: any = {}): Promise<{ count: number }> {
    await this.ready();
    const session = this.getSession();
    const res = await this.model().deleteMany(translateWhere(args.where), { session });
    return { count: res.deletedCount ?? 0 };
  }

  async count(args: any = {}): Promise<number> {
    await this.ready();
    const session = this.getSession();
    const q = this.model().countDocuments(translateWhere(args.where));
    if (session) q.session(session);
    return q.exec();
  }
}

const DELEGATE_KEYS: Record<string, ModelName> = {
  user: "User",
  wallet: "Wallet",
  agent: "Agent",
  task: "Task",
  subtask: "Subtask",
  bid: "Bid",
  centralEscrow: "CentralEscrow",
  agentEscrow: "AgentEscrow",
  centralLedger: "CentralLedger",
  agentLedger: "AgentLedger",
  agentPerformance: "AgentPerformance",
  agentCalibration: "AgentCalibration",
  workflowMemory: "WorkflowMemory",
  event: "Event",
  securityEvent: "SecurityEvent",
  paymentIntent: "PaymentIntent",
  blockchainTransaction: "BlockchainTransaction",
  algorandLedgerTransaction: "AlgorandLedgerTransaction",
  blockchainWorkflowEvent: "BlockchainWorkflowEvent",
};

type Delegates = { [K in keyof typeof DELEGATE_KEYS]: Delegate };

interface ClientExtras {
  $transaction<T>(fn: (db: DbClient) => Promise<T>): Promise<T>;
  $transaction<T>(ops: Promise<T>[]): Promise<T[]>;
  $disconnect(): Promise<void>;
  $connect(): Promise<void>;
}

export type DbClient = Delegates & ClientExtras;

function makeClient(getSession: () => ClientSession | undefined): DbClient {
  const client = {} as DbClient;
  for (const [key, modelName] of Object.entries(DELEGATE_KEYS)) {
    (client as any)[key] = new Delegate(modelName, getSession);
  }

  (client as any).$connect = async () => {
    await connectMongoose();
  };
  (client as any).$disconnect = async () => {
    await disconnectMongoose();
  };
  (client as any).$transaction = async (arg: any) => {
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    await connectMongoose();
    if (await transactionsSupported()) {
      const session = await mongoose.startSession();
      let result: any;
      try {
        await session.withTransaction(async () => {
          result = await arg(makeClient(() => session));
        });
      } finally {
        await session.endSession();
      }
      return result;
    }
    // Standalone MongoDB - no atomic rollback available (warning already
    // logged once by transactionsSupported()).
    return arg(makeClient(() => undefined));
  };

  return client;
}

const globalForDb = globalThis as unknown as { __kravenDb?: DbClient };

export const db: DbClient =
  globalForDb.__kravenDb ?? (globalForDb.__kravenDb = makeClient(() => undefined));
