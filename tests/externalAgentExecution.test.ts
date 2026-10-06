import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { testExternalConnection, executeExternalTask } from "@/lib/agents/externalClient";
import { encryptSecret } from "@/lib/agents/secrets";

// Exercises the real fetch/timeout/auth code in lib/agents/externalClient.ts
// against a genuine, separate HTTP server implementing Kraven's external
// agent contract (POST /health, POST /execute) - not mocked. Loopback is
// allowed by validateExternalEndpoint outside production (NODE_ENV here is
// "test"/undefined under `tsx --test`), matching how local dev/the bundled
// demo agent work.

type Mode = "ok" | "unauthorized" | "malformed" | "failed" | "timeout" | "slow_but_ok";

function startServer(mode: Mode, expectedToken?: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    if (expectedToken && req.headers.authorization !== `Bearer ${expectedToken}`) {
      res.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;

    if (req.url === "/health") {
      if (mode === "unauthorized") return void res.writeHead(401).end();
      return void res.end(JSON.stringify({ status: "ok" }));
    }

    if (req.url === "/execute") {
      if (mode === "timeout") {
        // Never respond - the client's own timeout must fire.
        return;
      }
      if (mode === "malformed") return void res.end("not json{{{");
      if (mode === "failed") return void res.end(JSON.stringify({ status: "failed", error: "could not complete the task" }));
      if (mode === "slow_but_ok") {
        await new Promise((r) => setTimeout(r, 50));
      }
      return void res.end(JSON.stringify({ status: "completed", output: `handled: ${body?.capability}`, metadata: { tokens: 42 } }));
    }

    res.writeHead(404).end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test("testExternalConnection succeeds against a real /health endpoint", async () => {
  const { url, close } = await startServer("ok");
  try {
    const result = await testExternalConnection({ id: "a", endpoint: url, externalAuthSecretEncrypted: null });
    assert.equal(result.ok, true);
    assert.equal(result.endpointReachable, true);
    assert.equal(result.responseValid, true);
  } finally {
    await close();
  }
});

test("testExternalConnection reports an authentication failure distinctly", async () => {
  const { url, close } = await startServer("unauthorized");
  try {
    const result = await testExternalConnection({ id: "a", endpoint: url, externalAuthSecretEncrypted: null });
    assert.equal(result.ok, false);
    assert.equal(result.authenticationOk, false);
  } finally {
    await close();
  }
});

test("executeExternalTask sends the decrypted auth header and the agent validates it", async () => {
  const { url, close } = await startServer("ok", "s3cr3t-token");
  try {
    const agent = { id: "a", endpoint: url, externalAuthSecretEncrypted: encryptSecret("s3cr3t-token") };
    const result = await executeExternalTask(agent, {
      taskId: "t1",
      subtaskId: "s1",
      capability: "market_research",
      prompt: "test",
      constraints: { budget: 10 },
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.match(result.output, /handled: market_research/);
  } finally {
    await close();
  }
});

test("executeExternalTask fails cleanly (never throws) on a malformed response", async () => {
  const { url, close } = await startServer("malformed");
  try {
    const result = await executeExternalTask(
      { id: "a", endpoint: url, externalAuthSecretEncrypted: null },
      { taskId: "t1", subtaskId: "s1", capability: "market_research", prompt: "test", constraints: { budget: 10 } },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "malformed_response");
  } finally {
    await close();
  }
});

test("executeExternalTask surfaces an agent-reported failure without throwing", async () => {
  const { url, close } = await startServer("failed");
  try {
    const result = await executeExternalTask(
      { id: "a", endpoint: url, externalAuthSecretEncrypted: null },
      { taskId: "t1", subtaskId: "s1", capability: "market_research", prompt: "test", constraints: { budget: 10 } },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "execution_failed");
  } finally {
    await close();
  }
});

test("executeExternalTask times out instead of hanging forever", async () => {
  const { url, close } = await startServer("timeout");
  try {
    const result = await executeExternalTask(
      { id: "a", endpoint: url, externalAuthSecretEncrypted: null },
      { taskId: "t1", subtaskId: "s1", capability: "market_research", prompt: "test", constraints: { budget: 10 } },
      200,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "timeout");
  } finally {
    await close();
  }
});

test("executeExternalTask rejects an endpoint that fails SSRF validation before ever making a request", async () => {
  const result = await executeExternalTask(
    { id: "a", endpoint: "http://169.254.169.254/execute", externalAuthSecretEncrypted: null },
    { taskId: "t1", subtaskId: "s1", capability: "market_research", prompt: "test", constraints: { budget: 10 } },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_endpoint");
});
