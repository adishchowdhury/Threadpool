import { prisma } from "../lib/prisma";
import { seedRegistry, REGISTRY_AGENTS } from "../lib/db/reset";

seedRegistry()
  .then(() => console.log(`Seeded ${REGISTRY_AGENTS.length} registry agents + system wallets.`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
