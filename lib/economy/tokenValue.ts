// What one virtual task token is worth in real money. One definition shared by
// pricing (lib/agents/pricing.ts) and every place the UI mentions a token, so
// they can never disagree.
//
// Both numbers are Kraven business settings, not market data:
//  - INR per token: set with NEXT_PUBLIC_KRAVEN_INR_PER_TOKEN (the legacy
//    server-only KRAVEN_INR_PER_TOKEN is still honored on the server).
//  - USD/INR: an approximate rate for display only; set NEXT_PUBLIC_KRAVEN_USD_INR
//    to keep it current. Nothing is billed from it.
function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const INR_PER_TOKEN = positive(process.env.NEXT_PUBLIC_KRAVEN_INR_PER_TOKEN ?? process.env.KRAVEN_INR_PER_TOKEN, 0.1);
export const INR_PER_USD = positive(process.env.NEXT_PUBLIC_KRAVEN_USD_INR, 88);
export const USD_PER_TOKEN = INR_PER_TOKEN / INR_PER_USD;

export function tokensToInr(tokens: number): number {
  return tokens * INR_PER_TOKEN;
}

// Inverse conversions, for inputs where the user enters a money amount and
// Kraven needs a whole-token price (token accounting is always integer -
// CLAUDE.md §16 - so these round UP: never quote/charge less than the real
// cost of what was entered).
export function inrToTokens(inr: number): number {
  return Math.max(1, Math.ceil(inr / INR_PER_TOKEN));
}

export function usdToTokens(usd: number): number {
  return Math.max(1, Math.ceil(usd / USD_PER_TOKEN));
}

function trim(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.?0+$/, "");
}

export function formatInr(amount: number): string {
  if (Number.isInteger(amount) || amount >= 10) return `₹${Math.round(amount)}`;
  return `₹${amount.toFixed(2)}`;
}

export function formatUsd(amount: number): string {
  return `$${amount >= 0.01 ? trim(amount, 2) : trim(amount, 4)}`;
}

// "1 token = ₹0.10 ≈ $0.0011"
export function tokenRateLabel(): string {
  return `1 token = ${formatInr(INR_PER_TOKEN)} ≈ ${formatUsd(USD_PER_TOKEN)}`;
}

// "₹3 ≈ $0.034" for an amount of tokens
export function tokensWorthLabel(tokens: number): string {
  return `${formatInr(tokensToInr(tokens))} ≈ ${formatUsd(tokens * USD_PER_TOKEN)}`;
}
