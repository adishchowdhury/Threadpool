# CLAUDE.md

# MOMENTUM --- Autonomous AI Workforce Optimizer

## 30-Hour Hackathon Build Contract

You are the lead engineer responsible for building **Momentum**.

Momentum is not a generic multi-agent chatbot.

It is an **AI workforce optimization and governance layer**:

> A user gives Momentum a task and a hard budget. A Gemini Manager
> understands the task, discovers suitable AI agents from an agent
> marketplace/registry, filters and ranks them using capability,
> quality, cost, latency, reliability and reputation, dynamically
> composes the best workforce/workflow, executes it, verifies the
> output, settles payment through escrow, records performance, and uses
> historical outcomes to improve future routing.

The system must be genuinely runnable and demonstrable in 30 hours.

------------------------------------------------------------------------

# 1. PRODUCT NORTH STAR

The user should not need to know:

-   which agents exist
-   which agents are good
-   how many agents are required
-   how the task should be decomposed
-   how agents should communicate
-   how much each agent should cost

The user gives:

``` text
Task
Budget
Quality threshold
Optional deadline
```

Momentum determines:

``` text
Task understanding
      ↓
Required capabilities
      ↓
Agent discovery
      ↓
Filtering
      ↓
Ranking
      ↓
Workforce selection
      ↓
Workflow composition
      ↓
Execution
      ↓
QA
      ↓
Escrow settlement
      ↓
Performance recording
      ↓
Workflow memory
      ↓
Better future routing
```

------------------------------------------------------------------------

# 2. PRIMARY DEMO

Default task:

> Analyze the fintech startup market, identify three promising segments,
> estimate key financial metrics, and produce a concise investment-style
> report.

Inputs:

``` text
Budget: 50 virtual tokens
Quality threshold: 80
Deadline: optional
```

The judge must see:

``` text
USER
 ↓
GEMINI MANAGER
 ↓
TASK UNDERSTANDING
 ↓
REQUIRED CAPABILITIES
 ↓
AGENT DISCOVERY
 ↓
FILTERING
 ↓
RANKING
 ↓
WORKFORCE FORMATION
 ↓
RFP / BIDS
 ↓
ESCROW
 ↓
WORKER EXECUTION
 ↓
QA
 ↓
PAYMENT
 ↓
REPUTATION
 ↓
WORKFLOW MEMORY
 ↓
FINAL REPORT
```

Then demonstrate:

``` text
Agent requests 10,000 tokens
Authorized amount: 8
        ↓
Circuit Breaker
        ↓
BLOCKED
        ↓
NO LEDGER MUTATION
```

------------------------------------------------------------------------

# 3. TECH STACK

Use this stack unless the existing repository already has a working
equivalent.

## Frontend

-   Next.js
-   React
-   TypeScript
-   Tailwind CSS
-   shadcn/ui where useful
-   Recharts only where charts genuinely help

## Backend

Use the Next.js server/API architecture.

Do **not** introduce FastAPI unless the existing repository already
depends on it.

Reason: this is a 30-hour TypeScript-heavy hackathon. Avoid maintaining
two backend ecosystems.

## AI

### Manager

Use **Gemini** as the primary Manager LLM.

Use structured JSON outputs.

### AI integration

Use:

-   Vercel AI SDK
-   Zod

Vercel AI SDK handles model interaction/tool calling. Zod validates all
model-generated structured data.

## Agent orchestration

Use **Mastra** for:

-   agent definitions
-   workflows
-   orchestration
-   memory where useful
-   tracing/evaluation where useful

Do not introduce LangChain, CrewAI, AutoGen, LangGraph, or another
orchestration framework unless the repository already requires one.

The core economic/routing logic must remain Momentum-owned.

## Database

Prefer:

-   PostgreSQL
-   Prisma

SQLite is acceptable as a local fallback if PostgreSQL setup becomes a
blocker.

All economic state must be persistent.

## Real-time

Prefer:

-   Server-Sent Events (SSE)

Use WebSockets only if the repository already has a stable WebSocket
implementation.

## Agent marketplace

Create an abstraction:

``` text
AgentDiscoveryProvider
```

with:

``` text
ExternalMarketplaceProvider
LocalRegistryProvider
```

The external provider can connect to an actual agent marketplace/API
when credentials are available.

The local provider guarantees the hackathon works without external
credentials.

## Economics

Custom TypeScript services:

``` text
WalletService
LedgerService
EscrowService
PaymentService
ReputationService
CircuitBreaker
```

Do not outsource financial correctness to an LLM or third-party agent
framework.

## Quantitative analysis

Optional:

-   Wolfram API
-   deterministic local calculation fallback

## Workflow automation

Optional:

-   n8n webhook

## Blockchain

