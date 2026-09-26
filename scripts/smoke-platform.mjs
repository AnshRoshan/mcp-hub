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
 *  - per-user builtin credentials (own GitHub token enables github for THEM only)
 *  - the lite (search-first) catalog: Tier-0 list + hub_search/get/call round trip
 *  - a second user cannot see the first user's servers
 */
import { randomBytes, createHash } from "node:crypto";
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
      // Low spill threshold so the oversized-result guard can be tested with
      // a cheap echo call instead of a 200KB payload.
      MAX_RESULT_BYTES: "4000",
      // Keep credential-gated modules fully off for the default user view,
      // even on a developer machine that has a real .env — the per-user
      // secrets section re-enables them on purpose.
      GITHUB_TOKEN: "",
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

    const authCfg = await (await fetch(`${BASE}/api/config`)).json();
    check("public auth config served (pre-session)",
      !!authCfg?.providers && typeof authCfg.emailAuth === "boolean");

    const noTokenGet = await fetch(`${BASE}/mcp`);
    check("GET /mcp without token → 401", noTokenGet.status === 401);
    const noTokenPost = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    check("POST /mcp without token → 401", noTokenPost.status === 401);

    // ---- RFC 9728 discovery ----
    const prm = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
    const prmBody = await prm.json().catch(() => null);
    check(
      "protected-resource metadata served",
      prm.status === 200 && prmBody?.resource === `${BASE}/mcp` && prmBody?.bearer_methods_supported?.includes("header"),
    );
    const wwwAuth = noTokenPost.headers.get("www-authenticate") ?? "";
    check("401 challenge advertises resource_metadata", /resource_metadata=/.test(wwwAuth) && /^Bearer/.test(wwwAuth), wwwAuth.slice(0, 90));

    // ---- Alice ----
    await signUp("alice@test.com", "Alice");
    const cookie = await signIn("alice@test.com");
    check("sign-in sets session cookie", cookie.length > 20);

    const me = await api("/api/me", { cookie });
    check("/api/me returns user", me?.user?.email === "alice@test.com");

    const token = await mintToken(cookie, "claude");
    check("API token minted (mcw_ prefix)", token.startsWith("mcw_") && token.length > 30);

    // New users now DEFAULT to the lite (search-first) catalog; pin Alice to
    // the full static catalog so the classic tool-list checks below apply, and
    // exercise lite mode explicitly in its own section further down.
    await api("/api/prefs", { cookie, method: "PUT", body: { liteCatalog: false } });

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

    // ---- MCP Apps / tool metadata pass-through (verbatim from upstream) ----
    const echoTool = (list2?.tools ?? []).find((t) => t.name === "mybox_echo");
    check(
      "upstream _meta (MCP Apps ui://) survives proxying",
      echoTool?._meta?.["io.modelcontextprotocol/ui"]?.resourceUri === "ui://demo/echo" && echoTool?._meta?.vendor === "tu",
    );
    check("upstream title survives proxying", echoTool?.title === "Echo Tool");

    // ---- resources proxy (MCP Apps prerequisite) ----
    const resList = await mcp("resources/list", token);
    const uris = (resList?.resources ?? []).map((r) => r.uri);
    check("upstream resources are proxied with verbatim URIs", uris.includes("ui://demo/echo") && uris.includes("note://tu/readme"), uris.join(","));
    const resRead = await mcp("resources/read", token, { uri: "ui://demo/echo" });
    const readText = JSON.stringify(resRead?.contents ?? []);
    check("resources/read returns proxied content", readText.includes("echo widget") && readText.includes("text/html"));

    const secret = await mcpCall(token, "mybox_secret", {});
    const gotSecret = JSON.stringify(secret?.content ?? "").includes("topsecret-42");
    check("encrypted env delivered to upstream", gotSecret);

    // ---- oversized result spill ----
    const big = await mcpCall(token, "mybox_echo", { text: "x".repeat(6000) });
    const bigText = (big?.content ?? []).map((c) => c.text ?? "").join("");
    check("oversized result spilled to a file with preview", bigText.includes("Result too large") && bigText.includes("fs_read") && !bigText.includes("x".repeat(6000)));
    check("spill exposes a machine-readable pointer", big?.structuredContent?.spilled === true && typeof big?.structuredContent?.path === "string");
    const small = await mcpCall(token, "mybox_echo", { text: "fits fine" });
    check("small results pass through untouched", JSON.stringify(small?.content ?? "").includes("fits fine"));
    const statusBig = await mcpCall(token, "workstation_status", {});
    check("control-plane tools never spill", !JSON.stringify(statusBig?.content ?? "").includes("Result too large"));

    // ---- server category round-trip ----
    check("server category stored", created?.server?.category === "Development");

    // ---- per-user builtin credentials ----
    console.log("== per-user builtin credentials ==");
    const statusOf = async (tok) => {
      const r = await mcpCall(tok, "workstation_status", {});
      return JSON.parse((r?.content ?? []).map((c) => c.text ?? "").join(""));
    };
    const ghModule = (st) => st.modules.find((m) => m.name === "github");

    check("github module off with no token", ghModule(await statusOf(token))?.enabled === false);

    const badKey = await api("/api/secrets", { cookie, method: "PUT", body: { values: { SSH_PRIVATE_KEY: "x" } } });
    check("non-allowlisted secret rejected", typeof badKey?.error === "string");

    await api("/api/secrets", { cookie, method: "PUT", body: { values: { GITHUB_TOKEN: "ghp_alice_private" } } });
    const secList = await api("/api/secrets", { cookie });
    check("secret name visible", (secList?.keys ?? []).includes("GITHUB_TOKEN"));
    check("secret value never returned", !JSON.stringify(secList).includes("ghp_alice_private"));

    const ghAlice = ghModule(await statusOf(token));
    check(
      "alice's own token enables github for HER catalog",
      ghAlice?.enabled === true && ghAlice?.toolCount >= 10,
      `${ghAlice?.toolCount} tools`,
    );

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
    await api("/api/skills", { cookie, method: "PUT", body: { enabledSkills: skills.map((s) => s.name) } });

    // ---- lite catalog (search-first) ----
    console.log("== lite catalog ==");
    await api("/api/prefs", { cookie, method: "PUT", body: { liteCatalog: true } });
    await sleep(300);
    const listLite = await mcp("tools/list", token);
    const liteNames = (listLite?.tools ?? []).map((t) => t.name).sort();
    const TIER0 = ["hub_call", "hub_get_tool", "hub_search_tools", "workstation_reload", "workstation_status"];
    check("lite mode lists ONLY the Tier-0 hub tools", liteNames.join(",") === TIER0.join(","), liteNames.join(","));

    const stLite = await statusOf(token);
    check("status reports catalogMode lite + full totalTools", stLite.catalogMode === "lite" && stLite.totalTools > 50, `${stLite.totalTools} total`);

    const found = await mcpCall(token, "hub_search_tools", { query: "create a github issue", limit: 5 });
    const foundText = (found?.content ?? []).map((c) => c.text ?? "").join("");
    check("hub_search finds gh_create_issue behind the wall", foundText.includes("gh_create_issue"));

    const schema = await mcpCall(token, "hub_get_tool", { tool: "gh_create_issue" });
    const schemaText = (schema?.content ?? []).map((c) => c.text ?? "").join("");
    check("hub_get_tool returns its input schema", schemaText.includes("owner") && schemaText.includes("repo"));

    const called = await mcpCall(token, "hub_call", { tool: "get_current_time", arguments: {} });
    check("hub_call runs a hidden tool through the pipeline", JSON.stringify(called?.content ?? "").includes("UTC"));

    const hubBad = await mcpCall(token, "hub_call", { tool: "no_such_tool", arguments: {} });
    check("hub_call rejects unknown tools with guidance", hubBad?.isError === true || JSON.stringify(hubBad ?? "").includes("hub_search_tools"));

    // Usage rollup must reflect the MCP calls made through this user's token.
    const usage = await api("/api/usage?days=14", { cookie });
    check("GET /api/usage returns a 14-day series", usage?.series?.length === 14);
    check("tool calls are counted per user", usage?.totalCalls >= 4, `totalCalls=${usage?.totalCalls}`);
    check("usage reports a busiest tool", typeof usage?.topTools?.[0]?.tool === "string");
    check("usage latency is a real number", Number.isFinite(usage?.avgLatencyMs) && usage.avgLatencyMs >= 0);
    const usageBadDays = await api("/api/usage?days=999", { cookie });
    check("usage clamps the days window", usageBadDays?.series?.length === 90);

    await api("/api/prefs", { cookie, method: "PUT", body: { liteCatalog: false } });
    await sleep(300);
    const listBack = await mcp("tools/list", token);
    check("toggling back to full restores the static list", (listBack?.tools ?? []).length > 50);

    // ---- official registry proxy (network-tolerant) ----
    const reg = await api("/api/registry?search=github&limit=5", { cookie });
    if (reg?.error) {
      check("registry proxy (upstream unreachable — skipped)", true, reg.error);
    } else {
      check(
        "registry proxy returns flattened remote servers",
        Array.isArray(reg.servers) && reg.servers.every((s) => typeof s.url === "string" && s.url.startsWith("https://")),
        `${reg.servers?.length ?? 0} servers`,
      );
      check("registry proxy rejects unauthenticated callers", (await fetch(`${BASE}/api/registry?search=x`)).status === 401);
    }

    // ---- OAuth 2.1 flow: discovery → DCR → consent → PKCE token → /mcp ----
    console.log("== OAuth 2.1 flow ==");
    const REDIR = "http://127.0.0.1:19999/cb";
    const asmeta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
    check(
      "AS metadata advertises endpoints and S256",
      asmeta.authorization_endpoint === `${BASE}/oauth/authorize` &&
      asmeta.token_endpoint === `${BASE}/oauth/token` &&
      asmeta.registration_endpoint === `${BASE}/register` &&
      asmeta.code_challenge_methods_supported?.includes("S256"),
    );
    const prm2 = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
    check("PRM advertises authorization_servers", (prm2.authorization_servers ?? [])[0] === BASE);

    const dcr = await (await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Smoke Client", redirect_uris: [REDIR] }),
    })).json();
    check("RFC 7591 DCR registers a public client", typeof dcr.client_id === "string" && dcr.client_id.length > 10);
    const badReg = await fetch(`${BASE}/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://evil.example/x", "http://not-loopback.example/cb"] }),
    });
    check("DCR rejects non-loopback http and validates redirect set", badReg.status === 400);

    const newFlow = () => {
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const url = `${BASE}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(dcr.client_id)}&redirect_uri=${encodeURIComponent(REDIR)}&code_challenge=${challenge}&code_challenge_method=S256&state=st${randomBytes(3).toString("hex")}`;
      return { verifier, url };
    };
    const approve = async (flow) => {
      const page = await fetch(flow.url, { headers: { Cookie: cookie } });
      const html = await page.text();
      const nonce = /name="nonce" value="([^"]+)"/.exec(html)?.[1];
      const res = await fetch(`${BASE}/oauth/authorize`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ nonce, decision: "approve" }),
        redirect: "manual",
      });
      return { res, location: res.headers.get("location") };
    };

    const anon = await fetch(newFlow().url, { redirect: "manual" });
    check("authorize without session parks the flow and redirects to sign-in",
      anon.status === 302 && (anon.headers.get("location") ?? "").includes("/?authorize_return=%2Foauth%2Fauthorize"));

    const flow1 = newFlow();
    const consentPageRes = await fetch(flow1.url, { headers: { Cookie: cookie } });
    const consentHtml = await consentPageRes.text();
    check("authorize with session renders consent naming the client",
      consentPageRes.status === 200 && consentHtml.includes("Smoke Client") && consentHtml.includes("Approve"));

    const ok = await approve(flow1);
    const code1 = new URL(ok.location ?? "").searchParams.get("code");
    check("approval 302s to redirect_uri with single code + state",
      ok.res.status === 302 && (ok.location ?? "").startsWith(`${REDIR}?code=ac_`) && (ok.location ?? "").includes("state="));

    const exchange = (flow, code, verifierOverride) => fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, client_id: dcr.client_id,
        redirect_uri: REDIR, code_verifier: verifierOverride ?? flow.verifier,
      }),
    });
    const tokRes = await exchange(flow1, code1);
    const tok = await tokRes.json();
    check("PKCE token exchange issues a Bearer access token",
      tokRes.status === 200 && typeof tok.access_token === "string" && tok.token_type === "Bearer");

    const oauthTools = await mcp("tools/list", tok.access_token);
    check("OAuth-issued token authenticates /mcp", (oauthTools?.tools ?? []).length >= 5);

    const flow2 = newFlow();
    const code2 = new URL((await approve(flow2)).location ?? "").searchParams.get("code");
    const badV = await exchange(flow2, code2, "wrong-verifier-wrong-verifier-wrong-verifier-1234567");
    check("wrong PKCE verifier → invalid_grant", badV.status === 400 && (await badV.json()).error === "invalid_grant");
    const reuse = await exchange(flow2, code2);
    check("code is single-use even after a failed exchange", reuse.status === 400);

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
    const listB0 = await mcp("tools/list", bobToken);
    const bobLiteNames = (listB0?.tools ?? []).map((t) => t.name);
    check("new users default to the lite catalog", bobLiteNames.includes("hub_search_tools") && bobLiteNames.length === 5);
    await api("/api/prefs", { cookie: bobCookie, method: "PUT", body: { liteCatalog: false } });
    const listB = await mcp("tools/list", bobToken);
    const bobNames = (listB?.tools ?? []).map((t) => t.name);
    check("Bob cannot see Alice's servers", !bobNames.some((n) => n.startsWith("mybox_")));
    check("Bob still gets shared builtins", bobNames.some((n) => n.startsWith("memory_")));
    const slBob = await mcpCall(bobToken, "skills_list", {});
    check("Bob gets skills on by default", JSON.stringify(slBob?.content ?? "").includes("debugging"));
    check("Bob sees new modules too", bobNames.some((n) => n.startsWith("crypto_")));
    const ghBob = ghModule(await statusOf(bobToken));
    check("Bob's github stays off (secrets are per-user)", ghBob?.enabled === false);
    check("Alice's token never leaks into Bob's status", !JSON.stringify(await statusOf(bobToken)).includes("ghp_alice_private"));

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
