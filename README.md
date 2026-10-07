# Kraven - Autonomous AI Workforce Optimizer
Kraven manages the economics, permissions, routing and accountability of autonomous AI agents.

A Sarvam-powered Manager Agent decomposes a task, discovers/filters/ranks AI worker agents from a registry, constructs a workforce, executes the workflow, runs independent QA, and settles payment through a two-tier virtual-token economy - all gated by a deterministic Circuit Breaker that no LLM can override.

## Stack

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui · Sarvam AI (sarvam-105b) via Vercel AI SDK + Zod · MongoDB + Mongoose · Server-Sent Events for the live dashboard.

## Prerequisites

- Node.js 22+
- A running MongoDB instance (Atlas or local - see below)
- (Optional) A Sarvam API key (`SARVAM_API_KEY`, https://dashboard.sarvam.ai) - the app runs fully without one, using clearly-labeled deterministic fallbacks for planning/execution/QA

## Setup

1. **Database** - use a MongoDB Atlas cluster (a replica set by default), or a local `mongod` started as a single-node replica set so the escrow engine gets atomic multi-document transactions:

   ```bash
   mongod --replSet rs0 --dbpath <path>
   mongosh --eval "rs.initiate()"
   ```

   A plain standalone `mongod` also runs the app, but financial writes then have no atomic rollback and the server logs a warning at startup.

2. **Env vars** - set `MONGODB_URI` in `.env` (default `mongodb://127.0.0.1:27017/kraven`; for a replica set use `...?replicaSet=rs0`). Optionally add `SARVAM_API_KEY`.

3. **Install + seed** (no migrations - the schema lives in `lib/db/models.ts`):

   ```bash
   npm install
   npm run db:seed
   ```

4. **Calibrate the agent registry** (needs `SARVAM_API_KEY`; makes real model calls, a few minutes):

   ```bash
   npm run agents:calibrate
   ```

   Agent listings (role, capabilities, model tier, system prompt, price) live in `lib/agents/roster.ts`. Their quality / success / latency / reputation are never hand-written: calibration runs each agent on a fixed benchmark per capability, scores it with the independent QA reviewer, and stores the result; real task runs then keep refining the same numbers. Prices are derived too: calibration records the Sarvam tokens each agent actually uses, and price = ceil(compute cost at Sarvam's published rates × (1 + margin) ÷ INR-per-token) (`lib/agents/pricing.ts`; tune with `KRAVEN_AGENT_MARGIN`, default 0.3, and `NEXT_PUBLIC_KRAVEN_INR_PER_TOKEN`, default 0.1; display-only USD rate `NEXT_PUBLIC_KRAVEN_USD_INR`, default 88). An agent that has not been calibrated has no price and cannot be hired. Agents with no measurements show as unrated and are scored from the pool average. `POST /api/agents/calibrate` does the same from the API. A demo reset keeps calibration data.

5. **Run:**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## Useful scripts

- `npm run db:seed` - reseed the agent registry + system wallets (non-destructive to existing tasks).
- `npm run db:reset` - wipe the database and reseed from scratch (same as clicking "Reset Demo" in the UI, or `POST /api/reset`).
- `npm test` - unit tests (no DB, no network): data engine, citations, planner/DAG, routing & budget, QA rubrics, rework routing, Circuit Breaker purposes.
- `npx tsx --env-file=.env scripts/smoke-capabilities.ts ["prompt"]` - live run of web research -> competitive analysis -> data analysis with QA (real Sarvam + live web, no DB writes).
- `npx tsx --env-file=.env scripts/smoke-task.ts ["prompt"] [budget] [quality]` - full task through the real orchestrator against `MONGODB_URI` (escrow, QA, review/rework, ledger); prints the timeline and report.
- `npm run agents:calibrate -- <agentId> ...` - calibrate only the listed agents (e.g. after adding one to the roster).

## Capabilities, tools and routing

The product is the workforce the Manager assembles, not the agent list. What the workforce can do is defined once in `lib/capabilities/catalog.ts`; the planner, router, Circuit Breaker, QA and dashboard all read it.

- **Planning** (`lib/manager/planner.ts`): the Manager LLM picks capabilities from the catalog; Kraven normalizes the result into a DAG (dependencies only on earlier steps, a synthesis step, exactly one final review) and fits it to the budget against live agent prices. Without a model, a signal-based planner builds the workflow.
- **Routing**: staged filter (availability, budget, downstream reserve so early hires cannot starve later steps, quality), deterministic score, and a value rule that hires the cheaper agent when the premium one is within 3 points.
- **Tools** (`lib/tools/`): `web_search` (registers every page as a citable `[S#]` source), `analyze_data` / `calculate` (deterministic statistics - no LLM arithmetic), `upstream_lookup` (structured artifacts from earlier steps). A capability may only call the tools the catalog lists for it.
- **Specialised runtimes** (`lib/capabilities/`): web research (sourced findings vs. model analysis, code-rendered source list), competitive analysis (structured profiles, SWOT, comparable metrics; "sourced" figures are checked against the cited page), data analysis (model chooses operations, engine computes, narrative figures are checked against the data), integration review (issues attributed to the step that must fix them).
- **QA and rework**: per-step QA runs capability-specific deterministic checks before the QA model (fabricated citations, untraceable figures, missing comparables fail regardless of prose quality) and sends specific feedback on retry. After the final review, blocking issues go back to the responsible step, everything downstream is re-run, and the review repeats (max 2 rounds); unresolved issues are disclosed on the report.

### Web search (self-hosted SearXNG)

Live research searches through a SearXNG instance you run (`docker-compose.searxng.yml`, config in `infra/searxng/settings.yml`: JSON output enabled, Google/Bing/DuckDuckGo/Brave/Startpage/Mojeek/Wikipedia). Copy `infra/searxng/searxng.env.example` to `infra/searxng/searxng.env` and set a secret, set `SEARXNG_URL=http://localhost:8888` in `.env`, then `docker compose --env-file infra/searxng/searxng.env -f docker-compose.searxng.yml up -d`.

Requests time out after 8s and retry up to 3 times with backoff on timeouts, network errors, 429 and 5xx. Every result carries `status: "ok" | "partial" | "unavailable"` plus which engines and pages succeeded or failed. When live research fails, the step reports the outage and stops: Kraven never answers a web-grounded step from the model's training knowledge, and downstream work is labeled unsourced.

## Demo flow

1. Submit the pre-filled fintech market-report task and watch the Manager plan → discover → filter → rank → construct a workforce → execute → QA → pay, live via SSE.
2. Click **Fire Rogue Agent Demo** to watch the Circuit Breaker block an oversized payout request in real time, with zero balance change.
3. Click **Reset Demo** for a clean state before the next run.
