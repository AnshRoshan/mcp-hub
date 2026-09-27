import fs from "node:fs";
import path from "node:path";
import { env } from "./utils.js";

export interface StdioServerConfig {
  key: string;
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpServerConfig {
  key: string;
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type UpstreamServerConfig = StdioServerConfig | HttpServerConfig;

export interface WorkstationConfig {
  port: number;
  mcpPath: string;
  filesystemRoots: string[];
  memoryFile: string;
  sqlitePath: string;
  upstreamServers: UpstreamServerConfig[];
}

const DEFAULT_SERVERS_FILE = path.resolve(process.cwd(), "config", "servers.json");

function defaults(): WorkstationConfig {
  return {
    port: numFromEnv("PORT", 3125),
    mcpPath: env("MCP_PATH") ?? "/mcp",
    filesystemRoots: env("FILESYSTEM_ROOTS")
      ? env("FILESYSTEM_ROOTS")!.split(",").map((s) => s.trim()).filter(Boolean)
      : [path.resolve(process.cwd(), "data", "workspace")],
    memoryFile: env("MEMORY_FILE")
      ? path.resolve(process.cwd(), env("MEMORY_FILE")!)
      : path.resolve(process.cwd(), "data", "memory.json"),
    sqlitePath: env("SQLITE_PATH")
      ? path.resolve(process.cwd(), env("SQLITE_PATH")!)
      : path.resolve(process.cwd(), "data", "workstation.db"),
    upstreamServers: [],
  };
}

function numFromEnv(name: string, fallback: number): number {
  const v = env(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadUpstreamServers(config: WorkstationConfig): UpstreamServerConfig[] {
  const file = env("MCP_WORKSTATION_SERVERS") ?? DEFAULT_SERVERS_FILE;
  if (!fs.existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    console.error(`[mcp-workstation] could not parse ${file}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
  const list = raw !== null && typeof raw === "object" ? (raw as { servers?: unknown }).servers : undefined;
  if (!Array.isArray(list)) return [];
  const servers: UpstreamServerConfig[] = [];
  for (const entry of list) {
    const parsed = parseUpstreamEntry(entry);
    if (parsed) servers.push(parsed);
  }
  return servers;
}

/**
 * Coerce a config object into string→string. `servers.json` is hand-edited, and
 * a numeric or boolean value would otherwise be passed straight into spawn env
 * or request headers, where the failure surfaces far from its cause.
 */
function stringMap(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined || typeof v === "object") {
      console.error(`[mcp-workstation] skipping config entry "${k}": value must be a scalar`);
      continue;
    }
    out[k] = String(v);
  }
  return out;
}

/** Parse one servers.json entry into a config, or log and skip it. */
function parseUpstreamEntry(entry: unknown): UpstreamServerConfig | null {
  if (entry === null || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  if (e.enabled === false) return null;
  const key = typeof e.key === "string" && e.key.trim() ? e.key.trim() : null;
  if (!key) {
    console.error("[mcp-workstation] skipping upstream server entry with no `key`");
    return null;
  }
  if (e.type === "stdio" && typeof e.command === "string") {
    return {
      key,
      type: "stdio",
      command: e.command,
      args: Array.isArray(e.args) ? e.args.map(String) : [],
      env: stringMap(e.env),
      cwd: typeof e.cwd === "string" ? e.cwd : undefined,
    };
  }
  if (e.type === "http" && typeof e.url === "string") {
    return {
      key,
      type: "http",
      url: e.url,
      headers: stringMap(e.headers),
    };
  }
  console.error(`[mcp-workstation] skipping upstream server "${key}": needs type "stdio"+command or type "http"+url`);
  return null;
}

/**
 * Executables a *user* may name as an stdio upstream command. The hub spawns
 * these as its own OS user, so an unrestricted command is remote code
 * execution for anyone who can reach the dashboard. Empty by default, which
 * refuses user-registered stdio servers outright. Entries in
 * `config/servers.json` are operator-owned and always allowed.
 */
export function allowedStdioCommands(): ReadonlySet<string> {
  const raw = env("STDIO_ALLOWED_COMMANDS");
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((name) => normalizeStdioCommand(name))
      .filter((name): name is string => name !== undefined),
  );
}

/**
 * A command is acceptable only as a bare executable name: no path, because an
 * allowlisted name at an attacker-chosen path (`/tmp/evil/npx`) is not the
 * binary the allowlist was written to trust.
 */
function normalizeStdioCommand(raw: string): string | undefined {
  const name = raw.trim();
  if (!name || name.includes("/") || name.includes("\\")) return undefined;
  return name.toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
}

/** Whether a user-supplied stdio command may be spawned. */
export function stdioCommandAllowed(command: string): boolean {
  const allowed = allowedStdioCommands();
  if (allowed.size === 0) return false;
  const name = normalizeStdioCommand(command);
  return name !== undefined && allowed.has(name);
}

export function loadConfig(): WorkstationConfig {
  const config = defaults();
  config.upstreamServers = loadUpstreamServers(config);
  return config;
}
