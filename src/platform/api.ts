import { randomUUID } from "node:crypto";
import type { PlatformDb } from "./db.js";
import type { PlatformAuth } from "./auth.js";
import { decryptSecret, encryptSecret, sha256Hex } from "./crypto.js";
import { mintToken } from "./tokens.js";
import { allSkillNames, type Skill } from "./skills.js";
import type { UpstreamServerConfig } from "../config.js";

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

    case "tokens": {
      return handleTokens(request, ctx, user.id, id);
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
      };
      const patch: { disabledModules?: string[]; disabledTools?: string[]; enabledSkills?: string[] } = {};
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

/** The user's prefs (modules/tools/skills) with the always-new-user defaults. */
function prefsPayload(ctx: ApiContext, userId: string): {
  disabledModules: string[];
  disabledTools: string[];
  enabledSkills: string[];
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
  return json(200, { servers: ctx.db.listServers(userId).map(decryptServer(ctx.db, ctx.secret)) });
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
        ? encryptSecret(JSON.stringify(body.headers), ctx.secret)
        : undefined,
    envEnc:
      typeof body.env === "object" && body.env !== null
        ? encryptSecret(JSON.stringify(body.env), ctx.secret)
        : undefined,
    enabled: 1,
  });
  ctx.invalidateUser(userId);
  return json(201, { server: decryptServer(db, ctx.secret)(row) });
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
    fields.envEnc = encryptSecret(JSON.stringify(body.env), ctx.secret);
  }
  if (body.headers !== undefined && typeof body.headers === "object" && body.headers !== null) {
    fields.headersEnc = encryptSecret(JSON.stringify(body.headers), ctx.secret);
  }
  const updated = db.updateServer(id, userId, fields);
  if (!updated) return json(404, { error: "Server not found" });
  ctx.invalidateUser(userId);
  return json(200, { server: decryptServer(db, ctx.secret)(updated) });
}

function removeServer(ctx: ApiContext, userId: string, id: string): Response {
  if (!ctx.db.deleteServer(id, userId)) return json(404, { error: "Server not found" });
  ctx.invalidateUser(userId);
  return json(200, { ok: true });
}

/** Decrypt secrets and shape a DB row for the dashboard (never leak raw secrets). */
function decryptServer(db: PlatformDb, secret: string): (row: Awaited<ReturnType<PlatformDb["listServers"]>>[number]) => unknown {
  return (row) => ({
    id: row.id,
    key: row.key,
    type: row.type,
    category: row.category ?? null,
    command: row.command,
    args: row.args ? safeJson(row.args) : [],
    cwd: row.cwd,
    url: row.url,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    hasEnv: Boolean(row.envEnc),
    hasHeaders: Boolean(row.headersEnc),
    // Show which keys are set, never the values.
    envKeys: row.envEnc ? Object.keys(safeJson(decryptSecret(row.envEnc, secret)) as Record<string, unknown>) : [],
    headerKeys: row.headersEnc
      ? Object.keys(safeJson(decryptSecret(row.headersEnc, secret)) as Record<string, unknown>)
      : [],
  });
}

/** Convert a decrypted server row back to an UpstreamServerConfig for the aggregator. */
export function rowToConfig(row: Awaited<ReturnType<PlatformDb["listServers"]>>[number], secret: string): UpstreamServerConfig {
  const env = row.envEnc ? (safeJson(decryptSecret(row.envEnc, secret)) as Record<string, string>) : undefined;
  const headers = row.headersEnc ? (safeJson(decryptSecret(row.headersEnc, secret)) as Record<string, string>) : undefined;
  if (row.type === "stdio") {
    return {
      key: row.key,
      type: "stdio",
      command: row.command ?? "",
      args: row.args ? (safeJson(row.args) as string[]) : [],
      cwd: row.cwd ?? undefined,
      env,
    };
  }
  return {
    key: row.key,
    type: "http",
    url: row.url ?? "",
    headers,
  };
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

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
