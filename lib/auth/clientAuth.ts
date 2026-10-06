"use client";

import { auth, firebaseConfigured } from "@/lib/firebase";

// Attaches the signed-in user's Firebase ID token (auto-refreshed by the
// SDK) as a Bearer header for calls into the org/provider API, which does
// real server-side verification (lib/auth/session.ts). Returns {} when
// Firebase isn't configured - the server falls back to the demo identity.
export async function authHeader(): Promise<Record<string, string>> {
  if (!firebaseConfigured || !auth?.currentUser) return {};
  try {
    const token = await auth.currentUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}
