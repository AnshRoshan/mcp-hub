/**
 * Platform mode end-to-end smoke test.
 *
 * Spawns the built server with BETTER_AUTH_SECRET (platform ON), then verifies:
 *  - dashboard + auth routes serve
 *  - /mcp rejects requests without a Bearer token (401)
 *  - email signup / sign-in / session cookie work
 *  - API tokens mint and authenticate /mcp
 *  - tools/list + tools/call work over the stateless endpoint
 *  - a registered stdio server appears (namespaced tools) with ENCRYPTED env
 *    delivered to the upstream process
 *  - toggling a server off removes its tools
 *  - disabling a builtin module removes its tools for that user
 *  - a second user cannot see the first user's servers
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4165;
const BASE = `http://localhost:${PORT}`;
const DB = path.join(ROOT, "data", "smoke-platform.db");
const DB_WAL = `${DB}-wal`;
const DB_SHM = `${DB}-shm`;

const SECRET = "smoke-test-secret-smoke-test-secret-1234";
const TEST_SERVER = path.join(ROOT, "scripts", "test-upstream.mjs");

let failures = 0;
function check(label, cond, detail = "") {
  const mark = cond ? "✔" : "✖";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  for (const f of [DB, DB_WAL, DB_SHM]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {}
  }
  if (!fs.existsSync(TEST_SERVER)) {
    console.error(`Missing ${TEST_SERVER} — run npm run build first.`);
    process.exit(1);
  }

  const child = spawn(process.execPath, [path.join(ROOT, "dist", "index.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      // Override anything the developer's own .env may set so the test is
      // hermetic (the spawned server loads .env via dotenv/config).
      BETTER_AUTH_URL: BASE,
      PUBLIC_BASE_URL: BASE,
      BETTER_AUTH_SECRET: SECRET,
      ALLOW_EMAIL_AUTH: "true",
      PLATFORM_DB: DB,
      NODE_NO_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  try {
    await waitForServer();

    console.log("== auth + dashboard ==");
    const dash = await fetch(`${BASE}/`);
    check("dashboard serves", dash.status === 200);

    const noTokenGet = await fetch(`${BASE}/mcp`);
    check("GET /mcp without token → 401", noTokenGet.status === 401);
    const noTokenPost = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    check("POST /mcp without token → 401", noTokenPost.status === 401);

    // ---- Alice ----
    await signUp("alice@test.com", "Alice");
    const cookie = await signIn("alice@test.com");
    check("sign-in sets session cookie", cookie.length > 20);

    const me = await api("/api/me", { cookie });
    check("/api/me returns user", me?.user?.email === "alice@test.com");

    const token = await mintToken(cookie, "claude");
    check("API token minted (mcw_ prefix)", token.startsWith("mcw_") && token.length > 30);

    console.log("== stateless MCP with token ==");
    const list = await mcp("tools/list", token);
    const names0 = (list?.tools ?? []).map((t) => t.name);
    check("tools/list works", names0.length >= 20, `${names0.length} tools`);

    const time = await mcpCall(token, "get_current_time", {});
    check("tools/call works", JSON.stringify(time?.content ?? "").includes("UTC"));

    console.log("== register stdio server with encrypted env ==");
    const created = await api("/api/servers", {
      cookie,
      method: "POST",
      body: {
        key: "mybox",
        type: "stdio",
        category: "Development",
        command: process.execPath,
        args: [TEST_SERVER],
        env: { MY_SECRET: "topsecret-42" },
      },
    });
    check("server registered", Boolean(created?.server?.id));

    // The server row must never contain the raw secret.
    const rows = await api("/api/servers", { cookie });
    const rawLeak = JSON.stringify(rows).includes("topsecret-42");
    check("secret NOT leaked in server list", !rawLeak);

    const list2 = await mcp("tools/list", token);
    const names1 = (list2?.tools ?? []).map((t) => t.name);
    const mybox = names1.filter((n) => n.startsWith("mybox_"));
    check("mybox tools appear", mybox.includes("mybox_echo") && mybox.includes("mybox_secret"), mybox.join(","));

    const secret = await mcpCall(token, "mybox_secret", {});
    const gotSecret = JSON.stringify(secret?.content ?? "").includes("topsecret-42");
    check("encrypted env delivered to upstream", gotSecret);

    // ---- server category round-trip ----
    check("server category stored", created?.server?.category === "Development");

    // ---- toggle server off ----
    const sid = rows.servers[0].id;
    await api(`/api/servers/${sid}`, { cookie, method: "PATCH", body: { enabled: false } });
    await sleep(400);
    const list3 = await mcp("tools/list", token);
    const hasMybox = (list3?.tools ?? []).some((t) => t.name.startsWith("mybox_"));
    check("disabled server's tools disappear", !hasMybox);

    // ---- disable a builtin module ----
    await api("/api/prefs", { cookie, method: "PUT", body: { disabledModules: ["memory"] } });
    await sleep(300);
    const list4 = await mcp("tools/list", token);
    const names4 = (list4?.tools ?? []).map((t) => t.name);
    const hasMemory = names4.some((n) => n.startsWith("memory_"));
    check("disabled module's tools disappear", !hasMemory);

    // ---- new builtin modules present (crypto / hn / weather / skills) ----
    const hasNew = [
      "crypto_price",
      "crypto_market",
      "crypto_trending",
      "crypto_search",
      "crypto_convert",
      "hn_top",
      "hn_new",
      "hn_ask",
      "hn_show",
      "hn_item",
      "hn_search",
      "weather_current",
      "weather_forecast",
      "weather_geocode",
      "skills_list",
      "skills_get",
    ].every((n) => names4.includes(n));
    check("new modules present (crypto / hn / weather / skills)", hasNew, `${names4.length} tools`);

    // ---- per-tool toggle ----
    await api("/api/prefs", { cookie, method: "PUT", body: { disabledTools: ["uuid_generate"] } });
    await sleep(300);
    const list5 = await mcp("tools/list", token);
    const names5 = (list5?.tools ?? []).map((t) => t.name);
    check(
      "single tool disabled → removed (others stay)",
      !names5.includes("uuid_generate") && names5.includes("get_current_time"),
    );
    await api("/api/prefs", { cookie, method: "PUT", body: { disabledTools: [] } });
    await sleep(300);

    // ---- skills hub ----
    const me2 = await api("/api/me", { cookie });
    const skills = me2.skills ?? [];
    check(
      "skills hub ships ≥ 8 skills, all on by default",
      skills.length >= 8 && skills.every((s) => s.enabled),
      `${skills.length} skills`,
    );
    const sl = await mcpCall(token, "skills_list", {});
    const slText = (sl?.content ?? []).map((c) => c.text ?? "").join("");
    check("skills_list over MCP returns skills", slText.includes("debugging") && slText.includes("code-review"));

    await api("/api/skills", {
      cookie,
      method: "PUT",
      body: { enabledSkills: skills.filter((s) => s.name !== "debugging").map((s) => s.name) },
    });
    await sleep(300);
    const sl2 = await mcpCall(token, "skills_list", {});
    const sl2Text = (sl2?.content ?? []).map((c) => c.text ?? "").join("");
    check("disabled skill excluded from skills_list", !sl2Text.includes("\"debugging\"") && sl2Text.includes("code-review"));
    const sg = await mcpCall(token, "skills_get", { name: "code-review" });
    check("skills_get returns full content", JSON.stringify(sg?.content ?? "").includes("severity"));
    const sgBad = await mcpCall(token, "skills_get", { name: "debugging" });
    check("skills_get rejects disabled skill", sgBad?.isError === true || JSON.stringify(sgBad ?? "").includes("not enabled"));

    // ---- bad token ----
    const bad = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer nope" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }),
    });
    check("bad token → 401", bad.status === 401);

    // ---- Bob: isolation ----
    await signUp("bob@test.com", "Bob");
    const bobCookie = await signIn("bob@test.com");
    const bobToken = await mintToken(bobCookie, "bob-claude");
    const listB = await mcp("tools/list", bobToken);
    const bobNames = (listB?.tools ?? []).map((t) => t.name);
    check("Bob cannot see Alice's servers", !bobNames.some((n) => n.startsWith("mybox_")));
    check("Bob still gets shared builtins", bobNames.some((n) => n.startsWith("memory_")));
    const slBob = await mcpCall(bobToken, "skills_list", {});
    check("Bob gets skills on by default", JSON.stringify(slBob?.content ?? "").includes("debugging"));
    check("Bob sees new modules too", bobNames.some((n) => n.startsWith("crypto_")));

    console.log(failures === 0 ? "\nPLATFORM SMOKE PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    child.kill("SIGTERM");
    await sleep(500);
    try {
      child.kill("SIGKILL");
    } catch {}
  }
}

/* ---------------- helpers ---------------- */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.status < 500) return;
    } catch {}
    await sleep(300);
  }
  throw new Error("server did not start in time");
}

async function signUp(email, name) {
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password: "password123", name }),
  });
  return res;
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0].trim();
}

async function api(pathname, { cookie, method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
}

async function mintToken(cookie, name) {
  const res = await api("/api/tokens", { cookie, method: "POST", body: { name } });
  return res?.token?.token;
}

/** POST a JSON-RPC request to /mcp; returns the parsed result (or error). */
async function mcp(method, token, params) {
  const body = {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1e6),
    method,
    ...(params !== undefined ? { params } : {}),
  };
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "Mcp-Method": method,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  const jsonText = line ? line.slice(6) : text;
  try {
    return JSON.parse(jsonText)?.result ?? JSON.parse(jsonText)?.error;
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

async function mcpCall(token, name, args) {
  return mcp("tools/call", token, { name, arguments: args });
}

main().catch((err) => {
  console.error(`SMOKE ERROR: ${err instanceof Error ? err.stack ?? err.message : err}`);
  process.exit(1);
});
