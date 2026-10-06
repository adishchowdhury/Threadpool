"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { useTheme } from "next-themes";
import {
  FileText,
  Home,
  Info,
  LogIn,
  LogOut,
  Mail,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Pin,
  PinOff,
  Search,
  Share2,
  ShieldCheck,
  SquarePen,
  Store,
  Sun,
  Tag,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoginDialog } from "@/components/auth/login-dialog";
import { firebaseConfigured, auth } from "@/lib/firebase";
import { authHeader } from "@/lib/auth/clientAuth";
import { useAuthUser } from "@/lib/use-auth-user";
import type { TaskRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

const ACTIVE = new Set(["CREATED", "PLANNING", "IN_PROGRESS", "AWAITING_QA"]);

// Mirrors the marketing site's SiteNavLinks so the console can link back out
// to the same pages, without pulling in the marketing-only component.
const SITE_LINKS = [
  { label: "About", href: "/about", icon: Info },
  { label: "Pricing", href: "/pricing", icon: Tag },
  { label: "Privacy", href: "/privacy", icon: ShieldCheck },
  { label: "Terms", href: "/terms", icon: FileText },
  { label: "Contact", href: "/contact", icon: Mail },
] as const;

function groupByRecency(tasks: TaskRecord[]): Array<{ label: string; tasks: TaskRecord[] }> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  const buckets: Array<{ label: string; min: number; tasks: TaskRecord[] }> = [
    { label: "Today", min: startOfToday.getTime(), tasks: [] },
    { label: "Yesterday", min: startOfToday.getTime() - day, tasks: [] },
    { label: "Previous 7 days", min: startOfToday.getTime() - 7 * day, tasks: [] },
    { label: "Earlier", min: -Infinity, tasks: [] },
  ];
  for (const task of tasks) {
    const t = new Date(task.createdAt).getTime();
    buckets.find((b) => t >= b.min)!.tasks.push(task);
  }
  return buckets.filter((b) => b.tasks.length > 0);
}

function initialsFor(name: string | null, email: string | null) {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email?.trim()[0] ?? "?").toUpperCase();
}

function TaskMenu({
  pinned,
  onShare,
  onTogglePin,
  onDelete,
}: {
  pinned: boolean;
  onShare: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        aria-label="Task options"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-sidebar-border hover:text-foreground focus-visible:opacity-100 group-hover/task:opacity-100 data-popup-open:opacity-100",
        )}
      >
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-44">
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onShare();
          }}
        >
          <Share2 className="size-3.5" />
          Share
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
        >
          {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          {pinned ? "Unpin" : "Pin"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="size-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavButton({ icon: Icon, label, onClick }: { icon: typeof SquarePen; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {label}
    </button>
  );
}