Optional:

-   Algorand adapter

Blockchain is NOT the internal source of truth.

## Deployment

-   Vercel for the Next.js application
-   Neon/Supabase/Railway/Postgres provider for PostgreSQL

------------------------------------------------------------------------

# 4. ARCHITECTURE

``` text
                         USER
                           │
                           ▼
                  ┌─────────────────┐
                  │ GEMINI MANAGER  │
                  └────────┬────────┘
                           │
                    Understand task
                           │
                           ▼
                  ┌─────────────────┐
                  │ TASK PLANNER    │
                  └────────┬────────┘
                           │
                    Required skills
                           │
                           ▼
                  ┌─────────────────┐
                  │ AGENT DISCOVERY │
                  └────────┬────────┘
                           │
                External API / Local Registry
                           │
                           ▼
                  ┌─────────────────┐
                  │ ROUTING ENGINE  │
                  │                 │
                  │ capability      │
                  │ quality         │
                  │ cost            │
                  │ latency         │
                  │ reliability     │
                  │ reputation      │
                  │ availability    │
                  │ task similarity │
                  └────────┬────────┘
                           │
                    Optimal workforce
                           │
                           ▼
                  ┌─────────────────┐
                  │ WORKFLOW GRAPH  │
                  └────────┬────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ AGENT EXECUTION    │
                 └─────────┬──────────┘
                           │
                           ▼
                         QA
                           │
                           ▼
                  ECONOMIC ENGINE
                           │
                    Circuit Breaker
                           │
                           ▼
              ┌────────────────────────┐
              │ Wallet / Escrow /      │
              │ Ledger / Payment       │
              └───────────┬────────────┘
                          │
                          ▼
                     PERFORMANCE
                          │
                ┌─────────┴─────────┐
                ▼                   ▼
        Agent Performance      Workflow Memory
                │                   │
                └─────────┬─────────┘
                          ▼
                    Better Routing
```

------------------------------------------------------------------------

# 5. NON-NEGOTIABLE PRINCIPLE

## Gemini decides. Momentum enforces.

Gemini can produce an intent:

``` json
{
  "operation": "TRANSFER_FUNDS",
  "amount": 10000,
  "recipient": "atlas"
}
```

Momentum must independently determine whether that operation is legal.

Never allow:

``` text
LLM → database.write(balance)
```

Always:

``` text
LLM
 ↓
Structured intent
 ↓
Zod validation
 ↓
Authorization
 ↓
Circuit Breaker
 ↓
Economic service
 ↓
Database transaction
 ↓
Ledger
```

LLMs must NEVER directly mutate:

-   wallet balances
-   escrow
-   ledger
-   permissions
-   spending limits
-   reputation
-   authorization state

------------------------------------------------------------------------

# 6. AGENT DISCOVERY

Do not hard-code a permanent workforce.

Momentum should dynamically discover agents.

Normalize every provider into:

``` ts
type AgentCandidate = {
  id: string
  name: string
  provider: string
  role: string
  capabilities: string[]
  price: number
  estimatedLatencyMs: number
  qualityScore: number
  reputationScore: number
  successRate: number
  availability: boolean
  endpoint?: string
  protocol?: string
}
```

External provider output must never leak directly into the routing
engine.

Use:

``` text
External Agent API
       ↓
Provider Adapter
       ↓
AgentCandidate
       ↓
Momentum Router
```

If external discovery is unavailable:

``` text
LOCAL DEMO REGISTRY
```

must run the complete flow.

Never fake an external API call.

------------------------------------------------------------------------

# 7. TASK UNDERSTANDING

Gemini receives:

``` text
prompt
budget
qualityThreshold
deadline
```

and produces structured task requirements.

Example:

``` json
{
  "objective": "Analyze fintech startup market",
  "requirements": [
    "market segmentation",
    "competitive analysis",
    "financial metrics",
    "investment recommendations"
  ],
  "requiredCapabilities": [
    "market_research",
    "financial_analysis",
    "competitive_analysis",
    "report_writing",
    "quality_assurance"
  ],
  "maxBudget": 50,
  "qualityThreshold": 80
}
```

Validate using Zod.

Do not trust free-form model output.

------------------------------------------------------------------------

# 8. TASK DECOMPOSITION

Create real subtasks.

Example:

``` text
Market Research
Competitive Analysis
Financial Analysis
Report Synthesis
QA
```

Each subtask contains:

``` text
requiredCapabilities
dependencies
budgetLimit
qualityThreshold
deadline
```

Dependencies form a DAG.

Example:

``` text
Market Research ──────┐
                      ├──→ Report Writer → QA
Competitive Analysis ─┤
                      │
Financial Analysis ───┘
```

Do not allow arbitrary cycles.

