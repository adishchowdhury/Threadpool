"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { useTheme } from "next-themes";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Coins,
  CreditCard,
  ListChecks,
  ListTodo,
  Loader2,
  LogOut,
  Mail,
  Moon,
  ShieldAlert,
  ShieldCheck,
  Star,
  Store,
  Sun,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Progress, ProgressTrack, ProgressIndicator } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { SiteNavLinks } from "@/components/marketing/SiteNavLinks";
import { firebaseConfigured, auth } from "@/lib/firebase";
import { authHeader } from "@/lib/auth/clientAuth";
import { useAuthUser } from "@/lib/use-auth-user";
import { tokensWorthLabel } from "@/lib/economy/tokenValue";
import { cn } from "@/lib/utils";

interface ProfileData {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    isDemo: boolean;
    joinedAt: string | null;
    authProvider: string;
  };
  organization: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    role: string;
    memberCount: number;
    createdAt: string;
  } | null;
  taskStats: {
    total: number;
    completed: number;
    active: number;
    failed: number;
    totalBudgeted: number;
    totalSpent: number;
    avgQuality: number | null;
  };
  workforce: {
    agents: number;
    activeAgents: number;
    jobsCompleted: number;
    successRate: number | null;
    avgQaScore: number | null;
    totalEarned: number;
  } | null;
  security: { blockedAttempts: number };
  plan: {
    id: string;
    name: string;
    billingNote: string;
    maxBudgetPerTask: number | null;
    tasksPerMonth: number | null;
    tasksUsedThisMonth: number;
  };
}

function initialsFor(name: string | null, email: string | null) {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email?.trim()[0] ?? "?").toUpperCase();
}

