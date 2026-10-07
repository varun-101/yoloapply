import type { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ApiAuthError, requireUser } from "../auth";
import { clientIpFrom, rateLimit } from "../rateLimit";
import { createYoloApplyMcpServer } from "./server";

// Streamable HTTP endpoint, stateless: every POST builds a fresh server bound
// to the token's user, so no session state outlives the request and one
// user's server can never answer another's call. Long-running work (resume
// generation) is owned by the backend and polled through status tools.

export const MAX_BODY_BYTES = 256 * 1024;
const USER_LIMIT = { limit: 240, windowMs: 60_000 };
const AUTH_FAIL_LIMIT = { limit: 30, windowMs: 60_000 };

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const WWW_AUTH = { "WWW-Authenticate": 'Bearer realm="YOLOapply MCP"' };

export function methodNotAllowed() {
  return jsonRpcError(405, -32000, "Method not allowed. This MCP endpoint is stateless: use POST.", { Allow: "POST" });
}

export async function handleMcpPost(req: NextRequest, deps = { requireUser }): Promise<Response> {
  const ip = clientIpFrom(req.headers);
  const authHeader = req.headers.get("authorization") ?? "";
  if (!/^Bearer yolo_[A-Za-z0-9_-]{10,200}$/.test(authHeader.trim())) {
    const rl = rateLimit("mcp-auth-fail", ip, AUTH_FAIL_LIMIT.limit, AUTH_FAIL_LIMIT.windowMs);
    if (!rl.ok) return jsonRpcError(429, -32000, "Too many unauthenticated requests.", { "Retry-After": String(rl.retryAfterSec) });
    return jsonRpcError(
      401,
      -32001,
      "Missing or malformed token. Send Authorization: Bearer yolo_... (generate one in YOLOapply Settings -> Credentials).",
      WWW_AUTH
    );
  }

  let userId: string;
  try {
    userId = (await deps.requireUser(req)).id;
  } catch (e) {
    const rl = rateLimit("mcp-auth-fail", ip, AUTH_FAIL_LIMIT.limit, AUTH_FAIL_LIMIT.windowMs);
    if (!rl.ok) return jsonRpcError(429, -32000, "Too many unauthenticated requests.", { "Retry-After": String(rl.retryAfterSec) });
    if (e instanceof ApiAuthError) {
      return jsonRpcError(401, -32001, "Invalid token. Generate a new one in YOLOapply Settings -> Credentials.", WWW_AUTH);
    }
    return jsonRpcError(503, -32603, "Authentication is temporarily unavailable. Retry shortly.");
  }

  const rl = rateLimit("mcp-user", userId, USER_LIMIT.limit, USER_LIMIT.windowMs);
  if (!rl.ok) return jsonRpcError(429, -32000, `Rate limit exceeded. Retry in ${rl.retryAfterSec}s.`, { "Retry-After": String(rl.retryAfterSec) });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return jsonRpcError(413, -32600, `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
  const text = await readCapped(req, MAX_BODY_BYTES);
  if (text === null) return jsonRpcError(413, -32600, `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    return jsonRpcError(400, -32700, "Parse error: body is not valid JSON.");
  }
  if (Array.isArray(parsedBody) && parsedBody.length > 20) {
    return jsonRpcError(400, -32600, "Batches are limited to 20 messages.");
  }

  const baseUrl = new URL(req.url).origin;
  const server = createYoloApplyMcpServer({ userId, baseUrl });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req, {
      parsedBody,
      authInfo: { token: "redacted", clientId: "personal-token", scopes: [], extra: { userId } },
    });
  } finally {
    void server.close().catch(() => {});
  }
}

async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
