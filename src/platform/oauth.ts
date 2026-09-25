/**
 * Minimal OAuth 2.1 authorization server for the /mcp resource — enough for
 * spec-conformant MCP clients (ChatGPT, Claude, Cursor…) to bootstrap auth
 * from our RFC 9728 PRM document:
 *
 *   POST /register (RFC 7591 DCR)          → public client_id
 *   GET  /oauth/authorize (session-gated)  → consent page (or redirect-to-login)
 *   POST /oauth/authorize (nonce + choice) → 302 redirect_uri?code=…
 *   POST /oauth/token (code + PKCE S256)   → mcw_ bearer (same store as dashboard tokens)
 *
 * Authorization codes and consent nonces are single-use, in-memory, and
 * short-lived (nothing durable to leak on restart); client registrations are
 * persisted in `oauth_clients`. Only the authorization_code grant with
 * mandatory PKCE is supported — no implicit, no password, no client_credentials.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PlatformDb } from "./db.js";
import type { PlatformAuth } from "./auth.js";
import { mintToken } from "./tokens.js";

const CODE_TTL_MS = 5 * 60_000;
const PENDING_TTL_MS = 10 * 60_000;

interface PendingConsent {
  params: AuthorizeParams;
  userId: string;
  expires: number;
}

interface AuthCode {
  clientId: string;
  userId: string;
  redirectUri: string;
  challenge: string;
  expires: number;
}

interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string | null;
  challenge: string;
  challengeMethod: string;
  responseType: string;
}

const json = (status: number, body: unknown, extra?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });

const oauthError = (status: number, error: string, description?: string): Response =>
  json(status, { error, ...(description ? { error_description: description } : {}) });

export interface OAuthContext {
  db: PlatformDb;
  auth: PlatformAuth;
}

/** RFC 8252-friendly: https, or http only to loopback. */
function validRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  return false;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/* In-memory single-use stores (see header note). */
const pending = new Map<string, PendingConsent>();
const codes = new Map<string, AuthCode>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  for (const [k, v] of codes) if (v.expires < now) codes.delete(k);
}, 60_000).unref();

