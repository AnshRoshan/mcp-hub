# Contributing to MCP Workstation

Thanks for wanting to help! This project is designed to be easy to pick up:
the backend is plain TypeScript on the official MCP SDK v2 with no framework in
the core (node:http only). The dashboard in `web/` is a different story — it is
React + Vite + Tailwind + Astryx, and it is covered by its own typecheck and build.

## Setup

```bash
npm install              # also runs `prepare` → `npm run build` (compiles src → dist)
npm run check            # backend + web typecheck, dead-code gate, unit tests, registry validation
npm run typecheck        # fast type check (backend)
npm run typecheck:web    # fast type check (dashboard)
npm run test:unit        # fast unit tests (no build needed)
npm test                 # builds + runs the end-to-end smoke test
npm run build:web        # rebuild the dashboard into public/ (required after web/ edits)
npm start                # run the server (http://localhost:3125/mcp, dashboard at /)
```

Requires **Node.js ≥ 22.5** (for the built-in `node:sqlite`).

## How it works in 60 seconds

- `src/index.ts` — entry point. Turns on platform mode when `BETTER_AUTH_SECRET`
  is set (auth + dashboard + per-user servers), then starts the stateless HTTP
  server (or `--stdio`).
- `src/server.ts` — assembles the workstation. A fresh `McpServer` is built
  **on every request** (stateless) from an immutable catalog snapshot
  (`assembleCatalog`), so edits show up on the next request. In platform mode the
  factory reads `ctx.authInfo` and builds the catalog for that user (their enabled
  servers + their module prefs).
- `src/platform/*` — multi-user layer: Better Auth (Google/GitHub), the SQLite
  DB (auth tables + servers/tokens/prefs/oauth clients/usage events), the OAuth 2.1
  authorization server, the API-token verifier for `/mcp`, and the dashboard REST API.
- `src/registry.ts` — the tool registry + the `registerModule` helper.
- `src/builtins/*` — self-contained tool modules (time, uuid, fetch, memory,
  filesystem, knowledge, github, jira, search, postgres, sqlite, notion, slack,
  crypto, hn, weather, devkit, youtube). The `skills` and `workstation` modules are
  defined in `src/server.ts`, not in `builtins/`.
- `src/platform/skills.ts` + `skills/*.md` — the skills hub (see below).
- `src/proxy/*` — connects to external MCP servers (stdio or HTTP), namespaces
  their tools (`serverkey_toolname`), proxies their resources verbatim, and routes
  calls to them.
- `src/http.ts` — node:http front-end: `/api/auth/*`, `/api/*`, the OAuth 2.1
  authorization server (`/oauth/*`, `/register`, `/.well-known/*`), the static
  dashboard, and the stateless `/mcp` (Bearer-gated in platform mode) plus a bridge
  for the deprecated legacy SSE transport.
- `web/` — the dashboard **source**: React 19 + Vite + Tailwind CSS v4 + Meta's
  Astryx design system (`@astryxdesign/core` + `theme-neutral`).
