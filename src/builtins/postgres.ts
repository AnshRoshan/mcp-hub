import pg from "pg";
import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { assertReadOnly, env, envBool, str } from "../utils.js";

const connectionString = env("DATABASE_URL");
const allowWrite = envBool("PG_ALLOW_WRITE", false);

const pool = connectionString
  ? new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 10_000 })
  : null;

const WRITE_RE = /^\s*(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|vacuum|copy|merge|rename|call)\b/i;

export const postgresDefs: ToolDef[] = [
  {
    name: "pg_list_tables",
    description: "List tables in a Postgres schema.",
    inputSchema: {
      type: "object",
      properties: { schema: { type: "string", description: "Schema (default public)" } },
    },
    handler: async (args) => {
      const schema = str(args.schema, "public");
      const { rows } = await pool!.query(
        `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
        [schema],
      );
      return jsonResult(rows);
    },
  },
  {
    name: "pg_describe_table",
    description: "Describe the columns of a Postgres table.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string" },
        schema: { type: "string", description: "Schema (default public)" },
      },
      required: ["table"],
    },
    handler: async (args) => {
      const schema = str(args.schema, "public");
      const table = str(args.table);
      const { rows } = await pool!.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table],
      );
      if (rows.length === 0) throw new Error(`Table "${schema}.${table}" not found`);
      return jsonResult(rows);
    },
  },
  {
    name: "pg_query",
    description:
      "Run a SQL query against Postgres. Read-only by default; write statements are blocked unless PG_ALLOW_WRITE=true.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string" },
        params: { type: "array", items: {}, description: "Optional positional parameters ($1, $2, ...)" },
      },
      required: ["sql"],
    },
    handler: async (args) => {
      const sql = str(args.sql);
      assertReadOnly(sql, { allowWrite, writeRe: WRITE_RE, dbName: "Postgres", envVar: "PG_ALLOW_WRITE" });
      const params = Array.isArray(args.params) ? args.params : [];
      const result = await pool!.query(sql, params);
      return jsonResult({ rowCount: result.rowCount ?? null, rows: result.rows });
    },
  },
];

export const postgresEnabled = connectionString
  ? { enabled: true as const }
  : { enabled: false as const, reason: "DATABASE_URL not set" };
