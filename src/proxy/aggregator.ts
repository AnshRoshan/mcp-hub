import type { CallToolResult } from "@modelcontextprotocol/client";
import type { UpstreamServerConfig } from "../config.js";
import { UpstreamServer, type ProxiedTool } from "./upstream.js";

export interface UpstreamSummary {
  key: string;
  type: "stdio" | "http";
  detail: string;
  state: "connected" | "error";
  toolCount: number;
  error?: string;
}

export class UpstreamAggregator {
  private servers: UpstreamServer[] = [];

  /** Connect (or reconnect) all upstream servers from config. Safe to call repeatedly. */
  async connectAll(configs: UpstreamServerConfig[]): Promise<void> {
    await this.disconnectAll();
    for (const config of configs) {
      const server = new UpstreamServer(config);
      this.servers.push(server);
      try {
        await server.connect();
        console.error(`[mcp-workstation]   ✔ ${config.key}: ${server.tools.length} tools`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        server.status = { state: "error", error: message };
        console.error(`[mcp-workstation]   ✖ ${config.key}: ${message}`);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    const closing = this.servers.map((s) => s.close());
    this.servers = [];
    await Promise.allSettled(closing);
  }

  /** All proxied tools across all connected servers. */
  allTools(): ProxiedTool[] {
    return this.servers.flatMap((s) => s.tools);
  }

  /** Find which server owns a namespaced tool name. */
  private find(name: string): { server: UpstreamServer; tool: ProxiedTool } | undefined {
    for (const server of this.servers) {
      const tool = server.tools.find((t) => t.name === name);
      if (tool) return { server, tool };
    }
    return undefined;
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const found = this.find(name);
    if (!found) {
      throw new Error(`Unknown tool "${name}". Run workstation_status to see available tools.`);
    }
    if (found.server.status.state !== "connected") {
      throw new Error(`Upstream server "${found.server.key}" is not connected.`);
    }
    return found.server.call(found.tool.originalName, args);
  }

  /** Reconnect a single server by key with a fresh config. */
  async reconnect(key: string, config: UpstreamServerConfig): Promise<void> {
    const idx = this.servers.findIndex((s) => s.key === key);
    const old = idx >= 0 ? this.servers[idx] : null;
    if (old) {
      await old.close();
      this.servers.splice(idx, 1);
    }
    const server = new UpstreamServer(config);
    this.servers.push(server);
    try {
      await server.connect();
      console.error(`[mcp-workstation]   ✔ ${config.key} (reconnected): ${server.tools.length} tools`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      server.status = { state: "error", error: message };
      console.error(`[mcp-workstation]   ✖ ${config.key} (reconnect failed): ${message}`);
    }
  }

  /** Get the current connection state of a server by key. */
  getState(key: string): { connected: boolean } | undefined {
    const s = this.servers.find((s) => s.key === key);
    if (!s) return undefined;
    return { connected: s.status.state === "connected" };
  }

  summaries(): UpstreamSummary[] {
    return this.servers.map((s) => ({
      key: s.key,
      type: s.config.type,
      detail:
        s.config.type === "stdio"
          ? `${s.config.command} ${(s.config.args ?? []).join(" ")}`.trim()
          : s.config.url,
      state: s.status.state,
      toolCount: s.status.state === "connected" ? s.status.toolCount : 0,
      error: s.status.state === "error" ? s.status.error : undefined,
    }));
  }
}
