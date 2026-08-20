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
      env: typeof e.env === "object" && e.env !== null ? (e.env as Record<string, string>) : undefined,
      cwd: typeof e.cwd === "string" ? e.cwd : undefined,
    };
  }
  if (e.type === "http" && typeof e.url === "string") {
    return {
      key,
      type: "http",
      url: e.url,
      headers: typeof e.headers === "object" && e.headers !== null ? (e.headers as Record<string, string>) : undefined,
    };
  }
  console.error(`[mcp-workstation] skipping upstream server "${key}": needs type "stdio"+command or type "http"+url`);
  return null;
}

export function loadConfig(): WorkstationConfig {
  const config = defaults();
  config.upstreamServers = loadUpstreamServers(config);
  return config;
}
