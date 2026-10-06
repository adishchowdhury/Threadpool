import { db } from "@/lib/db/client";
import type { Source } from "@/lib/capabilities/sources";
import type { SubtaskArtifacts, UpstreamItem } from "@/lib/capabilities/types";

// Read-side helpers the orchestrator uses to give each worker its context:
// upstream outputs + artifacts, the task's retrieved sources, and the market
// price floor used for budget planning.

export function parseArtifacts(raw: string | null | undefined): SubtaskArtifacts | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as SubtaskArtifacts;
  } catch {
    return undefined;
  }
}

// Cheapest hireable listed price per capability, from the live registry.
export async function priceFloorByCapability(): Promise<Map<string, number>> {
  const agents = await db.agent.findMany({ where: { status: "ACTIVE" } });
  const floor = new Map<string, number>();
  for (const a of agents) {
    if (!(a.price > 0)) continue;
    for (const c of JSON.parse(a.capabilities) as string[]) {
      floor.set(c, Math.min(floor.get(c) ?? Infinity, a.price));
    }
  }
  return floor;
}

// Budget to hold back for the cheapest staffing of every step after `sequence`.
export function reserveForLaterSteps(
  subtasks: Array<{ sequence: number; requiredCapability: string }>,
  sequence: number,
  floor: ReadonlyMap<string, number>,
): number {
  return subtasks.filter((s) => s.sequence > sequence).reduce((sum, s) => sum + (floor.get(s.requiredCapability) ?? 0), 0);
}

type SubtaskRow = {
  id: string;
  sequence: number;
  type: string;
  requiredCapability: string;
  output: string | null;
  artifacts?: string | null;
  dependsOn: string;
};

export function toUpstreamItem(row: SubtaskRow): UpstreamItem {
  return {
    subtaskId: row.id,
    sequence: row.sequence,
    type: row.type,
    capability: row.requiredCapability,
    output: row.output ?? "",
    artifacts: parseArtifacts(row.artifacts),
  };
}

// The (current) outputs of the subtasks `subtask` depends on.
export async function loadUpstream(subtask: { dependsOn: string }): Promise<UpstreamItem[]> {
  const ids = JSON.parse(subtask.dependsOn) as string[];
  if (ids.length === 0) return [];
  const rows = (await db.subtask.findMany({ where: { id: { in: ids } }, orderBy: { sequence: "asc" } })) as SubtaskRow[];
  return rows.filter((r) => r.output).map(toUpstreamItem);
}

// Every source registered by any subtask of the task, by id.
export async function taskSources(taskId: string): Promise<Source[]> {
  const rows = (await db.subtask.findMany({ where: { taskId } })) as SubtaskRow[];
  const byId = new Map<string, Source>();
  for (const r of rows) for (const s of parseArtifacts(r.artifacts)?.sources ?? []) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}
