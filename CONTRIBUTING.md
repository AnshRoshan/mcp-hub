# Contributing to MCP Workstation

Thanks for wanting to help! This project is designed to be easy to pick up:
everything is plain TypeScript, uses the official MCP SDK v2, and there are no
framework dependencies in the core.

## Setup

```bash
npm install
npm run check            # typechecks + dead-code gate + unit tests (run before pushing)
npm run typecheck    # fast type check
npm run test:unit    # fast unit tests (no build needed)
npm test             # builds + runs the end-to-end smoke test
npm start            # run the server (http://localhost:3125/mcp)
```

Requires **Node.js ≥ 22.5** (for the built-in `node:sqlite`).

## How it works in 60 seconds

- `src/index.ts` — entry point. Turns on platform mode when `BETTER_AUTH_SECRET`
  is set (auth + dashboard + per-user servers), then starts the stateless HTTP
  server (or `--stdio`).
- `src/server.ts` — assembles the workstation. A fresh `McpServer` is built from
  the shared tool registry **on every request** (stateless), so edits show up on
  the next request. In platform mode the factory reads `ctx.authInfo` and builds
  the catalog for that user (their enabled servers + their module prefs).
- `src/platform/*` — multi-user layer: Better Auth (Google/GitHub), the SQLite
  DB (auth tables + servers/tokens/prefs), API-token verifier for `/mcp`, and
  the dashboard REST API.
- `src/registry.ts` — the tool registry + the `registerModule` helper.
- `src/builtins/*` — self-contained tool modules (time, uuid, fetch, memory,
  filesystem, knowledge, github, jira, search, postgres, sqlite, notion, slack,
  crypto, hn, weather + the `skills` module).
- `src/platform/skills.ts` + `skills/*.md` — the skills hub (see below).
- `src/proxy/*` — connects to external MCP servers (stdio or HTTP), namespaces
  their tools (`serverkey_toolname`), and routes calls to them.
- `src/http.ts` — node:http front-end: `/api/auth/*`, `/api/*`, static dashboard
  UI, and the stateless `/mcp` (Bearer-gated in platform mode) plus a bridge for
  the deprecated legacy SSE transport.
- `public/` — the dashboard UI (vanilla HTML/CSS/JS, no build step).

## Adding a new built-in module

1. Create `src/builtins/yourname.ts` exporting your tools. Each `ToolDef` is
   `{ name, description, inputSchema /* JSON Schema */, handler(args) }`.
   Handlers return a `CallToolResult` (use `textResult`/`jsonResult`/`errResult`
   from `src/result.ts`).

   - **No credentials needed?** `export const yournameDefs: ToolDef[]`.
   - **Uses API keys?** Export a factory that reads them from the caller's
     `EnvSource` (in platform mode that layer contains the *requesting user's*
     stored secrets, falling back to process env):
     ```ts
     export function yournameModule(env: EnvSource):
         { defs: ToolDef[]; enabled: boolean; reason?: string } {
       const token = env.get("YOURNAME_TOKEN");
       return { defs: [...], ...(token ? { enabled: true } : { enabled: false, reason: "YOURNAME_TOKEN not set" }) };
     }
     ```
     Add your env var to `USER_OVERRIDABLE_ENV` in
     `src/platform/serverConfig.ts` so users can supply it via `/api/secrets`.
2. Register it in `src/server.ts` (categories are shown in the dashboard:
   `Utilities`, `Development`, `Finance & Crypto`, …):
   ```ts
   defineModule("yourname", "Your Category", yournameDefs, true);          // static
   defineEnvModule("yourname", "Your Category", yournameModule);           // per-user creds
   ```
3. Add its `{ icon, desc }` entry to the `MODULES` map in `web/src/lib/catalog.ts`
   so the dashboard renders it.
4. Run `npm run check`, then `npm test` and `npm run test:platform`.
5. Document the module (and any new env vars) in `README.md` / `.env.example`.

## Adding a skill to the Skills Hub

