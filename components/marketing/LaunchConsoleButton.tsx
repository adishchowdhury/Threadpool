"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { LoginDialog } from "@/components/auth/login-dialog";
import { firebaseConfigured } from "@/lib/firebase";
import { useAuthUser } from "@/lib/use-auth-user";
import { ScrambleText, useHoverScramble } from "@/components/home/ScrambleText";

export function LaunchConsoleButton({
  label = "Launch console",
  size = "md",
  className = "",
}: {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuthUser();
  const [loginOpen, setLoginOpen] = useState(false);
  const scramble = useHoverScramble();

  function handleLaunch(e: React.MouseEvent) {
    e.preventDefault();
    if (firebaseConfigured && !authLoading && !user) {
      setLoginOpen(true);
      return;
    }
    router.push("/dashboard");
  }

  const sizeClasses =
    size === "sm"
      ? "h-9 px-4 text-xs"
      : "h-11 px-6 text-sm";

  return (
    <>
      <LoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onSuccess={() => router.push("/dashboard")}
      />
      <Link
        href="/dashboard"
        onClick={handleLaunch}
        onMouseEnter={scramble.onMouseEnter}
        onMouseLeave={scramble.onMouseLeave}
        className={`inline-flex items-center justify-center gap-2 border border-neutral-900 bg-neutral-900 font-medium text-white transition-colors hover:bg-neutral-800 dark:border-white dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 ${sizeClasses} ${className}`}
      >
        <ScrambleText text={label} active={scramble.hovered} />
        <ArrowRight className="size-3.5" />
      </Link>
    </>
  );
}