export async function handleOAuthRequest(request: Request, url: URL, ctx: OAuthContext): Promise<Response> {
  const issuer = url.origin;

  /* ---------- AS metadata ---------- */
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    return json(200, {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  }

  /* ---------- RFC 7591 dynamic client registration ---------- */
  if (url.pathname === "/register" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { client_name?: unknown; redirect_uris?: unknown } | null;
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (uris.length === 0 || !uris.every(validRedirect)) {
      return oauthError(400, "invalid_client_metadata", "redirect_uris must be a non-empty array of https (or loopback http) URLs");
    }
    const name = typeof body?.client_name === "string" ? body.client_name.slice(0, 120) : "MCP client";
    const clientId = randomUUID();
    ctx.db.insertOAuthClient(clientId, name, JSON.stringify(uris));
    return json(201, { client_id: clientId, client_name: name, redirect_uris: uris, grant_types: ["authorization_code"], token_endpoint_auth_method: "none" });
  }

  /* ---------- authorization ---------- */
  if (url.pathname === "/oauth/authorize") {
    if (request.method === "GET") return authorizeGet(request, url, ctx, issuer);
    if (request.method === "POST") return authorizePost(request, ctx);
    return oauthError(405, "unsupported_operation");
  }

  /* ---------- token ---------- */
  if (url.pathname === "/oauth/token" && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const get = (k: string): string => String(form?.get(k) ?? "");
    if (get("grant_type") !== "authorization_code") return oauthError(400, "unsupported_grant_type");
    const code = get("code");
    const entry = codes.get(code);
    codes.delete(code); // single-use, even on failure
    if (!entry || entry.expires < Date.now()) return oauthError(400, "invalid_grant", "Unknown or expired code");
    if (entry.clientId !== get("client_id") || entry.redirectUri !== get("redirect_uri")) {
      return oauthError(400, "invalid_grant", "client_id/redirect_uri mismatch");
    }
    const verifier = get("code_verifier");
    if (!verifier || s256(verifier) !== entry.challenge) return oauthError(400, "invalid_grant", "PKCE verification failed");

    const client = ctx.db.getOAuthClient(entry.clientId);
    const minted = mintToken(ctx.db, entry.userId, `oauth:${client?.clientName ?? entry.clientId}`);
    return json(200, {
      access_token: minted.token,
      token_type: "Bearer",
      expires_in: 60 * 60 * 24 * 30,
      scope: "mcp",
    }, { "Cache-Control": "no-store" });
  }

  return json(404, { error: "not_found" });
}

async function authorizeGet(request: Request, url: URL, ctx: OAuthContext, issuer: string): Promise<Response> {
  const user = await ctx.auth.sessionUser(request.headers);
  const p = url.searchParams;
  if (!user) {
    // Hand the agent back to the dashboard sign-in with the flow preserved;
    // conformant clients surface this redirect to the human.
    const next = encodeURIComponent(url.pathname + url.search);
    return Response.redirect(`${issuer}/?authorize_return=${next}`, 302);
  }

  const clientId = p.get("client_id") ?? "";
  const redirectUri = p.get("redirect_uri") ?? "";
  const challenge = p.get("code_challenge") ?? "";
  const method = p.get("code_challenge_method") ?? "";
  const responseType = p.get("response_type") ?? "";
  const state = p.get("state");

  const fail = (err: string, desc: string): Response => {
    // Errors surface at the client redirect when possible (RFC 6749 §4.1.2.1).
    if (validRedirect(redirectUri) && ctx.db.getOAuthClient(clientId)) {
      const sep = redirectUri.includes("?") ? "&" : "?";
      return Response.redirect(`${redirectUri}${sep}error=${err}&error_description=${encodeURIComponent(desc)}${state ? `&state=${encodeURIComponent(state)}` : ""}`, 302);
    }
    return oauthError(400, err, desc);
  };

  if (responseType !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  if (!ctx.db.getOAuthClient(clientId)) return fail("invalid_client", "Unknown client_id — POST /register first");
  if (!validRedirect(redirectUri)) return fail("invalid_request", "Bad redirect_uri");
  if (!challenge || method !== "S256") return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");

  const nonce = b64url(randomBytes(24));
  pending.set(nonce, { params: { clientId, redirectUri, state, challenge, challengeMethod: method, responseType }, userId: user.id, expires: Date.now() + PENDING_TTL_MS });
  return consentPage(nonce, ctx.db.getOAuthClient(clientId)!.clientName, issuer);
}

async function authorizePost(request: Request, ctx: OAuthContext): Promise<Response> {
  // Re-check the session at POST time: the consent nonce alone must not mint a code.
  const user = await ctx.auth.sessionUser(request.headers);
  if (!user) return oauthError(401, "login_required", "Sign-in session missing at consent time");
  const form = await request.formData().catch(() => null);
  const nonce = String(form?.get("nonce") ?? "");
  const decision = String(form?.get("decision") ?? "");
  const entry = pending.get(nonce);
  pending.delete(nonce);
  if (!entry) return oauthError(400, "invalid_request", "Consent request expired or already used");
  if (entry.userId !== user.id) return oauthError(400, "invalid_request", "Consent does not match the signed-in user");

  const { clientId, redirectUri, state, challenge } = entry.params;
  if (decision !== "approve") {
    const sep = redirectUri.includes("?") ? "&" : "?";
    return Response.redirect(`${redirectUri}${sep}error=access_denied&error_description=User+denied${state ? `&state=${encodeURIComponent(state)}` : ""}`, 302);
  }
  const code = "ac_" + b64url(randomBytes(32));
  codes.set(code, { clientId, userId: entry.userId, redirectUri, challenge, expires: Date.now() + CODE_TTL_MS });
  const sep = redirectUri.includes("?") ? "&" : "?";
  return Response.redirect(`${redirectUri}${sep}code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ""}`, 302);
}

function consentPage(nonce: string, clientName: string, issuer: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>MCP Workstation — authorize ${escapeHtml(clientName)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0e14;color:#e6e9f0;display:grid;place-items:center;min-height:100vh;margin:0}
.card{max-width:30rem;padding:2rem;border:1px solid #2a3140;border-radius:12px;background:#11151f}
code{color:#8ab4ff}button{padding:.6rem 1.4rem;border-radius:8px;border:1px solid #2a3140;cursor:pointer;font-size:1rem;margin-right:.6rem}
.approve{background:#2f81f7;color:#fff;border-color:#2f81f7}.deny{background:transparent;color:#e6e9f0}</style></head>
<body><div class="card"><h2>Authorize <code>${escapeHtml(clientName)}</code></h2>
<p>This MCP client is asking to connect to your <strong>MCP Workstation</strong> at <code>${escapeHtml(issuer)}</code>.</p>
<p>Approving creates an API token named <code>oauth:${escapeHtml(clientName)}</code> which you can revoke any time on the Tokens page.</p>
<form method="POST" action="/oauth/authorize"><input type="hidden" name="nonce" value="${nonce}">
<button class="approve" name="decision" value="approve">Approve</button>
<button class="deny" name="decision" value="deny">Deny</button></form></div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" } },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
