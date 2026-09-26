import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { assertReadOnly, env, envBool, SQL_WRITE_RE, stripSqlComments, str, strArr } from "../utils.js";

const allowWrite = envBool("SQLITE_ALLOW_WRITE", false);
const SQLITE_PATH = env("SQLITE_PATH")
  ? path.resolve(process.cwd(), env("SQLITE_PATH")!)
  : path.resolve(process.cwd(), "data", "workstation.db");

let available = true;
let db: { prepare: (sql: string) => { all: (...p: unknown[]) => unknown[]; run: (...p: unknown[]) => { changes: number; lastInsertRowid: number | bigint } } } | null = null;
let openError: string | undefined;

try {
  // node:sqlite ships with Node.js >= 22.5 (unflagged from 23.4).
  const { DatabaseSync } = await import("node:sqlite");
  fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
  if (!allowWrite && !fs.existsSync(SQLITE_PATH)) {
    // A read-only handle cannot create its file, so bootstrap an empty database
    // once and reopen it under the read-only flag.
    new DatabaseSync(SQLITE_PATH).close();
  }
  // Engine-level enforcement: the statement filter below only shapes the error
  // message, so a novel write syntax cannot slip past it and mutate the file.
  db = new DatabaseSync(SQLITE_PATH, allowWrite ? {} : { readOnly: true }) as unknown as typeof db;
} catch (err) {
  available = false;
  openError = err instanceof Error ? err.message : String(err);
}

function paramsOf(args: Record<string, unknown>): unknown[] {
  if (args.params === undefined || args.params === null) return [];
  if (Array.isArray(args.params)) return args.params;
  throw new Error("`params` must be an array of positional values");
}

function runSql(sql: string, params: unknown[]): unknown {
  const stmt = db!.prepare(sql);
  if (/^\s*(select|pragma|explain|with)\b/i.test(stripSqlComments(sql))) {
    return stmt.all(...params);
  }
  const res = stmt.run(...params);
  return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) };
}

export const sqliteDefs: ToolDef[] = [
  {
    name: "sqlite_list_tables",
    description: "List tables in the SQLite database.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const rows = db!.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all() as { name: string }[];
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
      return jsonResult(runSql(sql, paramsOf(args)));
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
      return jsonResult(runSql(sql, paramsOf(args)));
    },
  },
];

export const sqliteEnabled = !available
  ? { enabled: false as const, reason: `node:sqlite unavailable: ${openError ?? "unknown error"}` }
  : { enabled: true as const };
