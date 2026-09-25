import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { AuthInfo, McpHttpHandler } from "@modelcontextprotocol/server";
import { requireBearerAuth } from "@modelcontextprotocol/server";
import type { PlatformAuth } from "./platform/auth.js";
import { handleApiRequest, type ApiContext } from "./platform/api.js";
import { handleOAuthRequest } from "./platform/oauth.js";
import { createMcpTokenVerifier } from "./platform/tokens.js";
import type { PlatformDb } from "./platform/db.js";
import type { Skill } from "./platform/skills.js";
import { env } from "./utils.js";

export interface HttpOptions {
  port: number;
  mcpPath: string;
  /** Present in platform (multi-user) mode. */
  platform?: {
    auth: PlatformAuth;
    db: PlatformDb;
    secret: string;
    status: () => unknown;
    invalidateUser: (userId: string) => void;
    skills: Skill[];
  };
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown;
}

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

/**
 * Origins allowed to call /api/* cross-origin with credentials. The dashboard
 * is served same-origin (and the Vite dev server proxies), so the default is
 * empty — cookie auth over wildcard CORS is never enabled. `/mcp` stays
 * `*` because it is Bearer-token gated, not cookie gated.
 */
const ALLOWED_ORIGINS = new Set(
  (env("CORS_ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

/**
 * Start the HTTP server. Serves, on one port:
 *  - `/api/auth/*`  → Better Auth (Google/GitHub sign-in, sessions)
 *  - `/api/*`       → dashboard REST (servers, tokens, prefs)
 *  - `/`            → the dashboard UI (static files in public/)
 *  - `/mcp`         → the 2026-07-28 stateless MCP endpoint; in platform mode
 *                     every request must carry a valid API token (Bearer).
 *
 * The deprecated legacy HTTP+SSE transport is still bridged for older MCP
 * clients (in platform mode its message POSTs are authenticated too).
 */
export function startHttp(
  mcpHandler: McpHttpHandler,
  { port, mcpPath, platform }: HttpOptions,
): http.Server {
  const nodeHandler = toNodeHandler(mcpHandler);
  const sseStreams = new Map<string, ServerResponse>();

  // Gate that validates `Authorization: Bearer <api-token>` → AuthInfo.
  const bearerGate: ((request: Request) => Promise<AuthInfo | Response>) | null = platform
    ? requireBearerAuth({ verifier: createMcpTokenVerifier(platform.db) })
    : null;

  const httpServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // ---- CORS ----
      applyCors(req, res, url.pathname.startsWith("/api"));
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // ---- OAuth 2.1 authorization server for /mcp (platform mode) ----
      if (platform && (url.pathname === "/.well-known/oauth-authorization-server" ||
          url.pathname === "/register" ||
          url.pathname.startsWith("/oauth/"))) {
        const request = await toBodyRequest(req, url);
        const response = await handleOAuthRequest(request, url, { db: platform.db, auth: platform.auth });
        await writeResponse(res, response);
        return;
      }

      // ---- OAuth protected-resource metadata (RFC 9728) ----
      // Both the plain and the path-suffixed forms (§3.1) of the well-known URI.
      if (url.pathname === "/.well-known/oauth-protected-resource" ||
          url.pathname.startsWith("/.well-known/oauth-protected-resource/")) {
        json(res, 200, {
          resource: `${url.origin}${mcpPath}`,
          resource_name: "MCP Workstation",
          bearer_methods_supported: ["header"],
          ...(platform ? { authorization_servers: [url.origin] } : {}),
        });
        return;
      }

      // ---- Better Auth routes ----
      if (url.pathname.startsWith("/api/auth/")) {
        await routeAuthBlock(req, res, url);
        return;
      }

      // ---- Dashboard REST API ----
      if (url.pathname.startsWith("/api/")) {
        if (platform) await routeApi(req, res, url);
        else json(res, 404, { error: "Platform mode is off (set BETTER_AUTH_SECRET)" });
        return;
      }

      // ---- Static dashboard UI ----
      if (url.pathname === "/" || url.pathname.startsWith("/assets/")) {
        serveStatic(res, url.pathname);
        return;
      }

      if (url.pathname !== mcpPath) {
        json(res, 404, { error: "Not found" });
        return;
      }
      await routeMcp(req, res, url);
    } catch (err) {
      if (!res.headersSent) {
        json(res, 500, { error: `Internal error: ${err instanceof Error ? err.message : String(err)}` });
      } else {
        res.destroy();
      }
    }
  });

  /** Better Auth (Google/GitHub sign-in, sessions) — platform mode only. */
  async function routeAuthBlock(
    req: http.IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    if (!platform) {
      json(res, 404, { error: "Platform mode is off (set BETTER_AUTH_SECRET)" });
      return;
    }
    // Legacy URL compatibility: Better Auth 1.6 only accepts
    // POST /api/auth/sign-in/social, but old dashboard versions (and
    // cached pages / hand-typed URLs) use GET ?provider=&callbackURL=.
    // Translate that GET into the POST flow and 302-redirect to Google.
    if (url.pathname.endsWith("/sign-in/social") && req.method === "GET") {
      await routeLegacySocialGet(req, res, url, platform.auth);
      return;
    }
    await routeAuth(req, res, url, platform.auth);
  }

  /** Dashboard REST API: convert to a web Request and let the API router answer. */
  async function routeApi(
    req: http.IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const ctx: ApiContext = {
      db: platform!.db,
      auth: platform!.auth,
      secret: platform!.secret,
      invalidateUser: platform!.invalidateUser,
      status: platform!.status,
      platformOn: true,
      skills: platform!.skills,
    };
    const request = await toBodyRequest(req, url);
    const response = await handleApiRequest(request, ctx);
    await writeResponse(res, response);
  }

  /** The MCP endpoint: legacy SSE bridge requests, or modern stateless Streamable HTTP. */
  async function routeMcp(
    req: http.IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sseId = url.searchParams.get("sessionId");

    // Legacy HTTP+SSE bridge: GET opens the stream (announced via `endpoint`).
    // In platform mode the stream itself requires a valid Bearer token.
    if (req.method === "GET" && typeof sessionIdHeader !== "string" && sseId === null) {
      if (bearerGate) {
        const auth = await bearerGate(toRequest(req, url));
        if (auth instanceof Response) {
          await writeResponse(res, withResourceMetadata(auth, url.origin));
          return;
        }
      }
      openSseStream(res, mcpPath, sseStreams);
      return;
    }
    // Legacy HTTP+SSE bridge: POSTs to ?sessionId=… deliver messages.
    if (req.method === "POST" && sseId !== null) {
      await handleSsePost(req, res, sseId, sseStreams, mcpHandler, url, bearerGate);
      return;
    }

    // ---- Modern stateless Streamable HTTP ----
    if (bearerGate) {
      const auth = await bearerGate(toRequest(req, url));
      if (auth instanceof Response) {
        await writeResponse(res, withResourceMetadata(auth, url.origin));
        return;
      }
      // toNodeHandler forwards `req.auth` as the handler's authInfo.
      (req as unknown as { auth: unknown }).auth = auth;
    }
    await nodeHandler(req, res);
  }

  httpServer.listen(port, () => {
    console.error(`[mcp-workstation] listening on http://localhost:${port}${mcpPath}`);
  });

  return httpServer;
}

