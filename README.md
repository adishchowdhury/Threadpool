# Momentum — Autonomous AI Workforce Optimizer

A Gemini-powered Manager Agent decomposes a task, discovers/filters/ranks AI worker agents from a registry, constructs a workforce, executes the workflow, runs independent QA, and settles payment through a two-tier virtual-token economy — all gated by a deterministic Circuit Breaker that no LLM can override.

## Stack

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui · Gemini via Vercel AI SDK + Zod · Prisma + PostgreSQL · Server-Sent Events for the live dashboard.

## Prerequisites

- Node.js 22+
- A running PostgreSQL instance (see below for the Docker option this project was built against)
- (Optional) A Gemini API key — the app runs fully without one, using clearly-labeled deterministic fallbacks for planning/execution/QA

## Setup

1. **Database** — start Postgres. If you don't have one running locally, this project was developed against an isolated Docker container so it never touches any Postgres already installed on your machine:

   ```bash
   docker run -d --name momentum-postgres \
     -e POSTGRES_USER=momentum -e POSTGRES_PASSWORD=momentum_dev_pw -e POSTGRES_DB=momentum \
     -p 5433:5432 postgres:16-alpine
   ```

   (Already created it once? `docker start momentum-postgres` next time instead.)

2. **Env vars** — copy `.env` and fill in `GOOGLE_GENERATIVE_AI_API_KEY` if you have one (get one at https://aistudio.google.com/apikey). `DATABASE_URL` is already pointed at the container above.

3. **Install + migrate + seed:**

   ```bash
   npm install
   npx prisma migrate dev
   npm run db:seed
   ```

4. **Run:**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## Useful scripts

- `npm run db:seed` — reseed the agent registry + system wallets (non-destructive to existing tasks).
- `npm run db:reset` — wipe the database and reseed from scratch (same as clicking "Reset Demo" in the UI, or `POST /api/reset`).
- `scripts/smoke-economy.ts`, `scripts/smoke-orchestrator.ts`, `scripts/smoke-reassign.ts`, `scripts/smoke-cancel-race.ts` — run with `npx tsx scripts/<name>.ts` to exercise the economy invariants, the full task lifecycle, the QA-fail retry/reassign/terminate branches, and the cancellation race, respectively, without needing the dev server running.
- `scripts/browser-check.mjs` — drives the running dashboard end-to-end with Playwright (`node scripts/browser-check.mjs`, dev server must be running); screenshots land in `scripts/.screenshots/`.

## Demo flow

1. Submit the pre-filled fintech market-report task and watch the Manager plan → discover → filter → rank → construct a workforce → execute → QA → pay, live via SSE.
2. Click **Fire Rogue Agent Demo** to watch the Circuit Breaker block an oversized payout request in real time, with zero balance change.
3. Click **Reset Demo** for a clean state before the next run.
