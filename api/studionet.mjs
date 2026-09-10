import { StudioRpcRequestError, validateStudioReadRequest } from "./rpcPolicy.mjs";

const STUDIO_RPC = process.env.STUDIONET_RPC_URL || "https://studio.genlayer.com/api";
const MAX_BODY_BYTES = 64 * 1024;

function setHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
}

function parseRequestBody(request) {
  const rawBody = Buffer.isBuffer(request.body)
    ? request.body.toString("utf8")
    : typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body ?? {});
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    throw new Error("RPC request exceeds the 64 KB proxy limit.");
  }
  return JSON.stringify(validateStudioReadRequest(JSON.parse(rawBody)));
}

export default async function handler(request, response) {
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }
  if (request.method !== "POST") {
    setHeaders(response);
    response.status(405).send(JSON.stringify({ error: "Use POST for StudioNet JSON-RPC." }));
    return;
  }

  try {
    const body = parseRequestBody(request);
    const upstream = await fetch(STUDIO_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await upstream.text();
    setHeaders(response);
    response.status(upstream.status).send(payload);
  } catch (error) {
    setHeaders(response);
    const isClientError = error instanceof StudioRpcRequestError;
    response.status(isClientError ? 400 : 502).send(
      JSON.stringify({
        error: isClientError ? error.message : "StudioNet RPC is temporarily unavailable.",
        detail: isClientError ? undefined : error instanceof Error ? error.message : "Unknown proxy failure.",
      }),
    );
  }
}