/* ---------------- Better Auth ---------------- */

async function routeAuth(
  req: http.IncomingMessage,
  res: ServerResponse,
  url: URL,
  auth: PlatformAuth,
): Promise<void> {
  const request = await toBodyRequest(req, url);
  const response = await auth.handler(request);
  await writeResponse(res, response);
}

/**
 * Handle a legacy GET to /api/auth/sign-in/social by translating it into the
 * POST flow Better Auth 1.6 expects, then 302-redirecting to the returned
 * authorization URL.
 */
async function routeLegacySocialGet(
  req: http.IncomingMessage,
  res: ServerResponse,
  url: URL,
  auth: PlatformAuth,
): Promise<void> {
  const provider = url.searchParams.get("provider") ?? "";
  const callbackURL =
    url.searchParams.get("callbackURL") ??
    url.searchParams.get("redirectTo") ??
    `${url.origin}/`;
  if (!provider) {
    json(res, 400, { error: "Missing provider query parameter" });
    return;
  }

  const request = new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // A GET has no body; forward cookies if any (OAuth state cookie).
      ...(req.headers.cookie ? { Cookie: String(req.headers.cookie) } : {}),
    },
    body: JSON.stringify({ provider, callbackURL }),
  });
  const response = await auth.handler(request);
  if (response.status !== 200) {
    await writeResponse(res, response);
    return;
  }
  const data = (await response.json().catch(() => null)) as { url?: string } | null;
  const target = data?.url;
  if (!target) {
    json(res, 500, { error: "Sign-in could not start: no authorization URL returned" });
    return;
  }
  res.writeHead(302, { Location: target });
  res.end();
}

/* ---------------- helpers ---------------- */

/** Write a JSON body with the given status. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * CORS: `/mcp` (Bearer-gated) is open to any origin; `/api/*` (cookie-gated)
 * only echoes origins from the explicit allow-list — wildcard is never sent
 * together with credentials.
 */
function applyCors(req: http.IncomingMessage, res: ServerResponse, cookieGated: boolean): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (cookieGated) {
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Method, Mcp-Name, Mcp-Protocol-Version, Cookie",
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
}

/**
 * Header-only web-standard Request (does NOT consume the body stream, so the
 * MCP handler can still read it from the raw IncomingMessage). Used for the
 * bearer gate, which only inspects the Authorization header.
 */
function toRequest(req: http.IncomingMessage, url: URL): Request {
  return new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: undefined,
  });
}

/** Read the request body and build a full Request (for auth + REST routes). */
async function toBodyRequest(req: http.IncomingMessage, url: URL): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString("utf-8");
  return new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: body.length > 0 ? body : undefined,
  });
}

