import { verifyFirebaseIdToken } from "@/lib/auth/firebaseVerify";
import { DEMO_USER_ID } from "@/lib/db/demoUser";

export interface SessionUser {
  userId: string;
  email: string | null;
  name: string | null;
}

export type SessionResult = { user: SessionUser } | { error: string; status: number };

// The one real server-side identity check in this codebase (org/provider
// management). Behavior mirrors the client-side gate already used for task
// submission (Composer.tsx's `requiresAuth = firebaseConfigured && !user`):
//
// - Firebase IS configured (a real project id is set) -> a valid
//   `Authorization: Bearer <firebase ID token>` is REQUIRED. A missing or
//   invalid token is rejected outright - it is never silently downgraded to
//   the demo identity, since the client explicitly opted into real login.
// - Firebase is NOT configured anywhere (pure local demo, the "must remain
//   usable without external credentials" fallback) -> falls back to the
//   fixed DEMO_USER_ID, exactly like task creation already does.
export async function resolveSessionUser(request: Request): Promise<SessionResult> {
  const firebaseConfigured = Boolean(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);

  if (!firebaseConfigured) {
    return { user: { userId: DEMO_USER_ID, email: "demo@kraven.local", name: "Demo User" } };
  }

  if (!match) {
    return { error: "Sign in required.", status: 401 };
  }

  const verified = await verifyFirebaseIdToken(match[1]);
  if (!verified) {
    return { error: "Invalid or expired session - please sign in again.", status: 401 };
  }

  return { user: { userId: verified.uid, email: verified.email, name: verified.name } };
}
