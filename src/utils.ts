/** Small shared helpers: env access, argument coercion, HTTP JSON calls. */

/**
 * Where a module reads credentials/config from. In platform mode each user
 * gets a layered source: their own secrets first, then process env — so a
 * builtin's GitHub/Notion/Slack calls can run as the requesting user, not
 * the server owner.
 */
export interface EnvSource {
  get(name: string): string | undefined;
}

export const processEnv: EnvSource = {
  get: (name) => env(name),
};

/** Lookup in `primary`, falling back to `secondary` for unset names. */
export function layeredEnv(primary: Record<string, string | undefined>, secondary: EnvSource): EnvSource {
  return {
    get: (name) => {
      const v = primary[name];
      return v !== undefined && v.trim() !== "" ? v.trim() : secondary.get(name);
    },
  };
}

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v.trim() !== "" ? v.trim() : undefined;
}

export function envBool(name: string, fallback = false): boolean {
  const v = env(name);
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

/**
 * Whether the workstation runs as a multi-user platform. Single source of
 * truth for "is this deployment shared", used by auth wiring, rate limiting
 * and the catalog so they can never disagree.
 */
export function platformModeEnabled(): boolean {
  return env("BETTER_AUTH_SECRET") !== undefined;
}

/* ---- argument coercion for handlers (args come as unknown) ---- */

export function str(v: unknown, fallback = ""): string {
  return v === undefined || v === null ? fallback : String(v);
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

export function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/* ---- HTTP helpers ---- */

/** Ceiling on a response body any module may buffer through httpJson. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown; // parsed JSON when possible, otherwise raw text
}

/** Fetch with timeout. Parses JSON bodies when possible. */
export async function httpJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Read against a ceiling rather than res.text(): an upstream — or a URL an
    // agent chose to follow — can stream far more than the process should hold.
    const bytes = await readCapped(res.body, maxBytes);
    const text = bytes.toString("utf-8");
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw text
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: res.status, statusText: res.statusText, headers, body };
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Build a JSON API client: base URL + default headers + readable errors. */
export function apiClient(
  baseUrl: string,
  label: string,
  defaultHeaders: Record<string, string>,
): (pathname: string, init?: RequestInit) => Promise<unknown> {
  return async (pathname, init = {}) => {
    const res = await httpJson(`${baseUrl}${pathname}`, {
      ...init,
      headers: { ...defaultHeaders, ...(init.headers as Record<string, string> | undefined) },
    });
    assertOk(res, `${label} ${pathname}`);
    return res.body;
  };
}

/** Reject if the response status is >= 400, with a readable message. */
export function assertOk(res: HttpResponse, context: string): void {
  if (res.status >= 400) {
    const detail =
      res.body !== null && typeof res.body === "object"
        ? (res.body as { message?: unknown; error?: unknown }).message ??
          (res.body as { error?: unknown }).error ??
          ""
        : "";
    throw new Error(`${context} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
  }
}

/** Fetch JSON with a timeout and a readable per-service error message. */
export async function fetchJson(url: string, label: string, timeoutMs = 15_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`${label} API error ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error(`${label} request timed out`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One read-only statement classifier for every SQL builtin. The engines are
 * the real enforcement; this exists to give a readable error before a query is
 * dispatched. Keeping it in one place stops the per-module copies drifting
 * apart, which is how the SQLite and Postgres guards diverged once already.
 * Assumes the input has been through stripSqlComments, so a comment prefix
 * cannot hide the leading keyword.
 */
export const SQL_WRITE_RE =
  /^\s*(insert|update|delete|drop|alter|create|truncate|attach|detach|reindex|vacuum|grant|revoke|comment|copy|merge|rename|call)\b|^\s*pragma\s+\w+\s*=|^\s*with\b[^;]*\b(insert|update|delete|drop|create)\b/i;

/** Reject a SQL statement when the module is read-only and the statement writes. */
export function assertReadOnly(
  sql: string,
  opts: { allowWrite: boolean; writeRe: RegExp; dbName: string; envVar: string },
): void {
  if (opts.allowWrite) return;
  const head = stripSqlComments(sql);
  if (hasSecondStatement(head)) {
    throw new Error(
      `${opts.dbName} is in read-only mode and accepts one statement per call; ` +
        "set " + opts.envVar + "=true to allow writes.",
    );
  }
  if (opts.writeRe.test(head)) {
    throw new Error(
      `Refusing to run a write statement ("${head.split(/\s+/)[0]?.toUpperCase() ?? ""}..."). ` +
        `${opts.dbName} is in read-only mode; set ${opts.envVar}=true to enable writes.`,
    );
  }
}

/**
 * Drop whitespace and leading `--` / block comments so a statement cannot hide
 * its real first keyword behind a comment prefix.
 */
export function stripSqlComments(sql: string): string {
  let out = sql;
  for (;;) {
    const trimmed = out.trimStart();
    if (trimmed.startsWith("--")) {
      const nl = trimmed.indexOf("\n");
      if (nl === -1) return "";
      out = trimmed.slice(nl + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      if (end === -1) return "";
      out = trimmed.slice(end + 2);
      continue;
    }
    return trimmed;
  }
}

/**
 * Whether a second statement follows the first. Semicolons inside single or
 * double quotes do not count; a trailing `;` is normal and does not either.
 */
export function hasSecondStatement(sql: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote !== null) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === "'") i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === ";") return sql.slice(i + 1).trim().length > 0;
  }
  return false;
}

/** Race a promise against a timeout. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
