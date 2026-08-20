import { DatabaseSync } from "node:sqlite";
import { getSchema } from "better-auth/db";
import { randomUUID } from "node:crypto";

/**
 * Platform database: one SQLite file that holds BOTH the Better Auth tables
 * (user / session / account / verification) and the application tables
 * (per-user MCP servers, API tokens, user preferences).
 *
 * The auth schema is derived from Better Auth's own `getSchema()` so it stays
 * in sync with the installed version — no manual migration files.
 */

export interface McpServerRow {
  id: string;
  userId: string;
  key: string;
  type: "stdio" | "http";
  command?: string;
  args?: string;
  cwd?: string;
  url?: string;
  headersEnc?: string;
  envEnc?: string;
  enabled: number;
  category?: string;
  createdAt: string;
}

/** SQL literal for the "never customized → all skills on" default. */
const SKILLS_ALL_DEFAULT = `'${JSON.stringify(["*"])}'`;

function safeJsonArray(text: string): string[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function safeJsonSet(text: string): Set<string> {
  return new Set(safeJsonArray(text));
}

export interface ApiTokenRow {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface UserPrefsRow {
  userId: string;
  disabledModules: string; // JSON array of builtin module names the user turned OFF
  disabledTools: string; // JSON array of individual tool names the user turned OFF
  enabledSkills: string; // JSON array of skill names the user turned ON
  updatedAt: string;
}

function authColType(type: string): string {
  switch (type) {
    case "number":
      return "INTEGER";
    case "boolean":
      return "INTEGER";
    case "date":
      return "INTEGER";
    case "json":
      return "TEXT";
    default:
      return "TEXT";
  }
}

export class PlatformDb {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.createSchema();
  }

  private createSchema(): void {
    // Better Auth core tables (schema derived from the installed version).
    const schema = getSchema({});
    for (const [table, def] of Object.entries(schema)) {
      const cols = ["id TEXT PRIMARY KEY"];
      const fks: string[] = [];
      const indexes: string[] = [];
      for (const [name, f] of Object.entries(def.fields)) {
        const type = authColType(String(f.type));
        let col = `${name} ${type}`;
        if (f.required) col += " NOT NULL";
        if (f.unique) col += " UNIQUE";
        if (f.references) {
          fks.push(
            `FOREIGN KEY (${name}) REFERENCES ${f.references.model}(${f.references.field})` +
              ` ON DELETE ${f.references.onDelete ?? "CASCADE"}`,
          );
        }
        if (f.index) indexes.push(`CREATE INDEX IF NOT EXISTS idx_${table}_${name} ON ${table} (${name})`);
        cols.push(col);
      }
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (${cols.join(", ")}${fks.length ? ", " + fks.join(", ") : ""})`,
      );
      for (const i of indexes) this.db.exec(i);
    }

    // Application tables.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('stdio','http')),
        command TEXT,
        args TEXT,
        cwd TEXT,
        url TEXT,
        headers_enc TEXT,
        env_enc TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_servers_user ON mcp_servers (user_id);

      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens (user_id);

      CREATE TABLE IF NOT EXISTS user_prefs (
        user_id TEXT PRIMARY KEY,
        disabled_modules TEXT NOT NULL DEFAULT '[]',
        disabled_tools TEXT NOT NULL DEFAULT '[]',
        enabled_skills TEXT NOT NULL DEFAULT ${SKILLS_ALL_DEFAULT},
        updated_at TEXT NOT NULL
      );
    `);

    this.migrate();
  }

  /**
   * Bring pre-existing databases up to date (new columns added after a table
   * was first created). Uses PRAGMA table_info so it is safe to run every boot.
   */
  private migrate(): void {
    const columns = (table: string): Set<string> => {
      const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
      return new Set(rows.map((r) => r.name));
    };

    const servers = columns("mcp_servers");
    if (!servers.has("category")) {
      this.db.exec("ALTER TABLE mcp_servers ADD COLUMN category TEXT");
    }

    const prefs = columns("user_prefs");
    if (!prefs.has("disabled_tools")) {
      this.db.exec("ALTER TABLE user_prefs ADD COLUMN disabled_tools TEXT NOT NULL DEFAULT '[]'");
    }
    if (!prefs.has("enabled_skills")) {
      this.db.exec(`ALTER TABLE user_prefs ADD COLUMN enabled_skills TEXT NOT NULL DEFAULT ${SKILLS_ALL_DEFAULT}`);
    }
  }

  close(): void {
    this.db.close();
  }

  /* ---------------- mcp_servers ---------------- */

  listServers(userId: string): McpServerRow[] {
    return this.db
      .prepare(
        `SELECT id, user_id AS userId, key, type, command, args, cwd, url,
                headers_enc AS headersEnc, env_enc AS envEnc, enabled, category, created_at AS createdAt
         FROM mcp_servers WHERE user_id = ? ORDER BY created_at ASC`,
      )
      .all(userId) as unknown as McpServerRow[];
  }

  getServer(id: string, userId: string): McpServerRow | undefined {
    return this.db
      .prepare(
        `SELECT id, user_id AS userId, key, type, command, args, cwd, url,
                headers_enc AS headersEnc, env_enc AS envEnc, enabled, category, created_at AS createdAt
         FROM mcp_servers WHERE id = ? AND user_id = ?`,
      )
      .get(id, userId) as unknown as McpServerRow | undefined;
  }

  insertServer(row: Omit<McpServerRow, "createdAt">): McpServerRow {
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO mcp_servers (id, user_id, key, type, command, args, cwd, url, headers_enc, env_enc, enabled, category, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.userId, row.key, row.type, row.command ?? null, row.args ?? null, row.cwd ?? null,
        row.url ?? null, row.headersEnc ?? null, row.envEnc ?? null, row.enabled, row.category ?? null, createdAt);
    return { ...row, createdAt };
  }

  updateServer(
    id: string,
    userId: string,
    fields: Partial<Pick<McpServerRow, "key" | "command" | "args" | "cwd" | "url" | "headersEnc" | "envEnc" | "enabled" | "category">>,
  ): McpServerRow | undefined {
    const existing = this.getServer(id, userId);
    if (!existing) return undefined;
    const next = { ...existing, ...fields };
    this.db
      .prepare(
        `UPDATE mcp_servers SET key = ?, type = ?, command = ?, args = ?, cwd = ?, url = ?, headers_enc = ?, env_enc = ?, enabled = ?, category = ? WHERE id = ? AND user_id = ?`,
      )
      .run(next.key, next.type, next.command ?? null, next.args ?? null, next.cwd ?? null, next.url ?? null,
        next.headersEnc ?? null, next.envEnc ?? null, next.enabled, next.category ?? null, id, userId);
    return this.getServer(id, userId);
  }

  deleteServer(id: string, userId: string): boolean {
    const res = this.db.prepare("DELETE FROM mcp_servers WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }

  /* ---------------- api_tokens ---------------- */

  insertToken(userId: string, name: string, tokenHash: string): ApiTokenRow {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare("INSERT INTO api_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, userId, name, tokenHash, createdAt);
    return { id, userId, name, tokenHash, createdAt, lastUsedAt: null };
  }

  listTokens(userId: string): ApiTokenRow[] {
    return this.db
      .prepare(
        `SELECT id, user_id AS userId, name, token_hash AS tokenHash,
                created_at AS createdAt, last_used_at AS lastUsedAt
         FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .all(userId) as unknown as ApiTokenRow[];
  }

  getTokenByHash(tokenHash: string): ApiTokenRow | undefined {
    return this.db
      .prepare(
        `SELECT id, user_id AS userId, name, token_hash AS tokenHash,
                created_at AS createdAt, last_used_at AS lastUsedAt
         FROM api_tokens WHERE token_hash = ?`,
      )
      .get(tokenHash) as unknown as ApiTokenRow | undefined;
  }

  touchToken(id: string): void {
    this.db
      .prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  deleteToken(id: string, userId: string): boolean {
    const res = this.db.prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }

  /* ---------------- user_prefs ---------------- */

  getPrefs(userId: string): UserPrefsRow | undefined {
    return this.db
      .prepare(
        `SELECT user_id AS userId, disabled_modules AS disabledModules, disabled_tools AS disabledTools,
                enabled_skills AS enabledSkills, updated_at AS updatedAt
         FROM user_prefs WHERE user_id = ?`,
      )
      .get(userId) as unknown as UserPrefsRow | undefined;
  }

  /**
   * Update the user's prefs. Only the keys present in `patch` change;
   * omitted keys keep their current value.
   */
  setPrefs(
    userId: string,
    patch: { disabledModules?: string[]; disabledTools?: string[]; enabledSkills?: string[] },
  ): UserPrefsRow {
    const updatedAt = new Date().toISOString();
    const existing = this.getPrefs(userId);
    const json = (key: keyof UserPrefsRow, value?: string[]) => {
      const fallback = existing
        ? safeJsonArray(existing[key] as string)
        : // Fresh prefs row: skills untouched → "all on" sentinel.
          key === "enabledSkills"
          ? ["*"]
          : [];
      return JSON.stringify(value ?? fallback);
    };
    const disabledModules = json("disabledModules", patch.disabledModules);
    const disabledTools = json("disabledTools", patch.disabledTools);
    const enabledSkills = json("enabledSkills", patch.enabledSkills);
    this.db
      .prepare(
        `INSERT INTO user_prefs (user_id, disabled_modules, disabled_tools, enabled_skills, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           disabled_modules = ?, disabled_tools = ?, enabled_skills = ?, updated_at = ?`,
      )
      .run(userId, disabledModules, disabledTools, enabledSkills, updatedAt,
        disabledModules, disabledTools, enabledSkills, updatedAt);
    return { userId, disabledModules, disabledTools, enabledSkills, updatedAt };
  }

  /** Modules the user has explicitly disabled (empty = all builtins on). */
  // fallow-ignore-next-line unused-class-member
  disabledModules(userId: string): Set<string> {
    const prefs = this.getPrefs(userId);
    if (!prefs) return new Set();
    return safeJsonSet(prefs.disabledModules);
  }

  /** Individual tool names the user has explicitly disabled. */
  // fallow-ignore-next-line unused-class-member
  disabledTools(userId: string): Set<string> {
    const prefs = this.getPrefs(userId);
    if (!prefs) return new Set();
    return safeJsonSet(prefs.disabledTools);
  }

  /** Skill names the user has enabled (empty = none of the skills hub). */
  // fallow-ignore-next-line unused-class-member
  enabledSkills(userId: string): Set<string> {
    const prefs = this.getPrefs(userId);
    if (!prefs) return new Set();
    return safeJsonSet(prefs.enabledSkills);
  }
}
