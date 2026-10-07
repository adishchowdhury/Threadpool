// Pure (no DB) tenant-isolation and data-sensitivity rules for agent
// discovery. Every agent is in exactly one visibility class:
//
//   CERTIFIED    - built-in, benchmarked and maintained by Kraven; every org.
//   PRIVATE      - registered by one organization; only that org can route to it.
//   MARKETPLACE  - published by its owner after Kraven benchmarked it; every org.
//
// Rows written before this field existed have no `visibility`: built-ins are
// CERTIFIED, external agents fail closed to PRIVATE (never public by default).

export const AGENT_VISIBILITIES = ["CERTIFIED", "PRIVATE", "MARKETPLACE"] as const;
export type AgentVisibility = (typeof AGENT_VISIBILITIES)[number];

// How sensitive the data a task carries is. Decides which classes of agent
// may receive it.
//   PUBLIC    - any visible agent.
//   INTERNAL  - Kraven-certified agents and the org's own agents; never
//               third-party marketplace agents.
//   SENSITIVE - only the org's own private agents.
export const DATA_SENSITIVITIES = ["PUBLIC", "INTERNAL", "SENSITIVE"] as const;
export type DataSensitivity = (typeof DATA_SENSITIVITIES)[number];

export interface AccessSubject {
  id?: string;
  visibility?: AgentVisibility | null;
  isExternal?: boolean | null;
  providerId?: string | null;
}

export interface AccessScope {
  organizationId: string | null;
  dataSensitivity: DataSensitivity;
  // Agents the user explicitly allowed to receive THIS task's data despite the
  // sensitivity level. It widens only the data-sensitivity rule - an agent the
  // caller cannot see at all (another org's private agent) stays excluded.
  approvedAgentIds?: string[];
}

export function effectiveVisibility(agent: AccessSubject): AgentVisibility {
  if (agent.visibility && (AGENT_VISIBILITIES as readonly string[]).includes(agent.visibility)) return agent.visibility;
  return agent.isExternal ? "PRIVATE" : "CERTIFIED";
}

export type AccessDecision = { allowed: true } | { allowed: false; reason: "NOT_VISIBLE" | "DATA_SENSITIVITY" };

export function evaluateAgentAccess(agent: AccessSubject, scope: AccessScope): AccessDecision {
  const visibility = effectiveVisibility(agent);
  const ownedByCaller = Boolean(scope.organizationId) && agent.providerId === scope.organizationId;

  if (visibility === "PRIVATE" && !ownedByCaller) return { allowed: false, reason: "NOT_VISIBLE" };

  if (agent.id && scope.approvedAgentIds?.includes(agent.id)) return { allowed: true };

  if (scope.dataSensitivity === "SENSITIVE" && !(visibility === "PRIVATE" && ownedByCaller)) {
    return { allowed: false, reason: "DATA_SENSITIVITY" };
  }
  if (scope.dataSensitivity === "INTERNAL" && visibility === "MARKETPLACE" && !ownedByCaller) {
    return { allowed: false, reason: "DATA_SENSITIVITY" };
  }
  return { allowed: true };
}

export function partitionByAccess<T extends AccessSubject>(
  agents: T[],
  scope: AccessScope,
): { accessible: T[]; excluded: { notVisible: number; dataSensitivity: number } } {
  const accessible: T[] = [];
  const excluded = { notVisible: 0, dataSensitivity: 0 };
  for (const a of agents) {
    const d = evaluateAgentAccess(a, scope);
    if (d.allowed) accessible.push(a);
    else if (d.reason === "NOT_VISIBLE") excluded.notVisible++;
    else excluded.dataSensitivity++;
  }
  return { accessible, excluded };
}

// Browsing (marketplace/registry listing) is a weaker question than routing:
// a caller may see CERTIFIED + MARKETPLACE agents and their own org's agents.
export function canViewAgent(agent: AccessSubject, organizationId: string | null): boolean {
  return evaluateAgentAccess(agent, { organizationId, dataSensitivity: "PUBLIC" }).allowed;
}

// Publishing to the shared marketplace is gated on Kraven's own measurement,
// never on the developer's claims: the agent must have passed calibration
// (ACTIVE) and have measured samples behind its stats.
export function evaluatePublish(agent: {
  isExternal?: boolean | null;
  lifecycleStatus?: string | null;
  status?: string | null;
  sampleCount?: number | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!agent.isExternal) return { ok: false, reason: "Only organization-registered agents can be published." };
  if (agent.lifecycleStatus !== "ACTIVE" || agent.status !== "ACTIVE") {
    return { ok: false, reason: "The agent must pass Kraven benchmarking and be active before it can be published." };
  }
  if (!agent.sampleCount || agent.sampleCount < 1) {
    return { ok: false, reason: "The agent has no Kraven-measured benchmark results yet." };
  }
  return { ok: true };
}
