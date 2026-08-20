import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { CallToolResult } from "@modelcontextprotocol/client";
import type { HttpServerConfig, StdioServerConfig, UpstreamServerConfig } from "../config.js";
import { withTimeout, env } from "../utils.js";

/** Per-tool-call timeout (default 60s). Prevents hanging upstreams from blocking callers. */
const CALL_TIMEOUT_MS = Math.max(Number(env("UPSTREAM_CALL_TIMEOUT_MS") ?? "60000"), 5_000);
/** Max response size in bytes (default 10 MB). Prevents memory exhaustion from buggy upstreams. */
const MAX_RESPONSE_BYTES = Math.max(Number(env("UPSTREAM_MAX_RESPONSE_BYTES") ?? "10485760"), 1_024);

export interface ProxiedTool {
  /** Namespaced name exposed to the client, e.g. `github_create_issue`. */
  name: string;
  /** Original name on the upstream server. */
  originalName: string;
  description: string;
  /** JSON Schema for the tool's input (from the upstream). */
  inputSchema: Record<string, unknown>;
}

/** Make a stable, collision-free namespaced name. */
function namespace(key: string, toolName: string): string {
  const clean = (s: string): string =>
    s.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "x";
  return `${clean(key)}_${clean(toolName)}`;
}

export type UpstreamStatus =
  | { state: "connected"; toolCount: number }
  | { state: "error"; error: string };

export class UpstreamServer {
  readonly config: UpstreamServerConfig;
  tools: ProxiedTool[] = [];
  status: UpstreamStatus = { state: "error", error: "not connected" };

  private client: Client | null = null;

  constructor(config: UpstreamServerConfig) {
    this.config = config;
  }

  get key(): string {
    return this.config.key;
  }

  async connect(): Promise<void> {
    const transport =
      this.config.type === "stdio"
        ? new StdioClientTransport({
            command: this.config.command,
            args: this.config.args ?? [],
            env: this.config.env,
            cwd: this.config.cwd,
            stderr: "ignore",
          })
        : new StreamableHTTPClientTransport(new URL(this.config.url), {
            requestInit: this.config.headers ? { headers: this.config.headers } : undefined,
          });

    const client = new Client({ name: "mcp-workstation", version: "0.1.0" });
    await withTimeout(client.connect(transport), 20_000, `connect to "${this.key}"`);
    this.client = client;

    // The v2 client auto-negotiates protocol era and auto-paginates listTools.
    const listed = await withTimeout(client.listTools(), 20_000, `list tools of "${this.key}"`);
    const seen = new Set<string>();
    this.tools = [];
    for (const tool of listed.tools) {
      const name = namespace(this.key, tool.name);
      if (seen.has(name)) continue;
      seen.add(name);
      this.tools.push({
        name,
        originalName: tool.name,
        description: tool.description ?? "",
        inputSchema: (tool.inputSchema as Record<string, unknown> | undefined) ?? { type: "object" },
      });
    }
    this.status = { state: "connected", toolCount: this.tools.length };
  }

  // fallow-ignore-next-line unused-class-member
  async call(originalName: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.client) throw new Error(`Upstream server "${this.key}" is not connected`);
    const result = await withTimeout(
      this.client.callTool({ name: originalName, arguments: args }),
      CALL_TIMEOUT_MS,
      `call "${this.key}/${originalName}"`,
    );
    // Enforce response size limit to prevent memory exhaustion.
    const size = JSON.stringify(result).length;
    if (size > MAX_RESPONSE_BYTES) {
      const truncated = {
        content: [{ type: "text" as const, text: `[truncated — response was ${size} bytes, limit ${MAX_RESPONSE_BYTES}]` }],
      };
      console.error(`[upstream] ${this.key}/${originalName}: response truncated (${size} > ${MAX_RESPONSE_BYTES} bytes)`);
      return truncated as unknown as CallToolResult;
    }
    return result;
  }

  // fallow-ignore-next-line unused-class-member
  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      // ignore close errors
    }
    this.client = null;
    this.tools = [];
  }
}