/** Write a web-standard Response to the Node response (copies status/headers/body). */
async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    // Preserve multiple Set-Cookie headers (auth sessions).
    if (key.toLowerCase() === "set-cookie") {
      const all = response.headers.getSetCookie();
      headers[key] = all;
    } else {
      headers[key] = value;
    }
  });
  res.writeHead(response.status, headers);
  const body = await response.arrayBuffer();
  res.end(Buffer.from(body));
}

/**
 * Point 401 challenges at our RFC 9728 protected-resource metadata so
 * spec-conformant MCP clients can discover the auth model automatically.
 */
function withResourceMetadata(response: Response, origin: string): Response {
  if (response.status !== 401) return response;
  const headers = new Headers(response.headers);
  const existing = headers.get("WWW-Authenticate")?.trim() ?? "";
  const pointer = `resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
  headers.set("WWW-Authenticate", existing.startsWith("Bearer") ? `${existing}, ${pointer}` : `Bearer ${pointer}`);
  return new Response(response.body, { status: response.status, headers });
}

/** Serve the dashboard UI from public/. */
function serveStatic(res: ServerResponse, pathname: string): void {
  const name = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(PUBLIC_DIR, name);
  // Prevent path traversal.
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.resolve(PUBLIC_DIR, "index.html")) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
    };
    // No-cache so dashboard fixes (auth flows, buttons) apply immediately
    // instead of lingering in the browser cache.
    res.writeHead(200, {
      "Content-Type": types[ext] ?? "application/octet-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.end(data);
  });
}

/* ---------------- legacy SSE bridge ---------------- */

/** Open a legacy SSE stream and announce its message endpoint. */
function openSseStream(
  res: ServerResponse,
  mcpPath: string,
  streams: Map<string, ServerResponse>,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const id = randomUUID();
  res.write(`event: endpoint\ndata: ${mcpPath}?sessionId=${id}\n\n`);
  streams.set(id, res);
  res.on("close", () => {
    streams.delete(id);
  });
}

/** Deliver a legacy SSE POST to the stateless handler, forwarding the response over the stream. */
async function handleSsePost(
  req: http.IncomingMessage,
  res: ServerResponse,
  sseId: string,
  streams: Map<string, ServerResponse>,
  handler: McpHttpHandler,
  url: URL,
  bearerGate: ((request: Request) => Promise<AuthInfo | Response>) | null,
): Promise<void> {
  const stream = streams.get(sseId);
  if (!stream) {
    json(res, 404, { error: "Unknown SSE session" });
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  if (!text) {
    res.writeHead(202);
    res.end();
    return;
  }

  let message: JsonRpcMessage;
  try {
    message = JSON.parse(text) as JsonRpcMessage;
  } catch {
    json(res, 400, { error: "Request body must be valid JSON-RPC" });
    return;
  }

  // Synthesize a request for the stateless handler.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (typeof message.method === "string") headers["Mcp-Method"] = message.method;
  if (
    message.method === "tools/call" &&
    message.params !== null &&
    typeof message.params === "object" &&
    !Array.isArray(message.params) &&
    typeof (message.params as { name?: unknown }).name === "string"
  ) {
    headers["Mcp-Name"] = (message.params as { name: string }).name;
  }
  // Forward any client-supplied Authorization to the gate (legacy SSE clients
  // send the token on message POSTs).
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string") headers["Authorization"] = authHeader;

  let authInfo: AuthInfo | undefined;
  if (bearerGate) {
    const gateRes = await bearerGate(
      new Request(url, { method: "POST", headers, body: text }),
    );
    if (gateRes instanceof Response) {
      // Send the 401 challenge over the stream, then ack the POST.
      const bodyText = await gateRes.text();
      if (message.id !== undefined && bodyText) {
        stream.write(`data: ${bodyText}\n\n`);
      }
      res.writeHead(202);
      res.end();
      return;
    }
    authInfo = gateRes;
  }

  let response: Response;
  try {
    response = await handler.fetch(
      new Request(url, { method: "POST", headers, body: text }),
      { parsedBody: message, ...(authInfo ? { authInfo } : {}) },
    );
  } catch (err) {
    json(res, 500, { error: `Internal error: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Forward the JSON-RPC response over SSE (skip notifications — no id).
  if (message.id !== undefined) {
    const bodyText = await response.text();
    const payload = extractJson(bodyText) ?? bodyText;
    if (payload) {
      stream.write(`data: ${payload}\n\n`);
    }
  }

  res.writeHead(202, { "Content-Type": "application/json" });
  res.end();
}

/** Try to pull a single JSON-RPC JSON out of a response body (handles SSE-wrapped bodies). */
function extractJson(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    const last = trimmed
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .pop();
    if (!last) return null;
    const payload = last.slice(6).trim();
    try {
      JSON.parse(payload);
      return payload;
    } catch {
      return null;
    }
  }
}
