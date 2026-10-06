"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { SiteNavLinks } from "./SiteNavLinks";

// Hamburger trigger + dropdown panel for the shared site nav, shown below
// the `xl` breakpoint where the inline SiteNavLinks row is hidden.
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="xl:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="flex size-8 shrink-0 items-center justify-center border border-neutral-300 text-neutral-700 transition-colors hover:border-neutral-900 hover:text-neutral-900"
      >
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-50 border-b border-neutral-200 bg-white/95 backdrop-blur">
          <nav
            onClick={() => setOpen(false)}
            className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-4 font-mono text-[12px] uppercase tracking-wider text-neutral-500"
          >
            <SiteNavLinks linkClassName="block py-2 transition-colors hover:text-neutral-900" />
          </nav>
        </div>
      )}
    </div>
  );
}
