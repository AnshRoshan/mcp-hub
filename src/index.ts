import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createWorkstation, type Workstation } from "./server.js";
import { startHttp } from "./http.js";
import { createAuth, loadAuthConfig, platformEnabled } from "./platform/auth.js";
import { PlatformDb } from "./platform/db.js";

const useStdio = process.argv.includes("--stdio");

interface PlatformRuntime {
  db: PlatformDb;
  auth: ReturnType<typeof createAuth>;
  secret: string;
  baseURL: string;
}

let wsRef: Workstation | null = null;
let platform: PlatformRuntime | null = null;

async function main(): Promise<void> {
  // Platform mode is on whenever BETTER_AUTH_SECRET is set.
  if (platformEnabled()) {
    platform = setupPlatform();
  }

  const ws = createWorkstation({
    ...(platform ? { platform: { db: platform.db, secret: platform.secret, platformOn: true } } : {}),
  });
  wsRef = ws;
  await ws.init();

  if (useStdio) {
    const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");
    const server = ws.buildServer();
    await server.connect(new StdioServerTransport());
    console.error("[mcp-workstation] running over stdio");
  } else {
    startHttp(ws.handler, {
      port: ws.config.port,
      mcpPath: ws.config.mcpPath,
      ...(platform
        ? {
            platform: {
              auth: platform.auth,
              db: platform.db,
              secret: platform.secret,
              status: () => wsRef!.statusSummary(),
              invalidateUser: (userId: string) => wsRef!.invalidateUser(userId),
              skills: ws.skills,
            },
          }
        : {}),
    });
  }

  const summary = ws.statusSummary() as {
    modules: { name: string; enabled: boolean; reason?: string; toolCount: number }[];
    upstreams: { key: string; state: string; toolCount: number; error?: string }[];
    totalTools: number;
  };

  console.error("[mcp-workstation] modules:");
  for (const m of summary.modules) {
    const mark = m.enabled ? "✔" : "✖";
    const why = m.enabled ? `${m.toolCount} tools` : m.reason ?? "disabled";
    console.error(`[mcp-workstation]   ${mark} ${m.name}: ${why}`);
  }
  console.error("[mcp-workstation] upstream servers:");
  for (const u of summary.upstreams) {
    const mark = u.state === "connected" ? "✔" : "✖";
    const why = u.state === "connected" ? `${u.toolCount} tools` : u.error ?? "error";
    console.error(`[mcp-workstation]   ${mark} ${u.key}: ${why}`);
  }
  console.error(`[mcp-workstation] ${summary.totalTools} tools available`);

  if (platform) {
    console.error("[mcp-workstation] platform mode: ON (multi-user auth)");
    console.error(`[mcp-workstation] dashboard: ${platform.baseURL}/`);
    const socials: string[] = [];
    if (process.env.GOOGLE_CLIENT_ID) socials.push("google");
    if (process.env.GITHUB_CLIENT_ID) socials.push("github");
    console.error(
      socials.length
        ? `[mcp-workstation] sign-in providers: ${socials.join(", ")}`
        : "[mcp-workstation] WARNING: no OAuth providers configured — add GOOGLE_CLIENT_ID/SECRET and/or GITHUB_CLIENT_ID/SECRET",
    );
    if (process.env.ALLOW_EMAIL_AUTH !== "false") {
      console.error("[mcp-workstation] email/password sign-in enabled (ALLOW_EMAIL_AUTH=false to disable)");
    }
  } else {
    console.error(
      "[mcp-workstation] platform mode: off (set BETTER_AUTH_SECRET to enable auth + dashboard)",
    );
  }
}

function setupPlatform(): PlatformRuntime {
  const dbPath = process.env.PLATFORM_DB
    ? path.resolve(process.cwd(), process.env.PLATFORM_DB)
    : path.resolve(process.cwd(), "data", "platform.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new PlatformDb(dbPath);
  const secret = process.env.BETTER_AUTH_SECRET!;
  const port = Number(process.env.PORT) || 3125;
  const authConfig = loadAuthConfig(port);
  const auth = createAuth(db.db, authConfig);
  return { db, auth, secret, baseURL: authConfig.baseURL };
}

main().catch((err) => {
  console.error(`[mcp-workstation] fatal: ${err instanceof Error ? err.stack ?? err.message : err}`);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  console.error("\n[mcp-workstation] shutting down...");
  if (wsRef) {
    try {
      await wsRef.shutdown();
    } catch {
      // ignore
    }
  }
  if (platform) {
    try {
      platform.db.close();
    } catch {
      // ignore
    }
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
