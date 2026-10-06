"use client";

import Link from "next/link";

// Legal/support links shown in the site footer - deliberately narrower than
// SiteNavLinks (no Home/About/Pricing): the footer's job is copyright +
// where to find the legal/contact pages, not a second primary nav.
const FOOTER_LINKS = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Contact", href: "/contact" },
] as const;

export function FooterLinks({ linkClassName }: { linkClassName: string }) {
  return (
    <>
      {FOOTER_LINKS.map((item) => (
        <Link key={item.label} href={item.href} className={linkClassName}>
          {item.label}
        </Link>
      ))}
    </>
  );
}