------------------------------------------------------------------------

# 9. AGENT FILTERING

Discovery may return hundreds of agents.

Filter in stages:

``` text
All agents
 ↓
Capability compatibility
 ↓
Availability
 ↓
Budget feasibility
 ↓
Quality requirement
 ↓
Latency/deadline feasibility
 ↓
Protocol/tool compatibility
 ↓
Top candidates
```

Example:

``` text
1240 agents
 ↓
312 capability matches
 ↓
87 budget-compatible
 ↓
24 quality-compatible
 ↓
11 deadline-compatible
 ↓
Top 3-5 candidates
```

The filtering counts shown in UI must be generated from actual data.

------------------------------------------------------------------------

# 10. AGENT RANKING

Do not choose purely by cheapest price.

Baseline deterministic score:

``` text
capabilityMatch       30%
quality               20%
successRate           15%
reputation            10%
latencyEfficiency     10%
costEfficiency        10%
historicalSimilarity   5%
```

Formula:

``` text
score =
0.30 * capabilityMatch
+ 0.20 * quality
+ 0.15 * successRate
+ 0.10 * reputation
+ 0.10 * latencyEfficiency
+ 0.10 * costEfficiency
+ 0.05 * historicalSimilarity
```

Normalize all components to 0--1.

This must be deterministic and explainable.

------------------------------------------------------------------------

# 11. WORKFORCE OPTIMIZATION

The important optimization target is the **workflow**, not merely the
individual agent.

Example:

``` text
Workflow A

Researcher A
 ↓
Analyst B
 ↓
Writer C
 ↓
QA

Expected quality: 94
Expected cost: 11
Expected latency: 18 sec
Success probability: 96%
```

versus:

``` text
Workflow B

Researcher D
 ↓
Analyst F
 ↓
Writer C
 ↓
QA

Expected quality: 89
Expected cost: 7
Expected latency: 12 sec
Success probability: 90%
```

Select based on the user's constraints.

Baseline utility:

``` text
utility =
qualityWeight * expectedQuality
+ reliabilityWeight * successProbability
- costWeight * normalizedCost
- latencyWeight * normalizedLatency
```

For the hackathon, evaluate a bounded number of candidate workflows.

Do NOT build an expensive generalized optimization solver.

------------------------------------------------------------------------

# 12. RFP + BIDDING

For suitable subtasks, create an RFP.

RFP:

``` text
id
taskId
subtaskId
requiredCapabilities
maxBudget
deadline
qualityThreshold
createdAt
status
```

Bid:

``` text
bidId
rfpId
agentId
price
estimatedTime
confidence
proposal
createdAt
```

The Manager can use bids as one input into routing.

Do not automatically select the cheapest bid.

------------------------------------------------------------------------

# 13. NEGOTIATION

Optional P1.

Maximum:

``` text
3 rounds
```

Example:

``` text
Manager: Budget is 6.
Agent: My price is 8.
Manager: Can you reduce scope?
Agent: Yes, for 6.
Manager: Accepted.
```

Persist negotiation events.

No infinite loops.

------------------------------------------------------------------------

# 14. WORKFLOW EXECUTION

Every selected agent must execute through a normalized interface:

``` ts
execute(agent, task): Promise<AgentExecutionResult>
```

Result:

``` ts
{
  status,
  output,
  cost,
  latencyMs,
  metadata
}
```

Possible implementations:

``` text
External agent API
Local LLM worker
Gemini worker
Deterministic demo worker
```

All normalize into the same internal result type.

------------------------------------------------------------------------

# 15. QA

QA is independent from the worker.

Worker:

``` text
produce result
```

QA:

``` text
evaluate result
```

Structured result:

``` json
{
  "score": 91,
  "approved": true,
  "issues": [],
  "reason": "Meets the required quality threshold."
}
```

QA does NOT release money.

The deterministic payroll service decides whether payment is allowed.

------------------------------------------------------------------------

# 16. ECONOMY

Use virtual integer tokens.

Every agent has:

``` text
walletId
balance
lockedBalance
```

Never use floating-point values for token accounting.

The internal ledger is authoritative.

Every successful financial mutation creates a transaction.

------------------------------------------------------------------------

# 17. ESCROW

Example:

Manager:

``` text
50 tokens
```

Worker payment:

``` text
8 tokens
```

After escrow:

``` text
Manager available = 42
Escrow = 8
Worker = 0
```

After successful QA:

``` text
Escrow = 0
Worker = +8
```

After failed QA:

``` text
Worker = +0
```

Funds remain locked until the deterministic policy chooses
refund/rework/reassignment.

------------------------------------------------------------------------

# 18. LEDGER

Every transfer must contain:

