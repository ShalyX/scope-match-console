export const STUDIO_READ_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_gasPrice",
  "gen_call",
]);

export class StudioRpcRequestError extends Error {}

export function validateStudioReadRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new StudioRpcRequestError("A JSON-RPC 2.0 request object is required.");
  }
  if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string") {
    throw new StudioRpcRequestError("Only JSON-RPC 2.0 requests are accepted.");
  }
  if (!STUDIO_READ_METHODS.has(payload.method)) {
    throw new StudioRpcRequestError("The proxy only accepts StudioNet read methods.");
  }
  if (payload.params !== undefined && !Array.isArray(payload.params)) {
    throw new StudioRpcRequestError("JSON-RPC params must be an array.");
  }
  if (payload.method === "gen_call") {
    const call = payload.params?.[0];
    if (
      payload.params?.length !== 1 ||
      typeof call !== "object" ||
      call === null ||
      Array.isArray(call) ||
      call.type !== "read"
    ) {
      throw new StudioRpcRequestError("The gen_call proxy route only accepts read calls.");
    }
  }
  return payload;
}
