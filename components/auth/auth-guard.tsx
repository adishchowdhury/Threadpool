"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuthUser } from "@/lib/use-auth-user";
import { firebaseConfigured } from "@/lib/firebase";

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuthUser();

  useEffect(() => {
    if (firebaseConfigured && !loading && !user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  if (!firebaseConfigured) {
    return <>{children}</>;
  }

  if (loading || !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
