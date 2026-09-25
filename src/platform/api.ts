import { randomUUID } from "node:crypto";
import { withTimeout } from "../utils.js";
import type { PlatformDb } from "./db.js";
import type { PlatformAuth } from "./auth.js";
import { mintToken } from "./tokens.js";
import { allSkillNames, type Skill } from "./skills.js";
import { decodeSecrets, encodeSecrets, encryptStringMap, serverDto, USER_OVERRIDABLE_ENV, USER_SECRETS } from "./serverConfig.js";

export interface ApiContext {
  db: PlatformDb;
  auth: PlatformAuth;
  /** AES secret for encrypting per-user server env/headers at rest. */
  secret: string;
  /** Called when a user's servers change so cached catalogs can be dropped. */
  invalidateUser: (userId: string) => void;
  /** Live workstation status for GET /api/status. */
  status: () => unknown;
  /** Whether the workstation is in platform mode. */
  platformOn: boolean;
  /** The skills hub catalog. */
  skills: Skill[];
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Route a /api/* request. Returns a Response. */
export async function handleApiRequest(request: Request, ctx: ApiContext): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // e.g. ["api","servers","<id>"]

  const user = await ctx.auth.sessionUser(request.headers);
  if (!user) return json(401, { error: "Not signed in" });

  const [root, resource, id] = parts;
  if (root !== "api") return json(404, { error: "Not found" });

  switch (resource) {
    case "me": {
      return json(200, {
        user,
        platformOn: ctx.platformOn,
        ...prefsPayload(ctx, user.id),
        skills: skillsPayload(ctx, user.id),
      });
    }

    case "skills": {
      return handleSkills(request, ctx, user.id);
    }

    case "status": {
      return json(200, ctx.status());
    }

    case "servers": {
      return handleServers(request, ctx, user.id, id);
    }

    case "secrets": {
      return handleSecrets(request, ctx, user.id, id);
    }

    case "tokens": {
      return handleTokens(request, ctx, user.id, id);
    }

    case "registry": {
      return handleRegistry(request, url);
    }

    case "prefs": {
      if (request.method !== "PUT" && request.method !== "GET") return json(405, { error: "Method not allowed" });
      if (request.method === "GET") {
        return json(200, prefsPayload(ctx, user.id));
      }
      const body = (await request.json().catch(() => ({}))) as {
        disabledModules?: unknown;
        disabledTools?: unknown;
        enabledSkills?: unknown;
        liteCatalog?: unknown;
      };
      const patch: { disabledModules?: string[]; disabledTools?: string[]; enabledSkills?: string[]; liteCatalog?: boolean } = {};
      if (body.disabledModules !== undefined) {
        if (!Array.isArray(body.disabledModules)) return json(400, { error: "disabledModules must be an array" });
        patch.disabledModules = body.disabledModules.map(String);
      }
      if (body.disabledTools !== undefined) {
        if (!Array.isArray(body.disabledTools)) return json(400, { error: "disabledTools must be an array" });
        patch.disabledTools = body.disabledTools.map(String);
      }
      if (body.enabledSkills !== undefined) {
        if (!Array.isArray(body.enabledSkills)) return json(400, { error: "enabledSkills must be an array" });
        patch.enabledSkills = body.enabledSkills.map(String);
      }
      if (body.liteCatalog !== undefined) {
        if (typeof body.liteCatalog !== "boolean") return json(400, { error: "liteCatalog must be a boolean" });
        patch.liteCatalog = body.liteCatalog;
      }
      ctx.db.setPrefs(user.id, patch);
      ctx.invalidateUser(user.id);
      return json(200, { ok: true });
    }

    default:
      return json(404, { error: "Not found" });
  }
}

/* ---------------- skills hub ---------------- */

async function handleSkills(request: Request, ctx: ApiContext, userId: string): Promise<Response> {
  if (request.method === "GET") {
    return json(200, { skills: skillsPayload(ctx, userId) });
  }
  if (request.method === "PUT") {
    const body = (await request.json().catch(() => ({}))) as { enabledSkills?: unknown };
    if (!Array.isArray(body.enabledSkills)) return json(400, { error: "enabledSkills must be an array" });
    const known = new Set(ctx.skills.map((s) => s.name));
    const enabled = body.enabledSkills.map(String).filter((n) => known.has(n));
    ctx.db.setPrefs(userId, { enabledSkills: enabled });
    ctx.invalidateUser(userId);
    return json(200, { ok: true });
  }
  return json(405, { error: "Method not allowed" });
}

/**
 * Resolve a stored enabledSkills list. `["*"]` (the DB default) means the
 * user has never customized skills → everything on. An explicit list is
 * respected verbatim (empty = all off).
 */
function resolveSkills(raw: string[], all: Set<string>): string[] {
  return raw.includes("*") ? [...all] : raw;
}

