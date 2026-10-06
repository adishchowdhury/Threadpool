// Seeds the registry (built-in agents, system wallets, demo user) without
// wiping any existing task/economy state - safe to run on a fresh DB or
// repeatedly on an existing one.
//
//   npx tsx scripts/db-seed.ts
import { seedRegistry } from "@/lib/db/reset";
import { disconnectMongoose } from "@/lib/db/mongoose";

seedRegistry()
  .then(() => console.log("Seed complete."))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongoose());