``` text
id
fromWallet
toWallet
amount
type
status
taskId
timestamp
reason
```

Use database transactions.

Financial invariants:

1.  successful transfer decreases sender by X
2.  successful transfer increases recipient by X
3.  blocked transfer changes nothing
4.  escrow cannot be released twice
5.  payment cannot exceed escrow
6.  duplicate payment is rejected
7.  expired authorization cannot spend
8.  unauthorized agents cannot spend
9.  every financial mutation has a transaction
10. total token supply remains consistent

------------------------------------------------------------------------

# 19. CIRCUIT BREAKER

Mandatory.

All sensitive operations pass through:

``` text
CircuitBreaker
```

Operations:

``` text
CREATE_ESCROW
RELEASE_ESCROW
TRANSFER_FUNDS
MODIFY_BUDGET
WITHDRAW_FUNDS
```

Checks:

``` text
caller authorized?
wallet valid?
recipient valid?
task valid?
task active?
amount positive?
amount within scope?
credential valid?
credential expired?
credential reused?
escrow valid?
payment <= escrow?
duplicate transaction?
spending limit exceeded?
```

Fail closed.

------------------------------------------------------------------------

# 20. SCOPED AUTHORIZATION

Create a per-task credential:

``` json
{
  "credentialId": "cred_123",
  "taskId": "task_42",
  "maxSpend": 8,
  "allowedOperations": ["CREATE_ESCROW"],
  "expiresAt": "...",
  "used": false
}
```

It cannot:

-   exceed maxSpend
-   work on another task
-   authorize unrelated operations
-   be reused indefinitely

------------------------------------------------------------------------

# 21. ROGUE TRANSACTION

Mandatory demo.

``` text
Atlas authorized:
8 tokens

Atlas requests:
10,000 tokens
```

Result:

``` text
Circuit Breaker
 ↓
BLOCKED
 ↓
Security event
 ↓
No wallet mutation
 ↓
No ledger transfer
```

UI:

``` text
🚨 CIRCUIT BREAKER TRIGGERED

Agent:
Atlas

Requested:
10,000

Authorized:
8

Result:
BLOCKED

Ledger:
UNCHANGED
```

This must be a real backend rejection.

------------------------------------------------------------------------

# 22. BAD WORKER

Seed:

``` text
Rogue Analyst
Reputation: 18
Price: 2
```

Make its demo output intentionally poor.

QA:

``` text
score: 32
approved: false
```

Result:

``` text
payment: 0
state: REWORK_REQUIRED
```

This demonstrates performance-based economics.

------------------------------------------------------------------------

# 23. REPUTATION

Start agents with realistic reputations.

After QA:

``` text
score >= 90 → +2
80–89 → +1
60–79 → 0
40–59 → -2
<40 → -3
```

Track:

``` text
tasksCompleted
tasksFailed
averageQuality
averageLatency
averageCost
successRate
totalEarned
```

Reputation becomes a routing feature.

------------------------------------------------------------------------

# 24. PERFORMANCE HISTORY

Store every execution:

``` text
agentId
taskId
taskType
capabilities
price
actualCost
expectedLatency
actualLatency
qualityScore
success
failureReason
timestamp
```

Aggregate into:

``` text
Expected quality
Expected cost
Expected latency
Success probability
```

This is the data foundation for future learning.

------------------------------------------------------------------------

# 25. WORKFLOW MEMORY

Store successful workflows:

``` text
workflowId
taskType
taskFeatures
subtasks
agentIds
sequence
dependencies
cost
latency
quality
success
createdAt
```

For future tasks:

``` text
New task
 ↓
Find similar tasks
 ↓
Retrieve historical workflows
 ↓
Compare predicted performance
 ↓
Reuse or adapt
```

Do not call this "pre-trained weights."

Call it:

``` text
Workflow Memory
Agent Experience
Performance Model
```

------------------------------------------------------------------------

# 26. LEARNING ROADMAP

Do NOT train a neural network during the 30-hour hackathon.

MVP:

``` text
Historical executions
 ↓
Features
 ↓
Deterministic routing score
```

Future:

``` text
Historical executions
 ↓
Performance prediction model
 ↓
Expected quality/cost/latency/success
 ↓
Workflow optimization
```

Potential future model:

``` text
f(taskFeatures, agentFeatures, workflowFeatures)
→ expected outcome
```

Only call something "trained weights" if an actual training/fine-tuning
pipeline exists.

------------------------------------------------------------------------

# 27. REAL-TIME EVENTS

Persist events:

