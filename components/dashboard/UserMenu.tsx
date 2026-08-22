"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { ChevronDown, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoginDialog } from "@/components/auth/login-dialog";
import { auth, firebaseConfigured } from "@/lib/firebase";
import { useAuthUser } from "@/lib/use-auth-user";

function initialsFor(name: string | null, email: string | null) {
  const source = name?.trim() || email?.trim() || "?";
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return source[0]!.toUpperCase();
}

export function UserMenu() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [loginOpen, setLoginOpen] = useState(false);

  if (!firebaseConfigured || loading) return null;

  if (!user) {
    return (
      <>
        <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSuccess={() => {}} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLoginOpen(true)}
          className="text-panel-foreground hover:bg-panel-elevated"
        >
          <LogIn className="size-3.5" /> <span className="hidden sm:inline">Sign in</span>
        </Button>
      </>
    );
  }

  const displayName = user.displayName ?? user.email?.split("@")[0] ?? "Account";
  const initials = initialsFor(user.displayName, user.email);

  async function handleLogout() {
    try {
      await signOut(auth);
      router.replace("/");
    } catch {
      toast.error("Couldn't log out — please try again.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="group flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1.5 text-panel-foreground outline-none transition-colors hover:bg-panel-elevated data-popup-open:bg-panel-elevated sm:pr-2"
        aria-label={`Account menu for ${displayName}`}
      >
        <Avatar className="size-7 ring-1 ring-panel-border">
          {user.photoURL && <AvatarImage src={user.photoURL} alt={displayName} referrerPolicy="no-referrer" />}
          <AvatarFallback className="bg-accent-strong text-accent-strong-foreground">{initials}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-24 truncate text-xs font-medium sm:inline">{displayName}</span>
        <ChevronDown className="hidden size-3.5 text-panel-muted transition-transform group-data-popup-open:rotate-180 sm:inline" />
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        <DropdownMenuLabel>
          <p className="truncate text-sm font-medium text-panel-foreground">{displayName}</p>
          {user.email && <p className="truncate text-xs text-panel-muted">{user.email}</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleLogout}>
          <LogOut className="size-3.5" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