/** The user's prefs (modules/tools/skills/catalog-mode) with the always-new-user defaults. */
function prefsPayload(ctx: ApiContext, userId: string): {
  disabledModules: string[];
  disabledTools: string[];
  enabledSkills: string[];
  liteCatalog: boolean;
} {
  const prefs = ctx.db.getPrefs(userId);
  const parse = (v: string | undefined): string[] => {
    if (!v) return [];
    try {
      const arr = JSON.parse(v);
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      return [];
    }
  };
  const all = allSkillNames(ctx.skills);
  return {
    disabledModules: prefs ? parse(prefs.disabledModules) : [],
    disabledTools: prefs ? parse(prefs.disabledTools) : [],
    enabledSkills: prefs ? resolveSkills(parse(prefs.enabledSkills), all) : [...all],
    // New users (no row) default to the lite catalog, same as prefsFor().
    liteCatalog: prefs ? prefs.liteCatalog === 1 : true,
  };
}

/** The skills catalog with each skill's enabled state for this user. */
function skillsPayload(ctx: ApiContext, userId: string): Skill[] {
  const prefs = ctx.db.getPrefs(userId);
  const enabled = prefs
    ? (() => {
        try {
          const arr = JSON.parse(prefs.enabledSkills);
          return new Set(resolveSkills(Array.isArray(arr) ? arr.map(String) : [], allSkillNames(ctx.skills)));
        } catch {
          return new Set();
        }
      })()
    : allSkillNames(ctx.skills);
  return ctx.skills.map((s) => ({
    ...s,
    enabled: enabled.has(s.name),
  }));
}

/* ---------------- servers ---------------- */

async function handleServers(
  request: Request,
  ctx: ApiContext,
  userId: string,
  id: string | undefined,
): Promise<Response> {
  const method = request.method;
  if (!id && method === "GET") return listServers(ctx, userId);
  if (!id && method === "POST") return createServer(request, ctx, userId);
  if (id && method === "PATCH") return patchServer(request, ctx, userId, id);
  if (id && method === "DELETE") return removeServer(ctx, userId, id);
  return json(405, { error: "Method not allowed" });
}

function listServers(ctx: ApiContext, userId: string): Response {
  return json(200, { servers: ctx.db.listServers(userId).map((row) => serverDto(row, ctx.secret)) });
}

async function createServer(request: Request, ctx: ApiContext, userId: string): Promise<Response> {
  const { db } = ctx;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const type = body.type === "http" ? "http" : body.type === "stdio" ? "stdio" : null;
  if (!key) return json(400, { error: "key is required" });
  if (!type) return json(400, { error: "type must be 'stdio' or 'http'" });
  if (type === "stdio" && typeof body.command !== "string") {
    return json(400, { error: "stdio servers need a command" });
  }
  if (type === "http" && typeof body.url !== "string") {
    return json(400, { error: "http servers need a url" });
  }
  if (db.listServers(userId).some((s) => s.key === key)) {
    return json(409, { error: `A server named "${key}" already exists` });
  }
  const row = db.insertServer({
    id: randomUUID(),
    userId,
    key,
    type,
    category: typeof body.category === "string" && body.category.trim() ? body.category.trim() : undefined,
    command: type === "stdio" ? String(body.command) : undefined,
    args: type === "stdio" && Array.isArray(body.args) ? JSON.stringify(body.args.map(String)) : undefined,
    cwd: type === "stdio" && typeof body.cwd === "string" ? body.cwd : undefined,
    url: type === "http" ? String(body.url) : undefined,
    headersEnc:
      type === "http" && typeof body.headers === "object" && body.headers !== null
        ? encryptStringMap(body.headers, ctx.secret)
        : undefined,
    envEnc:
      typeof body.env === "object" && body.env !== null
        ? encryptStringMap(body.env, ctx.secret)
        : undefined,
    enabled: 1,
  });
  ctx.invalidateUser(userId);
  return json(201, { server: serverDto(row, ctx.secret) });
}

async function patchServer(request: Request, ctx: ApiContext, userId: string, id: string): Promise<Response> {
  const { db } = ctx;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!db.getServer(id, userId)) return json(404, { error: "Server not found" });
  const fields: Parameters<typeof db.updateServer>[2] = {};
  if (typeof body.enabled === "boolean") fields.enabled = body.enabled ? 1 : 0;
  if (typeof body.key === "string" && body.key.trim()) fields.key = body.key.trim();
  if (typeof body.command === "string") fields.command = body.command;
  if (Array.isArray(body.args)) fields.args = JSON.stringify(body.args.map(String));
  if (typeof body.cwd === "string") fields.cwd = body.cwd;
  if (typeof body.url === "string") fields.url = body.url;
  if (typeof body.category === "string") fields.category = body.category.trim() || undefined;
  if (body.env !== undefined && typeof body.env === "object" && body.env !== null) {
    fields.envEnc = encryptStringMap(body.env, ctx.secret);
  }
  if (body.headers !== undefined && typeof body.headers === "object" && body.headers !== null) {
    fields.headersEnc = encryptStringMap(body.headers, ctx.secret);
  }
  const updated = db.updateServer(id, userId, fields);
  if (!updated) return json(404, { error: "Server not found" });
  ctx.invalidateUser(userId);
  return json(200, { server: serverDto(updated, ctx.secret) });
}

