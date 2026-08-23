"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, firebaseConfigured } from "@/lib/firebase";

interface AuthState {
  user: User | null;
  loading: boolean;
}

export function useAuthUser(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, loading: firebaseConfigured });

  useEffect(() => {
    if (!firebaseConfigured || !auth) return;
    return onAuthStateChanged(auth, (user) => setState({ user, loading: false }));
  }, []);

  return state;
}
