"use client";

import { useState } from "react";
import { signInWithPopup } from "firebase/auth";
import { Loader2, XIcon } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
      setError("Firebase isn't configured yet - add NEXT_PUBLIC_FIREBASE_* env vars.");
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
      <DialogContent showCloseButton={false} className="max-w-sm gap-0 rounded-none p-0">
        <DialogHeader className="gap-1.5 px-6 pt-6 pb-1 pr-10">
          <DialogTitle className="text-lg leading-tight font-semibold tracking-tight text-panel-foreground">
            Sign in to continue
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-panel-muted">
            Kraven needs to know who&apos;s hiring the workforce before it spends your budget.
          </DialogDescription>
        </DialogHeader>

        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-4 right-4 rounded-none text-panel-muted hover:text-panel-foreground"
            />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogClose>

        <div className="flex flex-col gap-2 px-6 pt-5 pb-6">
          <Button
            type="button"
            onClick={handleSignIn}
            disabled={signingIn}
            className="h-11 w-full gap-2.5 rounded-none"
          >
            {signingIn ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon className="size-4" />}
            {signingIn ? "Signing in…" : "Continue with Google"}
          </Button>

          {error && <p className="text-center text-xs text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
