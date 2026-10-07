import { z } from "zod";
import { validateExternalEndpoint } from "@/lib/agents/externalSecurity";
import { decryptSecret } from "@/lib/agents/secrets";
import { clampTimeout, DeadlineExceededError } from "@/lib/runtime/deadline";

// The normalized contract every external agent must implement, called
// through the exact same path regardless of who the provider is:
//   POST {endpoint}/health   -> { status: "ok" }
//   POST {endpoint}/execute  -> { status: "completed"|"failed", output, metadata? }

const HEALTH_RESPONSE_SCHEMA = z.object({ status: z.string() });

const EXECUTE_RESPONSE_SCHEMA = z.object({
  status: z.enum(["completed", "failed"]),
  output: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

export interface ExternalAgentTarget {
  id: string;
  endpoint: string | null;
  externalAuthSecretEncrypted: string | null;
}

type FailureReason = "invalid_endpoint" | "timeout" | "unreachable" | "non_200" | "malformed_response" | "execution_failed";

export interface ExternalCallFailure {
  ok: false;
  reason: FailureReason;
  message: string;
}

function authHeaders(agent: ExternalAgentTarget): Record<string, string> {
  if (!agent.externalAuthSecretEncrypted) return {};
  try {
    return { Authorization: `Bearer ${decryptSecret(agent.externalAuthSecretEncrypted)}` };
  } catch {
    return {};
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function endpointOrFail(agent: ExternalAgentTarget): { base: string } | ExternalCallFailure {
  if (!agent.endpoint) return { ok: false, reason: "invalid_endpoint", message: "agent has no registered endpoint" };
  const check = validateExternalEndpoint(agent.endpoint);
  if (!check.valid) return { ok: false, reason: "invalid_endpoint", message: check.reason ?? "endpoint failed validation" };
  return { base: agent.endpoint.replace(/\/+$/, "") };
}

export interface ConnectionTestResult {
  endpointReachable: boolean;
  authenticationOk: boolean;
  responseValid: boolean;
  ok: boolean;
  message: string;
}

// §19: itemized checks for the Test Connection UI. Deliberately a cheap
// health check, not a full calibration run.
export async function testExternalConnection(agent: ExternalAgentTarget, timeoutMs = 10_000): Promise<ConnectionTestResult> {
  const endpoint = endpointOrFail(agent);
  if ("ok" in endpoint) {
    return { endpointReachable: false, authenticationOk: false, responseValid: false, ok: false, message: endpoint.message };
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(`${endpoint.base}/health`, { method: "POST", headers: authHeaders(agent) }, timeoutMs);
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    return {
      endpointReachable: false,
      authenticationOk: false,
      responseValid: false,
      ok: false,
      message: timedOut
        ? `Kraven could not reach your agent within ${Math.round(timeoutMs / 1000)} seconds.`
        : `Could not reach endpoint: ${err instanceof Error ? err.message : "network error"}`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { endpointReachable: true, authenticationOk: false, responseValid: false, ok: false, message: `Authentication failed (HTTP ${res.status})` };
  }
  if (!res.ok) {
    return { endpointReachable: true, authenticationOk: true, responseValid: false, ok: false, message: `Endpoint returned HTTP ${res.status}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { endpointReachable: true, authenticationOk: true, responseValid: false, ok: false, message: "Response was not valid JSON" };
  }
  const parsed = HEALTH_RESPONSE_SCHEMA.safeParse(body);
  if (!parsed.success || parsed.data.status !== "ok") {
    return { endpointReachable: true, authenticationOk: true, responseValid: false, ok: false, message: 'Expected { "status": "ok" } from /health' };
  }

  return { endpointReachable: true, authenticationOk: true, responseValid: true, ok: true, message: "Connection verified." };
}

export interface ExternalExecutionSuccess {
  ok: true;
  output: string;
  metadata?: Record<string, unknown>;
}

// §24/§25: the real task-execution round trip. Never throws for ordinary
// failure modes (timeout, unreachable, malformed, non-2xx, agent-reported
// failure) - callers (lib/manager/worker.ts) turn a failure result into the
// same shape a crashed internal worker produces, so retry/reassignment in
// the orchestrator needs no external-specific branches.
export async function executeExternalTask(
  agent: ExternalAgentTarget,
  params: { taskId: string; subtaskId: string; capability: string; prompt: string; constraints: { budget: number; deadline?: string | null } },
  timeoutMs = 45_000,
): Promise<ExternalExecutionSuccess | ExternalCallFailure> {
  const endpoint = endpointOrFail(agent);
  if ("ok" in endpoint) return endpoint;

  const payload = {
    taskId: params.taskId,
    subtaskId: params.subtaskId,
    capability: params.capability,
    prompt: params.prompt,
    constraints: params.constraints,
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${endpoint.base}/execute`,
      { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(agent) }, body: JSON.stringify(payload) },
      clampTimeout(timeoutMs),
    );
  } catch (err) {
    if (err instanceof DeadlineExceededError) return { ok: false, reason: "timeout", message: "not attempted: the execution segment ran out of time" };
    const timedOut = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      reason: timedOut ? "timeout" : "unreachable",
      message: timedOut ? `execution timed out after ${timeoutMs}ms` : err instanceof Error ? err.message : "network error",
    };
  }

  if (!res.ok) {
    return { ok: false, reason: "non_200", message: `agent endpoint returned HTTP ${res.status}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "malformed_response", message: "response was not valid JSON" };
  }

  const parsed = EXECUTE_RESPONSE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return { ok: false, reason: "malformed_response", message: `response did not match the expected contract: ${parsed.error.message}` };
  }

  if (parsed.data.status === "failed" || !parsed.data.output) {
    return { ok: false, reason: "execution_failed", message: parsed.data.error ?? "agent reported failure with no output" };
  }

  return { ok: true, output: parsed.data.output, metadata: parsed.data.metadata };
}