function removeServer(ctx: ApiContext, userId: string, id: string): Response {
  if (!ctx.db.deleteServer(id, userId)) return json(404, { error: "Server not found" });
  ctx.invalidateUser(userId);
  return json(200, { ok: true });
}

/* ---------------- secrets (per-user builtin credentials) ---------------- */

async function handleSecrets(
  request: Request,
  ctx: ApiContext,
  userId: string,
  key: string | undefined,
): Promise<Response> {
  if (request.method === "GET" && !key) {
    // Report NAMES only — values never leave the encrypted store.
    const values = decodeSecrets(ctx.db.getSecretsEnc(userId), ctx.secret);
    return json(200, { allowed: USER_SECRETS, keys: Object.keys(values).sort() });
  }

  if (request.method === "PUT" && !key) {
    const body = (await request.json().catch(() => ({}))) as { values?: unknown };
    if (body.values === null || typeof body.values !== "object" || Array.isArray(body.values)) {
      return json(400, { error: "Body must be { values: { NAME: string|null } }" });
    }
    const patch = body.values as Record<string, unknown>;
    const unknown = Object.keys(patch).filter((k) => !USER_OVERRIDABLE_ENV.has(k));
    if (unknown.length) {
      return json(400, { error: `Not overridable: ${unknown.join(", ")} (allowed: ${[...USER_OVERRIDABLE_ENV].join(", ")})` });
    }
    const values = decodeSecrets(ctx.db.getSecretsEnc(userId), ctx.secret);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") delete values[k];
      else if (typeof v === "string") values[k] = v;
      else return json(400, { error: `Value for ${k} must be a string or null` });
    }
    if (Object.keys(values).length === 0) ctx.db.deleteSecretsEnc(userId);
    else ctx.db.setSecretsEnc(userId, encodeSecrets(values, ctx.secret));
    return json(200, { ok: true, keys: Object.keys(values).sort() });
  }

  if (request.method === "DELETE" && key) {
    const values = decodeSecrets(ctx.db.getSecretsEnc(userId), ctx.secret);
    if (!(key in values)) return json(404, { error: `No stored credential named "${key}"` });
    delete values[key];
    if (Object.keys(values).length === 0) ctx.db.deleteSecretsEnc(userId);
    else ctx.db.setSecretsEnc(userId, encodeSecrets(values, ctx.secret));
    return json(200, { ok: true });
  }

  return json(405, { error: "Method not allowed" });
}

/* ---------------- official MCP Registry (read-only discovery proxy) ---------------- */

const REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0/servers";

/**
 * Proxy + flatten the official registry search so the dashboard can import
 * remote servers without exposing CORS/keys client-side. Fixed upstream host
 * (no user-controlled URLs) and a hard timeout.
 */
async function handleRegistry(request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET") return json(405, { error: "Method not allowed" });
  const search = url.searchParams.get("search")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), 25);
  const target = new URL(REGISTRY_BASE);
  target.searchParams.set("limit", String(limit));
  if (search) target.searchParams.set("search", search);
  let upstream: Response;
  try {
    upstream = await withTimeout(fetch(target, { headers: { Accept: "application/json" } }), 10_000, "MCP Registry");
  } catch (err) {
    return json(502, { error: err instanceof Error ? err.message : "Registry unreachable" });
  }
  if (!upstream.ok) return json(502, { error: `MCP Registry responded ${upstream.status}` });
  const data = (await upstream.json().catch(() => null)) as {
    servers?: { server?: { name?: string; description?: string; version?: string; repository?: { url?: string }; remotes?: { type?: string; url?: string }[] } }[];
  } | null;
  const servers = (data?.servers ?? [])
    .map((e) => e.server ?? {})
    .filter((s) => s.remotes?.length)
    .map((s) => ({
      name: s.name ?? "",
      description: s.description ?? "",
      version: s.version ?? "",
      repository: s.repository?.url ?? "",
      url: s.remotes?.[0]?.url ?? "",
      transport: s.remotes?.[0]?.type ?? "streamable-http",
    }))
    .filter((s) => /^https:\/\//.test(s.url));
  return json(200, { servers });
}

/* ---------------- tokens ---------------- */

async function handleTokens(
  request: Request,
  ctx: ApiContext,
  userId: string,
  id: string | undefined,
): Promise<Response> {
  const { db } = ctx;

  if (request.method === "GET" && !id) {
    const rows = db.listTokens(userId);
    return json(200, {
      tokens: rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        // Hash suffix so users can recognize a token without leaking it.
        hint: r.tokenHash.slice(0, 8),
      })),
    });
  }

  if (request.method === "POST" && !id) {
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "API token";
    const minted = mintToken(db, userId, name);
    return json(201, { token: minted });
  }

  if (request.method === "DELETE" && id) {
    const ok = db.deleteToken(id, userId);
    if (!ok) return json(404, { error: "Token not found" });
    return json(200, { ok: true });
  }

  return json(405, { error: "Method not allowed" });
}
