import assert from "node:assert/strict";
import test from "node:test";
import { STUDIO_READ_METHODS, validateStudioReadRequest } from "../api/rpcPolicy.mjs";

test("accepts the contract-read RPC method used by the console", () => {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "gen_call",
    params: [{ type: "read", to: "0xabc", from: "0x0000000000000000000000000000000000000000", data: "0x" }],
  };
  assert.deepEqual(validateStudioReadRequest(request), request);
  assert.equal(STUDIO_READ_METHODS.has("gen_call"), true);
  assert.equal(STUDIO_READ_METHODS.has("eth_getTransactionCount"), true);
  assert.equal(STUDIO_READ_METHODS.has("eth_estimateGas"), true);
});

test("rejects a proxy write attempt", () => {
  assert.throws(
    () => validateStudioReadRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "gen_call",
      params: [{ type: "write", to: "0xabc", data: "0x" }],
    }),
    /only accepts read calls/,
  );
  assert.throws(
    () => validateStudioReadRequest({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [] }),
    /read methods/,
  );
});

test("rejects malformed JSON-RPC parameter shapes", () => {
  assert.throws(
    () => validateStudioReadRequest({ jsonrpc: "2.0", id: 1, method: "eth_call", params: {} }),
    /params must be an array/,
  );
});
