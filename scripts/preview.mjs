import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { StudioRpcRequestError, validateStudioReadRequest } from "../api/rpcPolicy.mjs";

const root = resolve(process.cwd(), "dist");
const port = Number(process.env.PORT || 5175);
const rpcUrl = process.env.STUDIONET_RPC_URL || "https://studio.genlayer.com/api";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

if (!existsSync(root)) {
  throw new Error("No production build found. Run npm run build before npm run preview.");
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("RPC request exceeds the 64 KB proxy limit.");
  }
  return validateStudioReadRequest(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname === "/api/studionet") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Use POST for StudioNet JSON-RPC." });
      return;
    }
    try {
      const body = await readBody(request);
      const upstream = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await upstream.text();
      response.writeHead(upstream.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(text);
    } catch (error) {
      const isClientError = error instanceof StudioRpcRequestError;
      sendJson(response, isClientError ? 400 : 502, {
        error: isClientError ? error.message : "StudioNet RPC is temporarily unavailable.",
        detail: isClientError ? undefined : error instanceof Error ? error.message : "Unknown proxy failure.",
      });
    }
    return;
  }

  const unsafePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\\|\/)+/, "");
  const requestedPath = resolve(root, unsafePath || "index.html");
  const insideRoot = requestedPath === root || requestedPath.startsWith(`${root}\\`) || requestedPath.startsWith(`${root}/`);
  const filePath = insideRoot && existsSync(requestedPath) && statSync(requestedPath).isFile()
    ? requestedPath
    : join(root, "index.html");
  response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`ScopeMatch Console preview: http://127.0.0.1:${port}/`);
});
