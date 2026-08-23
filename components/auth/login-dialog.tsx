"use client";

import { useState } from "react";
import { signInWithPopup } from "firebase/auth";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/auth/google-icon";
import { auth, googleProvider, firebaseConfigured } from "@/lib/firebase";

export function LoginDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    if (!firebaseConfigured || !auth || !googleProvider) {
      setError("Firebase isn't configured yet — add NEXT_PUBLIC_FIREBASE_* env vars.");
      return;
    }
    setSigningIn(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      onSuccess();
      onOpenChange(false);
    } catch {
      setError("Sign-in failed. Please try again.");
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in to continue</DialogTitle>
          <DialogDescription>
            Kraven needs to know who&apos;s hiring the workforce before it spends your budget.
          </DialogDescription>
        </DialogHeader>

        <Button
          type="button"
          onClick={handleSignIn}
          disabled={signingIn}
          className="mt-2 h-11 w-full gap-2.5 rounded-lg"
        >
          {signingIn ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon className="size-4" />}
          {signingIn ? "Signing in…" : "Continue with Google"}
        </Button>

        {error && <p className="text-center text-xs text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