// A stat tile with a small icon badge - used throughout for consistent,
// scannable numbers (tasks, spend, QA score, agent counts, etc).
function StatTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Briefcase;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/40 px-4 py-3.5 transition-colors hover:border-border hover:bg-card/70">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate font-mono text-lg leading-tight font-semibold tabular-nums text-foreground">{value}</p>
        {sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

// A full-width, icon-led clickable row for simple account actions (theme,
// log out) - a compact list rather than full-size bordered buttons, which
// looked oversized and misaligned stacked in a narrow sidebar card.
function ActionRow({
  icon: Icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: typeof Briefcase;
  label: string;
  onClick: () => void;
  tone?: "default" | "destructive";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted/60",
        tone === "destructive" ? "text-destructive" : "text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}

function SectionHeading({ icon: Icon, children }: { icon: typeof Briefcase; children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 px-0.5">
      <Icon className="size-4 text-muted-foreground" />
      <h2 className="text-[13px] font-semibold tracking-wide text-foreground uppercase">{children}</h2>
    </div>
  );
}

export function ProfileView() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuthUser();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (firebaseConfigured && !authLoading && !user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    document.body.classList.add("workspace");
    return () => document.body.classList.remove("workspace");
  }, []);

  // Waits for Firebase's auth state to settle before fetching (same guard
  // OrgWorkspace uses) - firing immediately on mount would race
  // onAuthStateChanged, so authHeader() could read a not-yet-hydrated
  // auth.currentUser as null and send an unauthenticated request.
  const requiresAuth = firebaseConfigured && !authLoading && !user;

  useEffect(() => {
    if (authLoading || requiresAuth) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const headers = await authHeader();
        const res = await fetch("/api/profile", { headers });
        const d = await res.json();
        if (!res.ok || !d?.user) throw new Error(d?.error ?? "Couldn't load your profile.");
        if (!cancelled) setData(d);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Couldn't load your profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, requiresAuth]);

  async function handleLogout() {
    try {
      if (auth) await signOut(auth);
      router.replace("/");
    } catch {
      toast.error("Couldn't log out - please try again.");
    }
  }

  const displayName = user?.displayName ?? data?.user?.name ?? user?.email?.split("@")[0] ?? "Guest";
  const email = user?.email ?? data?.user?.email ?? null;
  const usagePct =
    data && data.plan.tasksPerMonth != null
      ? Math.min(100, Math.round((data.plan.tasksUsedThisMonth / data.plan.tasksPerMonth) * 100))
      : null;

  return (
    // position:fixed + its own overflow-y-auto deliberately bypasses the app
    // shell's <body class="overflow-hidden"> (globally relied on so the
    // dashboard can manage its own internal scroll regions) - same escape
    // hatch Dashboard.tsx itself uses, so this standalone page can scroll.
    <div className="fixed inset-0 flex flex-col overflow-y-auto bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur sm:px-6">
        <Button type="button" variant="ghost" size="sm" onClick={() => router.push("/dashboard")}>
          <ArrowLeft className="size-4" /> Back to workforce
        </Button>
        <span className="text-sm font-semibold tracking-tight">Profile</span>
        <div className="w-[136px]" aria-hidden />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {loading && !data && (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading your profile…
          </div>
        )}

        {data && (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[300px_1fr]">
            {/* ── Left rail: identity, plan, actions ── */}
            <div className="flex flex-col gap-5 lg:sticky lg:top-19">
              <Card>
                <CardContent className="flex flex-col items-center px-6 pt-2 pb-5 text-center">
                  <Avatar className="size-20 ring-4 ring-muted">
                    {user?.photoURL && <AvatarImage src={user.photoURL} alt={displayName} referrerPolicy="no-referrer" />}
                    <AvatarFallback className="bg-foreground text-xl font-medium text-background">
                      {initialsFor(displayName, email)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="mt-3 truncate text-lg font-semibold tracking-tight text-foreground">{displayName}</p>
                  {email && (
                    <p className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-muted-foreground">
                      <Mail className="size-3.5 shrink-0" /> {email}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                    <Badge variant="secondary">{data.user.authProvider}</Badge>
                    {data.user.joinedAt && (
                      <Badge variant="outline" className="gap-1">
                        <Calendar className="size-3" />
                        Joined {new Date(data.user.joinedAt).toLocaleDateString()}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5 text-sm">
                    <CreditCard className="size-4 text-muted-foreground" /> Plan &amp; usage
                  </CardTitle>
                  <CardAction>
                    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-500/10 dark:text-emerald-400" variant="outline">
                      Free
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-base font-semibold text-foreground">{data.plan.name}</p>
                  <p className="-mt-2 text-[12px] leading-relaxed text-muted-foreground">{data.plan.billingNote}</p>

                  <Separator />

                  {data.plan.tasksPerMonth != null ? (
                    <Progress value={usagePct}>
                      <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Tasks this month</span>
                        <span className="font-medium tabular-nums text-foreground">
                          {data.plan.tasksUsedThisMonth} / {data.plan.tasksPerMonth}
                        </span>
                      </div>
                      <ProgressTrack>
                        <ProgressIndicator className={cn(usagePct != null && usagePct >= 100 && "bg-destructive")} />
                      </ProgressTrack>
                    </Progress>
                  ) : (
                    <p className="text-[11.5px] text-muted-foreground">Unlimited tasks per month at this tier.</p>
                  )}

                  <p className="text-[11.5px] text-muted-foreground">
                    Budget cap / task:{" "}
                    <span className="font-medium text-foreground">
                      {data.plan.maxBudgetPerTask != null ? `${data.plan.maxBudgetPerTask} tokens` : "unlimited (org-level cap)"}
                    </span>
                  </p>

                  <Button variant="outline" size="sm" className="mt-1" nativeButton={false} render={<Link href="/pricing" />}>
                    View all plans
                  </Button>
                </CardContent>
              </Card>

              <Card className="py-1.5">
                <CardContent className="flex flex-col divide-y divide-border/70 px-0">
                  <ActionRow
                    icon={dark ? Sun : Moon}
                    label={dark ? "Switch to light theme" : "Switch to dark theme"}
                    onClick={() => setTheme(dark ? "light" : "dark")}
                  />
                  {user && <ActionRow icon={LogOut} label="Log out" tone="destructive" onClick={handleLogout} />}
                </CardContent>
              </Card>

              <nav aria-label="Site" className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-1 pb-2">
                <SiteNavLinks linkClassName="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground" />
              </nav>
            </div>

            {/* ── Right column: usage & account detail ── */}
            <div className="flex flex-col gap-8">
              <section>
                <SectionHeading icon={Briefcase}>Workforce usage</SectionHeading>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <StatTile icon={ListTodo} label="Total tasks" value={String(data.taskStats.total)} />
                  <StatTile icon={CheckCircle2} label="Completed" value={String(data.taskStats.completed)} />
                  <StatTile icon={Clock} label="Active" value={String(data.taskStats.active)} />
                  <StatTile
                    icon={Coins}
                    label="Total spent"
                    value={`${data.taskStats.totalSpent} tok`}
                    sub={tokensWorthLabel(data.taskStats.totalSpent)}
                  />
                  <StatTile
                    icon={Star}
                    label="Avg. QA score"
                    value={data.taskStats.avgQuality != null ? String(data.taskStats.avgQuality) : "—"}
                    sub={data.taskStats.avgQuality != null ? "across reviewed work" : "no QA history yet"}
                  />
                  <StatTile
                    icon={ListChecks}
                    label="Failed / cancelled"
                    value={String(data.taskStats.failed)}
                  />
                </div>
              </section>

              {data.organization && (
                <section>
                  <SectionHeading icon={Building2}>Organization</SectionHeading>
                  <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-4 px-5">
                      <div className="flex items-center gap-3">
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <Building2 className="size-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{data.organization.name}</p>
                            <Badge variant="secondary">{data.organization.role}</Badge>
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-[11.5px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Users className="size-3" /> {data.organization.memberCount} member
                              {data.organization.memberCount === 1 ? "" : "s"}
                            </span>
                            <span className="flex items-center gap-1">
                              <ShieldCheck className="size-3" /> {data.organization.status}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={() => router.push("/dashboard?mode=org")}>
                        Manage organization
                      </Button>
                    </CardContent>
                  </Card>
                </section>
              )}

              {data.workforce && (
                <section>
                  <SectionHeading icon={Store}>Your registered agents</SectionHeading>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatTile icon={Store} label="Agents" value={`${data.workforce.activeAgents}/${data.workforce.agents}`} sub="active" />
                    <StatTile
                      icon={TrendingUp}
                      label="Success rate"
                      value={data.workforce.successRate != null ? `${Math.round(data.workforce.successRate * 100)}%` : "—"}
                    />
                    <StatTile icon={ListChecks} label="Jobs done" value={String(data.workforce.jobsCompleted)} />
                    <StatTile icon={Wallet} label="Total earned" value={`${Math.round(data.workforce.totalEarned)} tok`} />
                  </div>
                </section>
              )}

              <section>
                <SectionHeading icon={ShieldAlert}>Security</SectionHeading>
                <Card>
                  <CardContent className="flex items-center gap-3 px-5">
                    <div
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-xl",
                        data.security.blockedAttempts > 0
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      <ShieldAlert className="size-5" />
                    </div>
                    <p className="text-[13px] text-foreground">
                      <span className="font-mono font-semibold tabular-nums">{data.security.blockedAttempts}</span>{" "}
                      <span className="text-muted-foreground">
                        overspend attempt{data.security.blockedAttempts === 1 ? "" : "s"} blocked by the Circuit Breaker
                      </span>
                    </p>
                  </CardContent>
                </Card>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
