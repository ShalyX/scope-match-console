import assert from "node:assert/strict";
import test from "node:test";
import {
  explorerTransactionUrl,
  parseSourceSnapshot,
  sortedContractValues,
  validateDeliverables,
  validateHttpsUrl,
  validateId,
} from "../.test-output/validation.js";
import { parsePendingTransaction, serializePendingTransaction } from "../.test-output/transactions.js";

test("accepts contract-compatible IDs and rejects unsafe IDs", () => {
  assert.equal(validateId("grant-2026-round", "Program ID"), null);
  assert.match(validateId("Grant round", "Program ID"), /lowercase/);
});

test("requires public HTTPS artifacts", () => {
  assert.equal(validateHttpsUrl("https://github.com/org/repo", "Proposal artifact"), null);
  assert.match(validateHttpsUrl("http://localhost:3000", "Proposal artifact"), /HTTPS/);
});

test("requires a complete, non-duplicated deliverable set", () => {
  assert.match(
    validateDeliverables([
      { id: "sdk", title: "SDK", description: "Publish documented SDK support." },
      { id: "sdk", title: "Docs", description: "Publish a separate documentation site." },
    ]),
    /unique/,
  );
});

test("preserves the contract's numeric map order", () => {
  assert.deepEqual(sortedContractValues({ 10: "late", 2: "second", 0: "first" }), [
    "first",
    "second",
    "late",
  ]);
});

test("decodes ScopeMatch's newline-delimited fetched-source snapshot", () => {
  assert.deepEqual(
    parseSourceSnapshot("proposal|200|1b0f23aa|public artifact\nfunded_scope:demo|200|2c0d99ef|public source"),
    [
      { role: "proposal", status: "200", fingerprint: "1b0f23aa" },
      { role: "funded_scope:demo", status: "200", fingerprint: "2c0d99ef" },
    ],
  );
});

test("constructs a direct StudioNet transaction link", () => {
  assert.equal(
    explorerTransactionUrl("0xabc"),
    "https://explorer-studio.genlayer.com/tx/0xabc",
  );
});

test("only restores a well-formed public transaction reference", () => {
  const stored = serializePendingTransaction({
    label: "Consensus assessment",
    hash: `0x${"a".repeat(64)}`,
    submittedAt: 1_789_123_456_789,
  });
  assert.deepEqual(parsePendingTransaction(stored), {
    label: "Consensus assessment",
    hash: `0x${"a".repeat(64)}`,
    submittedAt: 1_789_123_456_789,
  });
  assert.equal(parsePendingTransaction('{"label":"bad","hash":"nope","submittedAt":1}'), null);
});
