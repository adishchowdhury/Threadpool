"use client";

import Link from "next/link";

// Single source of truth for primary site navigation - used by the homepage
// header/footer and by MarketingLayout/LegalLayout, so every page shows the
// exact same nav instead of each file keeping its own drifting copy.
const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Pricing", href: "/pricing" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Contact", href: "/contact" },
] as const;

export function SiteNavLinks({ linkClassName }: { linkClassName: string }) {
  return (
    <>
      {NAV_LINKS.map((item) => (
        <Link key={item.label} href={item.href} className={linkClassName}>
          {item.label}
        </Link>
      ))}
    </>
  );
}
