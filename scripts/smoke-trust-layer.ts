import {
  canonicalJsonStringify,
  computeSha256,
  commitWorkflowEvent,
  verifyWorkflowEvent,
} from "../lib/blockchain/algorandTrust";
import { prisma } from "../lib/prisma";

async function runTests() {
  console.log("=== RUNNING ALGORAND TRUST LAYER SMOKE TESTS ===");

  // Test 1: Canonical hashing produces identical hash for equivalent inputs
  console.log("\n[Test 1] Canonical JSON Stringify & Hashing...");
  const objA = { z: 1, a: 2, m: { y: 10, x: 20 } };
  const objB = { a: 2, z: 1, m: { x: 20, y: 10 } }; // Keys in different order
  
  const canonicalA = canonicalJsonStringify(objA);
  const canonicalB = canonicalJsonStringify(objB);
  
  const hashA = computeSha256(canonicalA);
  const hashB = computeSha256(canonicalB);
  
  if (hashA === hashB) {
    console.log("✓ PASS: Equivalent inputs with different key ordering produced the same hash!");
  } else {
    throw new Error("FAIL: Key order variations produced different hashes!");
  }

  // Test 2: Tampered payload produces different hash
  console.log("\n[Test 2] Tampered Payload Hash...");
  const objTampered = { ...objA, z: 2 }; // Modified value
  const hashTampered = computeSha256(canonicalJsonStringify(objTampered));
  
  if (hashA !== hashTampered) {
    console.log("✓ PASS: Tampered payload successfully generated a different hash!");
  } else {
    throw new Error("FAIL: Tampered payload generated the same hash!");
  }

  // Create a real task in the database first to satisfy foreign key constraints
  const testTask = await prisma.task.create({
    data: {
      prompt: "Test query for trust layer verification",
      budget: 5000,
      remainingBudget: 5000,
      status: "IN_PROGRESS",
    },
  });

  const testWorkflowId = testTask.id;

  try {
    // Test 3: Commit and verify valid event
    console.log("\n[Test 3] Committing and Verifying Valid Event...");
    const payload = { result: "Fintech report contents", qualityScore: 92 };

    const commitResult = await commitWorkflowEvent({
      workflowId: testWorkflowId,
      taskId: testTask.id,
      eventType: "RESULT_COMMITTED",
      fromAgentId: "research-agent",
      toAgentId: "qa-agent",
      payload,
    });

    console.log(`Anchor Status: ${commitResult.status}, Hash: ${commitResult.payloadHash}`);

    const verificationResult = await verifyWorkflowEvent(
      testWorkflowId,
      "RESULT_COMMITTED",
      payload
    );

    if (verificationResult.success) {
      console.log("✓ PASS: Verification succeeded for untampered payload!");
    } else {
      throw new Error(`FAIL: Verification failed: ${verificationResult.error}`);
    }

    // Test 4: Verify tampered payload fails integrity check
    console.log("\n[Test 4] Verifying Tampered Event Fails Integrity Check...");
    const tamperedPayload = { result: "Modified fintech report contents", qualityScore: 92 };

    const verificationTamperedResult = await verifyWorkflowEvent(
      testWorkflowId,
      "RESULT_COMMITTED",
      tamperedPayload
    );

    if (!verificationTamperedResult.success) {
      console.log(`✓ PASS: Correctly failed verification with error: "${verificationTamperedResult.error}"`);
    } else {
      throw new Error("FAIL: Verification succeeded unexpectedly for a tampered payload!");
    }

    // Test 5: Verify event history logging in SQLite database
    console.log("\n[Test 5] Verify event logs in local SQLite database...");
    const log = await prisma.blockchainWorkflowEvent.findFirst({
      where: { workflowId: testWorkflowId },
    });

    if (log) {
      console.log(`✓ PASS: Found stored event in local database. Status: ${log.status}, TxId: ${log.transactionId}`);
    } else {
      throw new Error("FAIL: Workflow event was not logged in the database!");
    }
  } finally {
    // Teardown the testing task and events to leave the database clean
    await prisma.event.deleteMany({ where: { taskId: testTask.id } });
    await prisma.blockchainWorkflowEvent.deleteMany({ where: { taskId: testTask.id } });
    await prisma.task.delete({ where: { id: testTask.id } });
  }

  console.log("\n=== ALL SMOKE TESTS COMPLETED SUCCESSFULLY ===");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