- `public/` — **generated**: the Vite build output of `web/` (`npm run build:web`),
  committed so a clone can run without a dashboard build. See
  [Working on the dashboard](#working-on-the-dashboard--never-edit-public) below.

## Working on the dashboard — never edit `public/`

The dashboard is **not** hand-written HTML: `public/index.html` and `public/assets/*`
are hashed Vite bundles. Editing them is lost on the next `npm run build:web`
(`emptyOutDir: true` wipes the folder), and nothing you write there goes through
typechecking or review.

- Edit dashboard code in `web/src/` — `App.tsx`, `views/`, `components/`, `lib/`.
- `npm run dev:web` serves Vite on `:5173` and proxies `/api` + `/mcp` to the backend
  port from `.env`, so you develop against the live server. The proxy target is
  `PORT` from the root `.env` and falls back to **3000**, while the server's own
  default is **3125** — so run with a `.env` (the template already sets `PORT=3125`)
  or the dev proxy will point at nothing.
- `npm run typecheck:web` (part of `npm run check`) is the only dashboard gate; there
  are **no UI/visual tests**, so a broken render is caught by hand, not by CI.
- Before pushing, run `npm run build:web` and commit the regenerated `public/` — see
  [Why `public/` is committed](#why-public-is-committed-and-how-it-drifts).

## Adding a new built-in module

1. Create `src/builtins/yourname.ts` exporting your tools. Each `ToolDef` is
   `{ name, description, inputSchema /* JSON Schema */, handler(args) }`.
   Handlers return a `CallToolResult` — build one with `textResult`/`jsonResult`
   from `src/result.ts` (there is no `errResult`: a handler signals failure by
   `throw`ing, which the SDK reports as an `isError` tool result).

   A handler that fetches a caller-supplied URL must go through
   `guardedFetch` (`src/netguard.ts`) rather than `fetch` directly — that is what
   keeps loopback/private/metadata addresses unreachable through the hub.

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
     Add an entry to `USER_SECRETS` in `src/platform/serverConfig.ts`
     (`USER_OVERRIDABLE_ENV` is derived from it) so users can supply the var via
     `/api/secrets` and the dashboard's Credentials page.
2. Register it in `registerBuiltins()` in `src/server.ts` (categories are shown in
   the dashboard: `Utilities`, `Development`, `Finance & Crypto`, …):
   ```ts
   defineModule("yourname", "Your Category", yournameDefs, true);          // static
   defineEnvModule("yourname", "Your Category", yournameModule);           // per-user creds
   ```
3. Add its `{ icon, desc }` entry to the `MODULES` map in `web/src/lib/catalog.ts`
   so the dashboard renders it, then `npm run build:web` and commit `public/`.
4. Run `npm run check`, then `npm test` and `npm run test:platform`.
5. Document the module (and any new env vars) in the `README.md` built-in tools
   table and `.env.example`.

## Adding a skill to the Skills Hub

1. Create `skills/your-skill.md` with frontmatter + a markdown body (flat file —
   subfolders are not scanned, and only `name` is required; `description`,
   `category` (`General`) and `version` (`1.0.0`) fall back to defaults):
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
2. Restart the server — `skills/` is read once at boot (no dashboard rebuild needed
   unless you also changed `web/`). The skill then appears in the dashboard's
   **Skills** page and in `skills_list`/`skills_get` for every user (it's on by
   default).

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
| `ALLOW_EMAIL_AUTH` | email/password sign-in — **off by default**, set `true` for local dev |
| `BETTER_AUTH_URL` / `PUBLIC_BASE_URL` | public origin; `BETTER_AUTH_URL` is **required** when platform mode runs with `NODE_ENV=production`, and must be `https://` for a non-local host |
| `AUTH_DEBUG` | enables Better Auth's logger — **debugging only**, its output can contain session tokens; never in production |
| `STDIO_ALLOWED_COMMANDS` | bare executables users may register as stdio upstreams (comma separated); **empty by default = user stdio refused**; operator `config/servers.json` entries are unaffected |
| `TRUSTED_ORIGINS` | extra origins Better Auth accepts for auth requests |
| `PLATFORM_DB` | platform SQLite file |
| `PORT`, `MCP_PATH` | HTTP endpoint |
| `FILESYSTEM_ROOTS` | sandbox roots for `fs_*` tools (the first root also receives spilled results) |
| `MEMORY_FILE`, `SQLITE_PATH`, `KNOWLEDGE_DB` | storage locations |
| `GITHUB_TOKEN`, `JIRA_BASE_URL`+`JIRA_API_TOKEN`(+`JIRA_EMAIL`), `NOTION_TOKEN`, `SLACK_BOT_TOKEN` | key-gated modules |
| `BRAVE_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY` | web search provider |
| `DATABASE_URL`, `PG_ALLOW_WRITE`, `SQLITE_ALLOW_WRITE` | databases |
| `FETCH_ALLOWED_DOMAINS` | deployment-wide outbound domain allowlist for `fetch_url`/`web_*` (can only narrow, never permit an internal host) |
| `MCP_WORKSTATION_SERVERS` | path to the shared upstream servers config |
| `UPSTREAM_CALL_TIMEOUT_MS`, `UPSTREAM_MAX_RESPONSE_BYTES` | per-call upstream guardrails |
| `USER_SESSION_TTL_MS`, `MAX_USER_SESSIONS` | per-user upstream connection pool (idle TTL / LRU cap) |
| `MAX_RESULT_BYTES` | tool-result spill threshold (0 disables) |
| `CORS_ALLOWED_ORIGINS` | extra origins allowed for credentialed `/api/*` calls |
| `RATE_LIMIT_ENABLED` / `RATE_LIMIT_DEFAULT` / `RATE_LIMIT_WINDOW_MS` | per-user tool-call rate limiting (on by default in platform mode, off in single-user) |
| `AUDIT_LOG_ENABLED` / `AUDIT_LOG_FORMAT` / `AUDIT_LOG_MASK_ARGS` | audit log (on by default; arg masking is **off** by default) |
| `HEALTHCHECK_ENABLED` / `_INTERVAL_MS` / `_TIMEOUT_MS` / `_MAX_BACKOFF_MS` | upstream health probes + auto-reconnect (on by default) |

## Why `public/` is committed (and how it drifts)

`.gitignore` deliberately does **not** list `public/`. The reason: `src/http.ts`
serves the dashboard straight off disk (`process.cwd()/public`), and neither
`npm start` nor `npm run build` regenerates it — so a fresh clone gets a working
dashboard with no dashboard build step, and a static host can serve `public/`
as-is.

The cost is real, and you have to manage it:

- `public/` is **generated output that lives in git**. If someone edits `web/` and
  forgets `npm run build:web`, the repo ships a bundle that no longer matches its
  source, and CI will not catch it (it builds `public/` from source but never
  compares the result with what is committed).
- The published npm package includes `public/` as committed (see `files` in
  `package.json`), so a forgotten dashboard rebuild ships to users too.
- If you ever decide to gitignore it instead, `npm start` on a fresh clone must stop
  working without a `build:web` first — that is the trade-off being reversed, and it
  needs an owner's call, not a drive-by change.

**Rule:** any PR that touches `web/` must include the regenerated `public/` in the
same commit. Reviewers: if `web/` changed and `public/` did not, ask for the rebuild.

## Testing

- `npm run test:unit` — `tests/*.test.ts`: fast unit tests (`node --test` +
  tsx, no build needed) over the pure layers — env/arg coercion, config parsing,
  the URL (SSRF) and SQL read-only guards, rate limiting, audit masking, token
  hashing, the tool index, `devkit` tools, server-row codec, description linter.
- `npm test` — build + unit tests + `scripts/smoke.mjs`: spawns the built
  server (single-user), connects with the official v2 client, verifies tool
  discovery, `server/discover` + cache hints, calls, memory, knowledge search.
- `npm run test:platform` — `scripts/smoke-platform.mjs`: boots the server in
  platform mode and verifies sign-up/sign-in **via email/password**, token
  minting, gated `/mcp` (401 without a token), registering an allowlisted stdio
  server (`STDIO_ALLOWED_COMMANDS=node`) with encrypted env, the lite catalog and
  hub tools, the oversized-result spill, the OAuth 2.1 AS round trip
  (discovery → DCR → consent → PKCE → bearer), and **multi-user isolation** (a
  second user cannot see the first's servers).
- `npm run test:integrations` — `scripts/smoke-ghjira.mjs`: GitHub + Jira
  against a **local mock** API (no real credentials needed — and no real API
  traffic either). Run it while no other smoke test is holding its port.

There are **no tests for the dashboard UI** (`web/`): its only gates are
`npm run typecheck:web` and a successful Vite build.

Add unit tests for pure logic in `tests/`, and your module's core happy-path to
the relevant smoke script.

## CI & security scanning

CI (`.github/workflows/ci.yml`) runs on every push/PR against Node 22 and 24:

| Step | What it actually proves |
|---|---|
| `npm ci` | dependency install from the lockfile |
| `npm run check` | backend + web typecheck, the `fallow` **dead-code** gate, unit tests, offline registry-schema validation |
| `npm run build && npm run build:web` | `tsc` emits `dist/`, Vite emits `public/` |
| `node scripts/smoke.mjs` | single-user end-to-end over the stateless protocol |
| `node scripts/smoke-platform.mjs` | platform mode end-to-end incl. the OAuth 2.1 AS and multi-user isolation |
| `node scripts/smoke-ghjira.mjs` | GitHub + Jira against a **local mock** server |

### What CI does **not** cover (known gaps — no red badge is hiding these)

- **No JS/TS linter.** `tsc --noEmit` catches type errors and `fallow` catches dead
  code; nothing enforces style, unused imports, `any` usage, React hook rules, or
  shadowing. ESLint is not a dependency of this repo, so adding a lint step means
  adding (and first making pass) a whole toolchain — deliberately not done here.
  If you want it: install `eslint` + the TypeScript/React plugins, get
  `npx eslint src web` clean in a dedicated PR, then wire it into `npm run check`.
- **No real PostgreSQL.** `src/builtins/postgres.ts` (`pg_list_tables`,
  `pg_describe_table`, `pg_query`) is never connected to a database in any test —
  not locally, not in CI. `DATABASE_URL` is read at module load, so the module is
  simply *disabled* in every suite; the read-only SQL guard is unit-tested in
  isolation (`tests/sqlguard.test.ts`) but the Postgres path itself is unexercised.
  No service-container job was added because no existing script can drive it: the
  smoke scripts speak MCP over `/mcp` and would need a `DATABASE_URL`-connected
  server plus fixtures. That is a `scripts/` change, not a CI change.
- **Almost no outbound integration tests.** The keyless network modules
  (crypto, hn, weather, youtube) are only asserted to be *listed*; Notion, Slack and
  `web_search` are simply disabled in CI because no keys exist. The one place CI does
  reach the internet is `scripts/smoke.mjs`: `knowledge_vector_search` needs the
  `all-MiniLM-L6-v2` embedding model, downloaded from the HuggingFace CDN on a clean
  runner. If that download is blocked the module silently switches to its TF-IDF
  fallback, and the suite's semantic-match assertion ("feline companions that purr"
  → the Cats document) is what fails.
- **No real Google/GitHub sign-in.** Platform smoke signs up with email/password.
- **No coverage reporting.** `node --test` runs without a coverage flag or threshold,
  so there is no coverage number to regress and none to look at. (`node --test
  --experimental-test-coverage` is the starting point if you want it.)
- **The committed `public/` bundle is not verified against `web/`.** CI builds it but
  does not `git diff --exit-code public/`, so a stale commit passes — see
  [Why `public/` is committed](#why-public-is-committed-and-how-it-drifts).

For security review of upstream servers (or this repo) we recommend
[Cisco AI MCP Scanner](https://github.com/cisco-ai-defense/mcp-scanner):

```bash
uv tool install --python 3.13 cisco-ai-mcp-scanner
# scan a deployed remote MCP endpoint:
mcp-scanner --server-url https://your-host/mcp --analyzers yara --format summary
```

## Packaging & publishing

`package.json` declares `main`/`bin` as `dist/index.js`, and `dist/` is gitignored,
so the tarball is built, not cloned. Two mechanisms keep it honest:

- **`files`** is an explicit allowlist — `dist/` (compiled backend), `public/` (the
  dashboard the server serves from disk), `skills/` (read at boot, resolved next to
  the compiled code) and `config/` (just `servers.example.json`, the documented
  starting point for `MCP_WORKSTATION_SERVERS`). `registry/` and `docs/` are *not*
  runtime inputs and stay out of the tarball. Without `files`, npm falls back to
  `.gitignore`, which would publish a package with no entry point at all.
- **`prepare`** runs `npm run build` (`tsc` → `dist/`) on `npm install` in a clone and
  again before `npm publish`, so a publish from a clean checkout always has `dist/`.
  It is the backend compile only: `public/` ships as committed (see
  [Why `public/` is committed](#why-public-is-committed-and-how-it-drifts)), so
  **rebuild and commit `public/` before releasing**.

Before publishing, verify the tarball contents rather than trusting the list above:

```bash
npm pack --dry-run          # must list dist/index.js, public/, skills/, config/
```

### Known packaging defects (documented, not papered over)

1. **The `bin` entry has no shebang.** `src/index.ts` starts with an import, so the
   emitted `dist/index.js` has no `#!/usr/bin/env node` line. On POSIX the installed
   `mcp-workstation` command is therefore not executable (`node dist/index.js
   --stdio` or the `npm run stdio` script still work; Windows is unaffected because
   npm generates a `.cmd` shim that calls `node` explicitly). Fixing it means adding
   the shebang to `src/index.ts` — a source change, deliberately not done from the
   docs.
2. **The server resolves `public/`, `config/servers.json` and the default `data/`
   paths from `process.cwd()`**, not from the package directory. Run from anywhere
   other than the project root and the dashboard 404s while the MCP endpoint keeps
   working — surprising for a globally installed CLI. `skills/` is the one asset that
   is resolved relative to the code.

## Style

- Plain TypeScript, strict mode, ESM (`"type": "module"`, `.js` import suffixes).
- No framework in the core; node:http + the official MCP SDK packages only. The
  dashboard (`web/`) is React + Vite and follows its own conventions.
- Comments explain *why*, not *what*.
- Prefer small pure helpers (`src/utils.ts`) over inline repetition.
- There is no formatter or linter configured, so match the surrounding file's style
  by hand (2-space indent, double quotes in `src/`).
