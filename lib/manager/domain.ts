// Deterministic task-domain inference. A keyword match, not a model: the
// domain is stored on the task and on each performance record so routing can
// ask "how has this agent done in THIS domain?" instead of one blended number.
const DOMAINS: Array<{ domain: string; words: string[] }> = [
  { domain: "fintech", words: ["fintech", "payments", "neobank", "lending", "banking", "insurtech", "upi", "credit"] },
  { domain: "ev_mobility", words: ["ev ", "electric vehicle", "charging", "mobility", "battery"] },
  { domain: "saas", words: ["saas", "software as a service", "b2b software", "subscription software"] },
  { domain: "healthcare", words: ["healthcare", "health care", "medical", "pharma", "biotech", "clinical"] },
  { domain: "regulatory", words: ["regulation", "regulatory", "compliance", "rbi", "sebi", "gdpr", "legal"] },
  { domain: "ecommerce", words: ["ecommerce", "e-commerce", "retail", "marketplace seller", "d2c"] },
  { domain: "energy", words: ["energy", "solar", "renewable", "oil and gas"] },
];

export const GENERAL_DOMAIN = "general";

export function inferDomain(prompt: string): string {
  const text = ` ${prompt.toLowerCase()} `;
  let best = { domain: GENERAL_DOMAIN, hits: 0 };
  for (const d of DOMAINS) {
    const hits = d.words.filter((w) => text.includes(w)).length;
    if (hits > best.hits) best = { domain: d.domain, hits };
  }
  return best.domain;
}
