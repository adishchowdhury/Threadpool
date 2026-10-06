import { sarvamCostInr } from "@/lib/manager/sarvam";
import { INR_PER_TOKEN } from "@/lib/economy/tokenValue";

// An agent's ask price is derived from what a job actually costs to run:
//
//   price (virtual tokens) = ceil( avg compute cost in INR * (1 + margin) / INR-per-token )
//
// - compute cost: measured Sarvam token usage of the agent's benchmark runs,
//   at Sarvam's published per-token rates (lib/manager/sarvam.ts). A verbose,
//   high-reasoning agent therefore genuinely costs more than a terse one.
// - margin and INR-per-token are Kraven business settings, not measurements:
//   how much an agent marks up its compute, and what one virtual task token
//   is worth. Override with KRAVEN_AGENT_MARGIN / NEXT_PUBLIC_KRAVEN_INR_PER_TOKEN (lib/economy/tokenValue.ts).
const DEFAULT_MARGIN = 0.3;

function numberFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function priceFromUsage(samples: Array<{ inputTokens: number; outputTokens: number }>): number | null {
  const metered = samples.filter((s) => s.inputTokens + s.outputTokens > 0);
  if (metered.length === 0) return null;
  const avgInr = metered.reduce((sum, s) => sum + sarvamCostInr(s), 0) / metered.length;
  const margin = numberFromEnv("KRAVEN_AGENT_MARGIN", DEFAULT_MARGIN);
  return Math.max(1, Math.ceil((avgInr * (1 + margin)) / INR_PER_TOKEN));
}
