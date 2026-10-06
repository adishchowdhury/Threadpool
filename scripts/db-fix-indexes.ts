// The `agentproviders` collection carries a stale `apiKeyHash_1` unique
// index from an earlier schema iteration - lib/db/models.ts's current
// agentProviderSchema has no `apiKeyHash` field at all, so every document
// (which all have apiKeyHash: null/undefined) collides on that leftover
// unique index as soon as a second AgentProvider is created
// (E11000 duplicate key error ... apiKeyHash_1 dup key: { apiKeyHash: null }).
//
// This syncs every model's indexes in MongoDB to exactly what
// lib/db/models.ts currently declares - dropping indexes that no longer
// correspond to a schema field/index definition (like apiKeyHash_1) and
// creating any that are missing. Safe to run any time; a no-op once synced.
//
//   npx tsx scripts/db-fix-indexes.ts
import { connectMongoose, disconnectMongoose } from "@/lib/db/mongoose";
import { models } from "@/lib/db/models";

async function main() {
  await connectMongoose();
  for (const [name, model] of Object.entries(models)) {
    const dropped = await model.syncIndexes();
    console.log(`${name}: synced${dropped.length ? ` (dropped/changed: ${dropped.join(", ")})` : ""}`);
  }
  console.log("Index sync complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongoose());
