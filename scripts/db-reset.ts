// Wipes all task/economy/event state and reseeds a clean registry + system
// wallets (same logic as POST /api/reset) - for repeatable local/demo
// resets from the command line.
//
//   npx tsx scripts/db-reset.ts
import { resetDatabase } from "@/lib/db/reset";
import { disconnectMongoose } from "@/lib/db/mongoose";

resetDatabase()
  .then(() => console.log("Reset complete."))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongoose());