1. Create `skills/your-skill.md` with frontmatter + a markdown body:
   ```markdown
   ---
   name: your-skill
   description: One-line summary shown in the hub.
   category: Development
   version: 1.0.0
   ---
   # Your Skill
   ...instructions an agent should follow...
   ```
2. Rebuild — the skill appears in the dashboard's **Skills** page and in
   `skills_list`/`skills_get` for every user (it's on by default).

**Module rules**

- Zero external side effects at import time (no network, no heavy init). Load
  things lazily inside handlers — see `knowledge.ts` for the lazy embedding
  pattern.
- Secrets only via env vars; modules must degrade gracefully when keys are
  missing (report via `workstation_status`).
- Every mutating tool should be safe by default (e.g. databases are read-only
  unless explicitly enabled).

## Environment variables

All configuration is via env vars (see `.env.example`). Key ones:

| Var | Purpose |
|---|---|
| `BETTER_AUTH_SECRET` | turns platform mode ON (auth + dashboard + tokens) |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` | OAuth sign-in |
| `ALLOW_EMAIL_AUTH`, `PLATFORM_DB`, `BETTER_AUTH_URL` | platform behavior |
| `PORT`, `MCP_PATH` | HTTP endpoint |
| `FILESYSTEM_ROOTS` | sandbox roots for `fs_*` tools |
| `MEMORY_FILE`, `SQLITE_PATH`, `KNOWLEDGE_DB` | storage locations |
| `GITHUB_TOKEN`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN` | key-gated modules |
| `BRAVE_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY` | web search provider |
| `DATABASE_URL`, `PG_ALLOW_WRITE`, `SQLITE_ALLOW_WRITE` | databases |
| `MCP_WORKSTATION_SERVERS` | path to the shared upstream servers config |
| `USER_SESSION_TTL_MS`, `MAX_USER_SESSIONS` | per-user upstream connection pool (idle TTL / LRU cap) |
| `MAX_RESULT_BYTES` | tool-result spill threshold (0 disables) |
| `CORS_ALLOWED_ORIGINS` | extra origins allowed for credentialed `/api/*` calls |

## Testing

- `npm run test:unit` — `tests/*.test.ts`: fast unit tests (`node --test` +
  tsx, no build needed) for the pure modules: env/arg coercion, config parsing,
  rate limiting, audit masking.
- `npm test` — build + unit tests + `scripts/smoke.mjs`: spawns the built
  server (single-user), connects with the official v2 client, verifies tool
  discovery, calls, memory, knowledge search.
- `npm run test:platform` — `scripts/smoke-platform.mjs`: boots the server in
  platform mode and verifies sign-up/sign-in, token minting, gated `/mcp`
  (401 without a token), registering a stdio server with encrypted env, toggles,
  and **multi-user isolation** (a second user cannot see the first's servers).
- `npm run test:integrations` — `scripts/smoke-ghjira.mjs`: GitHub + Jira
  against a local mock API (no real credentials needed). Run it while no other
  smoke test is holding its port.

Add unit tests for pure logic in `tests/`, and your module's core happy-path to
the relevant smoke script.

## CI & security scanning

CI (`.github/workflows/ci.yml`) runs on every push/PR against Node 22 and 24:
`npm run check` (typechecks, dead-code gate, unit tests, registry-schema
validation), both builds, and all three smoke suites.

For security review of upstream servers (or this repo) we recommend
[Cisco AI MCP Scanner](https://github.com/cisco-ai-defense/mcp-scanner):

```bash
uv tool install --python 3.13 cisco-ai-mcp-scanner
# scan a deployed remote MCP endpoint:
mcp-scanner --server-url https://your-host/mcp --analyzers yara --format summary
```

## Style

- Plain TypeScript, strict mode, ESM (`"type": "module"`, `.js` import suffixes).
- No framework in the core; node:http + the official MCP SDK packages only.
- Comments explain *why*, not *what*.
- Prefer small pure helpers (`src/utils.ts`) over inline repetition.
