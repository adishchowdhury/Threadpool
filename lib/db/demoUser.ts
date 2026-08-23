import { prisma } from "@/lib/prisma";

// There's no login/account system yet — every task is attributed to this
// single fixed demo user so chat history has a stable owner to scope by.
// Swap this out once real auth lands; callers keying off DEMO_USER_ID is
// the only thing that'll need to change (e.g. read the session instead).
export const DEMO_USER_ID = "demo-user";

export async function ensureDemoUser() {
  return prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: {
      id: DEMO_USER_ID,
      email: "demo@kraven.local",
      name: "Demo User",
      isDemo: true,
    },
  });
}