``` text
TASK_CREATED
TASK_DECOMPOSED
REQUIREMENTS_IDENTIFIED
AGENTS_DISCOVERED
AGENTS_FILTERED
AGENTS_RANKED
WORKFLOW_PROPOSED
RFP_CREATED
BID_RECEIVED
AGENT_SELECTED
ESCROW_LOCKED
WORK_STARTED
WORK_COMPLETED
QA_STARTED
QA_PASSED
QA_FAILED
PAYMENT_REQUESTED
TRANSACTION_APPROVED
TRANSACTION_BLOCKED
PAYMENT_RELEASED
PAYMENT_REFUNDED
REPUTATION_UPDATED
PERFORMANCE_RECORDED
WORKFLOW_STORED
WORKFLOW_REUSED
CIRCUIT_BREAKER_TRIGGERED
TASK_COMPLETED
```

Use SSE to stream them to the dashboard.

No fake frontend-only events.

------------------------------------------------------------------------

# 28. MAIN UI

Visual direction:

**AI Workforce Command Center × Economic Simulation**

Use:

-   dark background
-   strong typography
-   subtle glass panels
-   high information density
-   monospace logs
-   dynamic agent graph
-   animated communication
-   token movement
-   clear security status

Do not make it look like a generic admin dashboard.

------------------------------------------------------------------------

# 29. TASK UI

Show:

``` text
What should the AI workforce accomplish?

[ large prompt ]

Maximum Budget
[ 50 ]

Quality Threshold
[ 80 ]

Deadline
[ optional ]

[ BUILD WORKFORCE ]
```

Preset:

``` text
Fintech Market Analysis
```

------------------------------------------------------------------------

# 30. WORKFORCE FORMATION UI

This is a core differentiator.

After submission:

``` text
UNDERSTANDING TASK

✓ Market research
✓ Financial analysis
✓ Competitive intelligence
✓ Report writing
✓ Quality assurance
```

Then:

``` text
DISCOVERING AGENTS

1240 agents found
 ↓
Capability filter
 ↓
312
 ↓
Budget filter
 ↓
87
 ↓
Quality filter
 ↓
24
 ↓
Latency filter
 ↓
11
```

Then:

``` text
OPTIMIZING WORKFORCE

Workflow A
Quality: 94
Cost: 11
Latency: 18s

Workflow B
Quality: 89
Cost: 7
Latency: 12s

SELECTED:
Workflow A
```

Only display values calculated by the system.

------------------------------------------------------------------------

# 31. AGENT NETWORK

Agents should appear dynamically based on the selected workflow.

Example:

``` text
                 MERCURY
                  MANAGER
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       ATLAS       ORION       NOVA
     Researcher   Analyst      Writer
          │          │          │
          └──────────┼──────────┘
                     ▼
                  GUARDIAN
                     QA
```

Animate actual event-driven communication.

Do not display a permanently fixed organization.

------------------------------------------------------------------------

# 32. MARKETPLACE PANEL

Show:

``` text
Agent
Role
Capabilities
Price
Expected latency
Quality
Success rate
Reputation
Availability
Routing score
```

Example:

``` text
ATLAS

Researcher

4 tokens
12 sec
91 quality
97% success
91 reputation

Routing score:
0.93
```

------------------------------------------------------------------------

# 33. ECONOMIC DASHBOARD

Show:

``` text
Total economy
Circulating tokens
Escrowed tokens
Total paid
Total earned
Transactions
Blocked transactions
Average task cost
Average task quality
```

Add charts only after the core flow is stable.

------------------------------------------------------------------------

# 34. LEDGER VIEW

Columns:

``` text
Time
From
To
Amount
Type
Status
```

Show both completed and blocked transactions.

------------------------------------------------------------------------

# 35. SECURITY PANEL

Show:

``` text
SYSTEM SECURE

Authorized spend:
14 / 50

Blocked attempts:
1

Latest:

Atlas attempted
10,000-token transfer

Authorized:
8

BLOCKED
```

Backend state is the source of truth.

------------------------------------------------------------------------

# 36. WORKFLOW MEMORY UI

Show when historical data is actually available:

``` text
SIMILAR WORKFLOW FOUND

Similarity:
94%

Historical quality:
93

Historical cost:
11

Historical latency:
17s

Success rate:
97%

[ REUSE / ADAPT ]
```

Do not fabricate historical statistics.

------------------------------------------------------------------------

# 37. AGENT DETAILS

Click an agent and show:

``` text
Name
Role
Capabilities
Provider
Reputation
Success rate
Average quality
Average latency
Average cost
Tasks completed
Total earned
Current task
Permissions
Recent transactions
```

------------------------------------------------------------------------

# 38. FINAL RESULT

Show:

``` text
FINAL DELIVERABLE

Executive Summary
Market Segments
Financial Metrics
Competitive Landscape
Risks
Recommendations

Workforce:
Atlas
Orion
Nova
Guardian

Total Cost:
...

Quality:
91/100

Latency:
...

Budget Remaining:
...
```

