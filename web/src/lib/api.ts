/* API client + shared types for the MCP Workstation dashboard. */

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "same-origin",
    ...opts,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = body && (body.error || body.message) ? body.error || body.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export interface User {
  id?: string;
  name?: string;
  email?: string;
  image?: string | null;
}

export interface ServerRow {
  id: string;
  key: string;
  type: "stdio" | "http";
  category?: string;
  enabled: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  envKeys: string[];
  headerKeys: string[];
}

export interface TokenRow {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ModuleInfo {
  name: string;
  category?: string;
  enabled: boolean;
  toolCount?: number;
  tools?: string[];
  reason?: string;
}

export interface StatusData {
  protocol?: string;
  node?: string;
  version?: string;
  totalTools?: number;
  modules?: ModuleInfo[];
}

export interface Skill {
  name: string;
  description: string;
  category: string;
  version: string;
  enabled: boolean;
  content?: string;
}

export interface MeData {
  disabledModules: string[];
  disabledTools: string[];
  skills: Skill[];
  liteCatalog: boolean;
}

export interface ServerBody {
  key: string;
  type: "stdio" | "http";
  category: string;
  env: Record<string, string>;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
}

/* ---- auth ---- */

export type SessionResult = { kind: "off" } | { kind: "signed-in"; user: User } | { kind: "signed-out" };

export async function getSession(): Promise<SessionResult> {
  const res = await fetch("/api/auth/get-session", { credentials: "same-origin" });
  if (res.status === 404) return { kind: "off" }; // platform mode off — no auth routes
  const data = await res.json().catch(() => null);
  return data && data.user ? { kind: "signed-in", user: data.user } : { kind: "signed-out" };
}

export interface AuthConfig {
  providers: { google: boolean; github: boolean };
  emailAuth: boolean;
}

/** Public pre-session config; null when unavailable → caller keeps defaults. */
export async function getAuthConfig(): Promise<AuthConfig | null> {
  try {
    return await api<AuthConfig>("/api/config");
  } catch {
    return null;
  }
}

export async function socialSignIn(provider: "google" | "github"): Promise<void> {  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ provider, callbackURL: window.location.origin + "/" }),
  });
  const data = await res.json();
  if (!res.ok || !data.url) {
    throw new Error(data.error?.message || data.message || "Sign-in could not start.");
  }
  window.location.href = data.url;
}

export async function emailSignIn(email: string, password: string): Promise<void> {
  const res = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (res.ok && !data.error) {
    window.location.reload();
    return;
  }
  // Fall back to sign-up (first-time email login may 422).
  const up = await fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email, password, name: email.split("@")[0] }),
  });
  const upData = await up.json();
  if (!up.ok || upData.error) throw new Error("Could not sign in or create an account.");
  window.location.reload();
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin" });
  window.location.reload();
}

/* ---- data ---- */

export const loadServers = () => api<{ servers: ServerRow[] }>("/api/servers").then((r) => r.servers || []);
export const loadTokens = () => api<{ tokens: TokenRow[] }>("/api/tokens").then((r) => r.tokens || []);
export const loadStatus = async (): Promise<StatusData | null> => {
  try {
    return await api<StatusData>("/api/status");
  } catch {
    return null;
  }
};
export const loadMe = () => api<MeData>("/api/me");

export interface UsageSummary {
  days: number;
  series: { date: string; calls: number; errors: number }[];
  totalCalls: number;
  totalErrors: number;
  avgLatencyMs: number;
  outBytes: number;
  todayCalls: number;
  topTools: { tool: string; calls: number }[];
}

export const loadUsage = (days = 14) => api<UsageSummary>(`/api/usage?days=${days}`);

export const saveServer = (body: ServerBody, id?: string) =>
  id ? api(`/api/servers/${id}`, { method: "PATCH", body: JSON.stringify(body) }) : api("/api/servers", { method: "POST", body: JSON.stringify(body) });

export const toggleServer = (id: string, enabled: boolean) =>
  api(`/api/servers/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });

export const deleteServer = (id: string) => api(`/api/servers/${id}`, { method: "DELETE" });

export const createToken = (name: string) =>
  api<{ token: { token: string } }>("/api/tokens", { method: "POST", body: JSON.stringify({ name }) });

export const revokeToken = (id: string) => api(`/api/tokens/${id}`, { method: "DELETE" });

export const putPrefs = (prefs: { disabledModules?: string[]; disabledTools?: string[]; enabledSkills?: string[]; liteCatalog?: boolean }) =>
  api("/api/prefs", { method: "PUT", body: JSON.stringify(prefs) });

export const putSkills = (enabledSkills: string[]) =>
  api("/api/skills", { method: "PUT", body: JSON.stringify({ enabledSkills }) });

/* ---- per-user builtin credentials ---- */

export interface SecretSpec {
  name: string;
  module: string;
  label: string;
  hint?: string;
}

export interface SecretsData {
  allowed: SecretSpec[];
  keys: string[];
}

export const loadSecrets = () => api<SecretsData>("/api/secrets");

export const putSecret = (name: string, value: string) =>
  api<{ ok: boolean; keys: string[] }>("/api/secrets", { method: "PUT", body: JSON.stringify({ values: { [name]: value } }) });

export const deleteSecret = (name: string) =>
  api(`/api/secrets/${encodeURIComponent(name)}`, { method: "DELETE" });

/* ---- official MCP Registry discovery (proxied through /api) ---- */

export interface RegistryServer {
  name: string;
  description: string;
  version: string;
  repository: string;
  url: string;
  transport: string;
}

export const searchRegistry = (search: string) =>
  api<{ servers: RegistryServer[] }>(`/api/registry?search=${encodeURIComponent(search)}&limit=10`).then((r) => r.servers || []);

/** Derive a valid server key from a reverse-DNS registry name. */
export function registryKey(name: string): string {
  const last = (name.split("/").pop() || name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return ((last || "registry").slice(0, 24)).replace(/_+$/, "") || "registry";
}

/* ---- helpers ---- */

/** Human-readable message from a thrown value, with a fallback. */
export function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** Parse one KEY=VALUE (or Key: Value) entry per line into an object. */
function parseLines(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (text || "").split("\n")) {
    const idx = line.indexOf(sep);
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export const parseKV = (text: string) => parseLines(text, "=");
export const parseHeaders = (text: string) => parseLines(text, ":");