function AccountMenu() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const { resolvedTheme, setTheme } = useTheme();
  const [loginOpen, setLoginOpen] = useState(false);
  const dark = resolvedTheme === "dark";

  async function handleLogout() {
    try {
      if (auth) await signOut(auth);
      router.replace("/");
    } catch {
      toast.error("Couldn't log out - please try again.");
    }
  }

  if (firebaseConfigured && !loading && !user) {
    return (
      <>
        <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSuccess={() => {}} />
        <button
          type="button"
          onClick={() => setLoginOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-sidebar-accent"
        >
          <LogIn className="size-4 text-muted-foreground" /> Sign in
        </button>
      </>
    );
  }

  const displayName = user?.displayName ?? user?.email?.split("@")[0] ?? "Guest";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent"
        aria-label={`Account menu for ${displayName}`}
      >
        <Avatar className="size-8">
          {user?.photoURL && <AvatarImage src={user.photoURL} alt={displayName} referrerPolicy="no-referrer" />}
          <AvatarFallback className="bg-foreground text-xs font-medium text-background">
            {user ? initialsFor(user.displayName, user.email) : "G"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{displayName}</div>
          {user?.email && <div className="truncate text-xs text-muted-foreground">{user.email}</div>}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        {user && (
          <>
            <DropdownMenuLabel>
              <p className="truncate text-sm font-medium">{displayName}</p>
              {user.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <User className="size-3.5" />
          View profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme(dark ? "light" : "dark")}>
          {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          {dark ? "Light theme" : "Dark theme"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/")}>
          <Home className="size-3.5" />
          Home page
        </DropdownMenuItem>
        {SITE_LINKS.map((link) => (
          <DropdownMenuItem key={link.href} onClick={() => router.push(link.href)}>
            <link.icon className="size-3.5" />
            {link.label}
          </DropdownMenuItem>
        ))}
        {user && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleLogout}>
              <LogOut className="size-3.5" />
              Log out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar({
  activeTaskId,
  refreshKey,
  mode,
  onModeChange,
  onSelect,
  onNewTask,
  onOpenAgents,
  onClose,
}: {
  activeTaskId: string | null;
  // Changes whenever the history may have changed (new task, status change).
  refreshKey: string;
  // "user" = normal task workspace. "org" = manage your own agents/org -
  // a genuinely separate mode (§33), not mixed into this same nav.
  mode: "user" | "org";
  onModeChange: (mode: "user" | "org") => void;
  onSelect: (taskId: string) => void;
  onNewTask: () => void;
  onOpenAgents: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TaskRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authHeader()
      .then((headers) => fetch("/api/tasks", { headers }))
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setTasks(data.tasks ?? []);
      })
      .catch(() => {
        if (!cancelled) toast.error("Couldn't reach the server to load your tasks.");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tasks.filter((t) => t.prompt.toLowerCase().includes(q)) : tasks;
  }, [tasks, query]);

  const pinnedTasks = useMemo(() => filteredTasks.filter((t) => t.pinned), [filteredTasks]);
  const groups = useMemo(
    () => groupByRecency(filteredTasks.filter((t) => !t.pinned)),
    [filteredTasks],
  );

  async function handleTogglePin(task: TaskRecord) {
    const nextPinned = !task.pinned;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, pinned: nextPinned } : t)));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, pinned: task.pinned } : t)));
      toast.error("Couldn't update pin - please try again.");
    }
  }

  function handleShare(task: TaskRecord) {
    const url = `${window.location.origin}/dashboard?task=${task.id}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Link copied to clipboard"))
      .catch(() => toast.error("Couldn't copy the link."));
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tasks/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setTasks((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      if (activeTaskId === deleteTarget.id) onNewTask();
      setDeleteTarget(null);
    } catch {
      toast.error("Couldn't delete the task - please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <Link href="/" className="flex items-center px-1" title="Visit home page">
          {/* The logo asset is a dark wordmark; invert it on the dark theme. */}
          <Image src="/logo.png" alt="Kraven" width={72} height={24} priority className="h-6 w-auto dark:invert" />
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sidebar"
          title="Close sidebar"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <PanelLeftClose className="size-4.5" />
        </button>
      </div>

      <div className="px-2 pt-2">
        <div role="tablist" aria-label="Mode" className="flex gap-0.5 rounded-lg bg-sidebar-border/60 p-0.5">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "user"}
            onClick={() => onModeChange("user")}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              mode === "user" ? "bg-sidebar text-sidebar-foreground shadow-sm" : "text-muted-foreground hover:text-sidebar-foreground",
            )}
          >
            Workforce
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "org"}
            onClick={() => onModeChange("org")}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              mode === "org" ? "bg-sidebar text-sidebar-foreground shadow-sm" : "text-muted-foreground hover:text-sidebar-foreground",
            )}
          >
            My Organization
          </button>
        </div>
      </div>

      {mode === "org" && (
        <div className="mx-2 mt-3 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/40 px-3 py-2.5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Register and manage your own agents here - they compete for real work in the marketplace.
          </p>
          <button
            type="button"
            onClick={() => onModeChange("user")}
            className="mt-1.5 text-xs font-medium text-sidebar-foreground/80 underline underline-offset-2 hover:text-sidebar-foreground"
          >
            Switch back to Workforce
          </button>
        </div>
      )}

      {mode === "user" && (
        <nav className="space-y-0.5 px-2 pt-2" aria-label="Main">
          <NavButton icon={SquarePen} label="New task" onClick={onNewTask} />
          <NavButton icon={Search} label="Search tasks" onClick={() => setSearching((s) => !s)} />
          <NavButton icon={Store} label="Agents" onClick={onOpenAgents} />
          <NavButton icon={Home} label="Home page" onClick={() => router.push("/")} />
        </nav>
      )}

      {mode === "user" && searching && (
        <div className="animate-in fade-in slide-in-from-top-1 px-3 pt-2 duration-200 ease-out">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your tasks"
              aria-label="Search tasks"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {mode === "user" && !loaded && <p className="px-2.5 py-2 text-xs text-muted-foreground">Loading…</p>}
        {mode === "user" && loaded && groups.length === 0 && pinnedTasks.length === 0 && (
          <p className="px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
            {query ? "No tasks match your search." : "Your tasks will appear here. Describe one to get started."}
          </p>
        )}
        {mode === "user" && pinnedTasks.length > 0 && (
          <section className="mb-3">
            <h3 className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">Pinned</h3>
            <ul className="space-y-0.5">
              {pinnedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  active={activeTaskId === task.id}
                  onSelect={() => onSelect(task.id)}
                  onShare={() => handleShare(task)}
                  onTogglePin={() => handleTogglePin(task)}
                  onDelete={() => setDeleteTarget(task)}
                />
              ))}
            </ul>
          </section>
        )}
        {mode === "user" && groups.map((group) => (
          <section key={group.label} className="mb-3">
            <h3 className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group.label}</h3>
            <ul className="space-y-0.5">
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  active={activeTaskId === task.id}
                  onSelect={() => onSelect(task.id)}
                  onShare={() => handleShare(task)}
                  onTogglePin={() => handleTogglePin(task)}
                  onDelete={() => setDeleteTarget(task)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="border-t border-sidebar-border p-2">
        <AccountMenu />
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete task</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  This removes <span className="font-medium text-foreground">&ldquo;{deleteTarget.prompt}&rdquo;</span> from
                  your history. Ledger and escrow records for it are kept for audit purposes.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskRow({
  task,
  active,
  onSelect,
  onShare,
  onTogglePin,
  onDelete,
}: {
  task: TaskRecord;
  active: boolean;
  onSelect: () => void;
  onShare: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const running = ACTIVE.has(task.status);
  const failed = task.status === "FAILED";
  return (
    <li className="group/task relative animate-in fade-in duration-300">
      <div
        className={cn(
          "flex w-full items-center gap-0.5 rounded-lg py-1 pl-2.5 pr-1 text-sm transition-colors hover:bg-sidebar-accent",
          active && "bg-sidebar-accent",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          title={task.prompt}
          className="min-w-0 flex-1 truncate py-1 text-left outline-none"
        >
          {task.prompt}
        </button>
        <div className="grid size-6 shrink-0 place-items-center">
          <span
            className={cn(
              "col-start-1 row-start-1 flex items-center justify-center transition-opacity duration-150 group-hover/task:opacity-0",
            )}
          >
            {running && <span aria-label="Running" className="size-1.5 animate-pulse rounded-full bg-emerald-500" />}
            {!running && failed && (
              <span aria-label="Failed" className="size-1.5 animate-in zoom-in-50 rounded-full bg-destructive duration-300" />
            )}
            {!running && !failed && task.pinned && <Pin className="size-3 text-muted-foreground" />}
          </span>
          <div className="col-start-1 row-start-1">
            <TaskMenu pinned={task.pinned} onShare={onShare} onTogglePin={onTogglePin} onDelete={onDelete} />
          </div>
        </div>
      </div>
    </li>
  );
}