The final report must be assembled from actual worker outputs.

------------------------------------------------------------------------

# 39. DEMO MODE

Create:

``` text
DEMO MODE
```

It must run the real pipeline.

It may use deterministic providers if external services are unavailable.

It must NOT bypass:

-   discovery
-   filtering
-   ranking
-   workflow formation
-   escrow
-   execution
-   QA
-   payment
-   reputation
-   Circuit Breaker
-   ledger
-   event persistence

Demo Mode is a faster trigger for the real pipeline, not a fake
animation.

------------------------------------------------------------------------

# 40. OPTIONAL INTEGRATIONS

## Wolfram

Use:

``` text
calculateWithWolfram(expression)
```

Fallback:

``` text
local deterministic calculation
```

Label source accurately.

## n8n

On task completion:

``` text
POST /api/integrations/n8n/task-completed
```

Payload:

``` json
{
  "event": "TASK_COMPLETED",
  "taskId": "...",
  "qualityScore": 91,
  "payment": 8
}
```

Fallback cleanly.

## Algorand

Create:

``` text
AlgorandSettlementAdapter
```

Methods:

``` text
mirrorTransaction()
getTransactionStatus()
```

Internal ledger remains authoritative.

Do not make blockchain a dependency for the demo.

------------------------------------------------------------------------

# 41. DATABASE

Minimum tables:

``` text
agents
agent_capabilities
agent_providers
wallets
tasks
subtasks
rfps
bids
workflow_candidates
workflow_executions
escrows
transactions
qa_reviews
reputations
agent_performance
workflow_memory
events
security_events
authorization_credentials
```

Optional:

``` text
agent_messages
negotiations
tool_calls
integration_events
```

Use foreign keys and indexes.

------------------------------------------------------------------------

# 42. API

Minimum:

``` text
POST /api/tasks
GET  /api/tasks/:id
POST /api/tasks/:id/start

GET  /api/agents
GET  /api/marketplace/agents

POST /api/agents/discover
POST /api/rfps
POST /api/bids
POST /api/bids/:id/accept

POST /api/workflows/optimize
POST /api/workflows/:id/execute

POST /api/escrow
POST /api/work/:id/submit
POST /api/qa/:id/review
POST /api/payments/release

GET /api/wallets/:id
GET /api/ledger
GET /api/events

POST /api/security/validate-transaction
```

All inputs validated.

------------------------------------------------------------------------

# 43. AGENT PROVIDER INTERFACE

Create a stable abstraction:

``` ts
interface AgentProvider {
  discover(query: AgentDiscoveryQuery): Promise<AgentCandidate[]>
  execute(
    agent: AgentCandidate,
    task: AgentTask
  ): Promise<AgentExecutionResult>
}
```

External providers implement this interface.

The routing engine depends only on this interface.

------------------------------------------------------------------------

# 44. AI PROVIDER FALLBACK

Create:

``` text
GeminiManagerProvider
DemoManagerProvider
```

If Gemini credentials are missing:

``` text
DEMO FALLBACK
```

The deterministic provider must still create:

-   task requirements
-   subtasks
-   candidate selection
-   worker outputs
-   QA
-   final report

Never falsely claim Gemini ran.

------------------------------------------------------------------------

# 45. ERROR HANDLING

Never show blank screens.

Every failed operation should produce:

``` text
human-readable error
structured log
event
safe state transition
```

Example:

``` text
External marketplace unavailable
 ↓
Local registry fallback
 ↓
AGENT_DISCOVERY_FALLBACK_USED
```

The system must remain usable.

------------------------------------------------------------------------

# 46. OBSERVABILITY

Expose:

``` text
task timeline
agent discovery count
filter counts
routing scores
workflow candidates
selected workflow
tool calls
latency
cost
QA score
payment
reputation
security decisions
workflow reuse
```

For every Manager selection, show safe reasoning metadata:

``` text
Capability match: 96%
Quality: 93
Success rate: 98%
Cost: 4
Latency: 10 sec

Reason:
High capability match and reliability outweighed
the slightly higher cost.
```

Never expose hidden chain-of-thought.

------------------------------------------------------------------------

# 47. OPTIMIZATION METRICS

Track:

``` text
Task success rate
Average quality
Average cost
Average latency
Agent success rate
Agent utilization
Workflow success rate
Workflow reuse rate
Budget savings
```

Useful judge metric:

``` text
Optimization Gain
```

If calculated:

``` text
Naive workflow:
Cost: 16
Quality: 87
Latency: 24s

Momentum:
Cost: 11
Quality: 93
Latency: 17s
```

Never invent these numbers.

------------------------------------------------------------------------

# 48. 30-HOUR BUILD ORDER

