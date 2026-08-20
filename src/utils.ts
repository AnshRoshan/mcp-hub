/** Small shared helpers: env access, argument coercion, HTTP JSON calls. */

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v.trim() !== "" ? v.trim() : undefined;
}

export function envBool(name: string, fallback = false): boolean {
  const v = env(name);
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
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
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
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

/** Reject a SQL statement when the module is read-only and the statement writes. */
export function assertReadOnly(
  sql: string,
  opts: { allowWrite: boolean; writeRe: RegExp; dbName: string; envVar: string },
): void {
  if (!opts.allowWrite && opts.writeRe.test(sql)) {
    throw new Error(
      `Refusing to run a write statement ("${sql.trim().split(/\s+/)[0].toUpperCase()}..."). ` +
        `${opts.dbName} is in read-only mode; set ${opts.envVar}=true to enable writes.`,
    );
  }
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
