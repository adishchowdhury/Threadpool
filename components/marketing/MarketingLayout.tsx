"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ScaleDivider, VerticalScaleBars } from "@/components/home/ScaleDivider";
import { ThemeToggle } from "@/components/theme-toggle";
import { LaunchConsoleButton } from "./LaunchConsoleButton";
import { SiteNavLinks } from "./SiteNavLinks";
import { FooterLinks } from "./FooterLinks";
import { MobileNav } from "./MobileNav";

export function MarketingLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = "auto";
    return () => {
      body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-50 lg:px-4">
      <VerticalScaleBars />

      {/* ─── NAV ─── */}
      <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex shrink-0 items-center">
            <Image src="/logo.png" alt="Kraven" width={2172} height={724} className="h-9 w-auto dark:invert" priority />
          </Link>
          <nav className="hidden items-center gap-5 font-mono text-[10.5px] uppercase tracking-wider text-neutral-400 xl:flex dark:text-neutral-500">
            <SiteNavLinks linkClassName="transition-colors hover:text-neutral-900 dark:hover:text-white" />
          </nav>
          <div className="flex shrink-0 items-center gap-3">
            <LaunchConsoleButton size="sm" />
            <ThemeToggle />
            <MobileNav />
          </div>
        </div>
      </header>

      {children}

      <ScaleDivider />

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-neutral-200 py-10 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <span className="font-mono text-[12px] text-neutral-400 dark:text-neutral-500">© 2026 Kraven. All rights reserved.</span>
          <div className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            <FooterLinks linkClassName="transition-colors hover:text-neutral-700 dark:hover:text-neutral-300" />
          </div>
        </div>
      </footer>
    </div>
  );
}
