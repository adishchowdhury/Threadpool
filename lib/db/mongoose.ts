import "dotenv/config";
import mongoose from "mongoose";

// Single shared Mongoose connection. Cached on globalThis so Next.js dev
// hot-reload (and repeated script runs in the same process) don't open a
// new pool on every module reload.
const MONGODB_URI =
  process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/kraven";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  supportsTransactions: boolean | null;
};

const globalForMongoose = globalThis as unknown as {
  __kravenMongoose?: MongooseCache;
};

const cache: MongooseCache =
  globalForMongoose.__kravenMongoose ??
  (globalForMongoose.__kravenMongoose = {
    conn: null,
    promise: null,
    supportsTransactions: null,
  });

export async function connectMongoose(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    mongoose.set("strictQuery", true);
    cache.promise = mongoose
      .connect(MONGODB_URI, { bufferCommands: false })
      .then((m) => m);
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

// Multi-document transactions require a replica set / mongos. On a plain
// standalone `mongod` the first `startSession().withTransaction()` throws
// with code 20 / IllegalOperation. We probe once and cache the result so the
// facade's $transaction can transparently fall back to a sessionless run
// (with a single loud warning) rather than crashing the economy engine.
export async function transactionsSupported(): Promise<boolean> {
  if (cache.supportsTransactions !== null) return cache.supportsTransactions;
  await connectMongoose();
  let ok = false;
  try {
    const admin = mongoose.connection.db!.admin();
    const info: any = await admin.command({ hello: 1 });
    // Multi-document transactions need a replica set (`setName`) or a
    // sharded cluster (mongos, `msg: "isdbgrid"`).
    ok = Boolean(info.setName) || info.msg === "isdbgrid";
  } catch {
    ok = false;
  }
  if (ok) {
    cache.supportsTransactions = true;
  } else {
    cache.supportsTransactions = false;
    console.warn(
      "\n[Kraven DB] MongoDB multi-document transactions are NOT available " +
        "(standalone server). Financial operations will run without atomic " +
        "rollback. For the real guarantees CLAUDE.md requires, run MongoDB as " +
        "a single-node replica set:\n" +
        "  mongod --replSet rs0 --dbpath <path>\n" +
        '  mongosh --eval "rs.initiate()"\n',
    );
  }
  return cache.supportsTransactions;
}

export { mongoose };

export async function disconnectMongoose(): Promise<void> {
  if (cache.conn) {
    await cache.conn.disconnect();
    cache.conn = null;
    cache.promise = null;
  }
}