## Hours 0--2

Inspect repository, architecture, dependencies, DB and existing
integrations.

Checkpoint:

``` text
App starts.
DB works.
```

## Hours 2--5

Build:

``` text
agents
capabilities
wallets
ledger
transactions
tasks
```

Checkpoint:

``` text
Financial tests pass.
```

## Hours 5--8

Build:

``` text
agent discovery
local registry
task understanding
task decomposition
filtering
ranking
```

Checkpoint:

``` text
Task → candidates → ranked agents.
```

## Hours 8--11

Build:

``` text
workflow graph
workflow candidates
workflow optimization
RFP
bids
selection
```

Checkpoint:

``` text
Manager dynamically forms workforce.
```

## Hours 11--14

Build:

``` text
agent execution
result passing
QA
rework
```

Checkpoint:

``` text
Research → analysis → writing → QA.
```

## Hours 14--17

Build:

``` text
escrow
payroll
reputation
Circuit Breaker
scoped authorization
rogue attack
```

Checkpoint:

``` text
10,000-token attack is blocked.
```

## Hours 17--21

Build:

``` text
task UI
workforce UI
agent graph
marketplace
event stream
ledger
economy
security
```

Checkpoint:

``` text
Judge can understand the system visually.
```

## Hours 21--24

Build:

``` text
performance history
workflow memory
workflow reuse
demo reset
```

Checkpoint:

``` text
Similar task can reuse historical workflow data.
```

## Hours 24--26

Optional:

``` text
external marketplace
Wolfram
n8n
Algorand
```

If integrations threaten stability, stop.

## Hours 26--28

Run:

``` text
clean install
database reset
seed
typecheck
tests
build
full demo
```

Fix critical issues.

## Hours 28--30

FREEZE.

No new features.

Only fix:

``` text
crashes
security bugs
economic bugs
broken demo
build failures
obvious UI issues
```

------------------------------------------------------------------------

# 49. TEAM SPLIT

### AI / Manager Engineer

Own:

-   Gemini Manager
-   task understanding
-   decomposition
-   orchestration
-   structured outputs

### Agent / Marketplace Engineer

Own:

-   provider abstraction
-   discovery
-   filtering
-   ranking
-   workflow formation
-   external agent adapters

### Economy / Security Engineer

Own:

-   wallets
-   ledger
-   escrow
-   payroll
-   reputation
-   Circuit Breaker
-   authorization
-   tests

### Frontend Engineer

Own:

-   dashboard
-   workforce formation UI
-   agent graph
-   marketplace
-   event stream
-   ledger
-   security
-   workflow memory
-   final report

Shared contract:

``` text
Stable agent IDs
Stable task IDs
Normalized AgentCandidate
Normalized AgentExecutionResult
Every financial mutation → ledger
Every blocked financial operation → security event
Every major state change → event
```

------------------------------------------------------------------------

# 50. TESTING

Test:

## Discovery

-   capability filtering
-   availability filtering
-   budget filtering
-   quality filtering
-   latency filtering
-   provider normalization

## Routing

-   deterministic scoring
-   workflow candidate generation
-   budget constraints
-   quality constraints
-   deadline constraints

## Economy

-   wallet creation
-   escrow lock
-   payout
-   refund
-   duplicate payment
-   insufficient balance

## Security

-   oversized transfer blocked
-   blocked transfer has zero balance mutation
-   expired credential blocked
-   wrong task blocked
-   unauthorized agent blocked
-   revoked wallet blocked

## Workflow

-   task creation
-   decomposition
-   discovery
-   workforce formation
-   execution
-   QA
-   payment
-   reputation
-   workflow memory

## Fallback

-   missing Gemini
-   missing external marketplace
-   missing Wolfram
-   missing n8n
-   missing Algorand

------------------------------------------------------------------------

# 51. WHAT NOT TO BUILD

Do NOT spend core hackathon time on:

-   real-money payments
-   banking APIs
-   dozens of locally coded agents
-   arbitrary code generation by agents
-   full blockchain economy
-   infinite agent loops
-   complex tokenomics
-   training a neural network
-   fine-tuning models
-   sophisticated auctions
-   Kubernetes
-   unnecessary microservices
-   production billing
-   complicated auth
-   elaborate analytics

The differentiated code should be:

``` text
Agent Discovery
+
Workforce Optimization
+
Economic Governance
+
Performance Learning
```

------------------------------------------------------------------------

# 52. ENGINEERING RULES

