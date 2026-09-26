import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "../registry.js";
import type { StorageScope } from "../scope.js";
import { jsonResult } from "../result.js";
import { assertReadOnly, envBool, SQL_WRITE_RE, stripSqlComments, str } from "../utils.js";

/**
 * Operator-level switch, read from the process env only: a tenant's stored
 * secrets must not be able to unlock writes on their own database.
 */
const allowWrite = envBool("SQLITE_ALLOW_WRITE", false);

interface SqliteDb {
  prepare(sql: string): {
    all: (...p: unknown[]) => unknown[];
    run: (...p: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
  };
  close(): void;
}

/** Narrow view of `node:sqlite`'s `DatabaseSync` — enough for these tools. */
type DbCtor = new (file: string, options?: { readOnly?: boolean }) => SqliteDb;

let Database: DbCtor | undefined;
let engineError: string | undefined;
try {
  // node:sqlite ships with Node.js >= 22.5 (unflagged from 23.4).
  const { DatabaseSync } = await import("node:sqlite");
  Database = DatabaseSync as unknown as DbCtor;
} catch (err) {
  engineError = err instanceof Error ? err.message : String(err);
}

interface Handle {
  db: SqliteDb | null;
  reason?: string;
}

const handles = new Map<string, Handle>();

/** One open database per path, memoized: catalogs are rebuilt per request. */
function handleFor(file: string): Handle {
  let handle = handles.get(file);
  if (!handle) {
    handle = openDb(file);
    handles.set(file, handle);
  }
  return handle;
}

function openDb(file: string): Handle {
  if (!Database) return { db: null, reason: `node:sqlite unavailable: ${engineError ?? "unknown error"}` };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!allowWrite && !fs.existsSync(file)) {
      // A read-only handle cannot create its file, so bootstrap an empty
      // database once and reopen it under the read-only flag.
      new Database(file).close();
    }
    // Engine-level enforcement: the statement filter in `assertReadOnly` only
    // shapes the error message, so a novel write syntax cannot slip past it
    // and mutate the file.
    return { db: new Database(file, allowWrite ? {} : { readOnly: true }) };
  } catch (err) {
    return { db: null, reason: `sqlite open failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function paramsOf(args: Record<string, unknown>): unknown[] {
  if (args.params === undefined || args.params === null) return [];
  if (Array.isArray(args.params)) return args.params;
  throw new Error("`params` must be an array of positional values");
}

function runSql(db: SqliteDb, sql: string, params: unknown[]): unknown {
  const stmt = db.prepare(sql);
  if (/^\s*(select|pragma|explain|with)\b/i.test(stripSqlComments(sql))) {
    return stmt.all(...params);
  }
  const res = stmt.run(...params);
  return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) };
}

/** The `sqlite_*` tools bound to one scope's database file. */
export function sqliteModule(scope: StorageScope): { defs: ToolDef[]; enabled: boolean; reason?: string } {
  const { db, reason } = handleFor(scope.sqlitePath);
  if (!db) return { defs: [], enabled: false, reason };
  return {
    enabled: true,
    defs: [
      {
        name: "sqlite_list_tables",
        description: "List tables in the SQLite database.",
        inputSchema: { type: "object", properties: {} },
        handler: () => {
          const rows = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all() as { name: string }[];
          return jsonResult(rows.map((r) => r.name));
        },
      },
      {
        name: "sqlite_query",
        description: "Run a SQL statement against SQLite. Read-only by default; writes blocked unless SQLITE_ALLOW_WRITE=true.",
        inputSchema: {
          type: "object",
          properties: {
            sql: { type: "string" },
            params: { type: "array", items: {}, description: "Optional positional parameters" },
          },
          required: ["sql"],
        },
        handler: (args) => {
          const sql = str(args.sql);
          assertReadOnly(sql, { allowWrite, writeRe: SQL_WRITE_RE, dbName: "SQLite", envVar: "SQLITE_ALLOW_WRITE" });
          return jsonResult(runSql(db, sql, paramsOf(args)));
        },
      },
      {
        name: "sqlite_execute",
        description: "Execute a write statement on SQLite (requires SQLITE_ALLOW_WRITE=true).",
        inputSchema: {
          type: "object",
          properties: {
            sql: { type: "string" },
            params: { type: "array", items: {} },
          },
          required: ["sql"],
        },
        handler: (args) => {
          const sql = str(args.sql);
          if (!allowWrite) throw new Error("SQLite writes are disabled. Set SQLITE_ALLOW_WRITE=true to enable.");
          return jsonResult(runSql(db, sql, paramsOf(args)));
        },
      },
    ],
  };
}