1.  Inspect before changing.
2.  Reuse existing code.
3.  Do not rewrite the repository unnecessarily.
4.  Build P0 first.
5.  Keep financial logic deterministic.
6.  Treat all LLM output as untrusted.
7.  Normalize external APIs behind adapters.
8.  Never fake an integration.
9.  Never let frontend state be authoritative for money.
10. Never let LLMs directly mutate financial state.
11. Test every financial mutation.
12. Run typecheck after meaningful changes.
13. Run relevant tests after each subsystem.
14. Keep the app runnable without external credentials.
15. Clearly label fallback mode.
16. Avoid unrelated refactors.
17. Avoid dependency sprawl.
18. Prefer a working vertical slice over theoretical completeness.
19. Freeze when the demo becomes stable.
20. Never claim a feature works until verified.

------------------------------------------------------------------------

# 53. CLAUDE WORK LOOP

For each task:

``` text
1. Inspect repository.
2. Identify affected modules.
3. Reuse existing architecture.
4. Implement smallest vertical slice.
5. Run typecheck.
6. Run relevant tests.
7. Run build when appropriate.
8. Fix errors.
9. Verify actual database/state mutation.
10. Continue.
```

Never stop after merely generating files.

------------------------------------------------------------------------

# 54. FIRST ACTION

Before coding:

``` text
inspect repository
inspect package.json
inspect frontend
inspect backend/server routes
inspect database
inspect environment
inspect existing agent integrations
inspect existing UI
```

Then determine the shortest path to the P0 vertical slice.

Do not blindly initialize a new project.

------------------------------------------------------------------------

# 55. DEFINITION OF DONE

A clean reset must support:

-   [ ] App starts
-   [ ] Database initializes
-   [ ] Seed works
-   [ ] User submits task
-   [ ] Gemini Manager understands task
-   [ ] Required capabilities generated
-   [ ] Agents discovered
-   [ ] Agents filtered
-   [ ] Agents ranked
-   [ ] Workforce dynamically selected
-   [ ] Workflow created
-   [ ] RFP/bids work
-   [ ] Escrow locks funds
-   [ ] Agents execute
-   [ ] Results flow between agents
-   [ ] QA evaluates
-   [ ] Passing work gets paid
-   [ ] Failed work does not get paid
-   [ ] Reputation updates
-   [ ] Performance history stored
-   [ ] Workflow memory stored
-   [ ] Ledger records every financial mutation
-   [ ] Circuit Breaker blocks unauthorized spending
-   [ ] 10,000-token attack is blocked
-   [ ] Blocked transaction changes no balance
-   [ ] Live event stream works
-   [ ] Final report is generated
-   [ ] Demo can be repeated
-   [ ] External integrations fail transparently
-   [ ] No fake success states
-   [ ] No critical TypeScript errors
-   [ ] No broken routes

------------------------------------------------------------------------

# 56. FINAL JUDGE STORY

Use this narrative:

> "You give Momentum a business problem and a hard budget. Gemini acts
> as the Manager. It understands the task and determines which
> capabilities are required. Momentum searches an agent ecosystem,
> filters and ranks available agents using capability, quality,
> reliability, cost and latency, and constructs an optimized AI
> workforce. Those agents execute the workflow under a scoped economic
> contract. Funds are locked in escrow, work is independently verified,
> and payment is released only when the result meets the agreed quality.
> Every execution becomes performance data, so Momentum gets better at
> choosing agents and workflows over time. And if an agent attempts to
> spend beyond its authorization, the deterministic Circuit Breaker
> blocks it before the ledger changes."

------------------------------------------------------------------------

# 57. THE THREE LAYERS

## Intelligence

``` text
Gemini
+
Agent discovery
+
Routing
+
Workflow planning
```

## Economics

``` text
Budget
+
Bids
+
Escrow
+
Payments
+
Reputation
```

## Trust

``` text
QA
+
Circuit Breaker
+
Scoped authorization
+
Ledger
+
Optional blockchain settlement
```

Above all of them:

``` text
Historical Experience
        ↓
Performance Model
        ↓
Better Routing
        ↓
Better Workforce
```

------------------------------------------------------------------------

# 58. FINAL PRODUCT PRINCIPLE

Momentum should eventually become a system that learns:

> **Given this task, this budget, this quality requirement and this
> deadline, what is the most efficient AI workforce I can assemble?**

That is the long-term product.

The 30-hour hackathon version only needs to prove the loop:

``` text
TASK
 ↓
DISCOVER
 ↓
FILTER
 ↓
RANK
 ↓
FORM WORKFORCE
 ↓
EXECUTE
 ↓
QA
 ↓
ESCROW
 ↓
PAY
 ↓
RECORD EXPERIENCE
 ↓
REUSE / IMPROVE
```

**The agents should be real.\
The selection should be explainable.\
The economy should be real.\
The security should be real.\
The learning loop should be real.\
The demo should be undeniable.**

BEGIN IMPLEMENTATION NOW.
