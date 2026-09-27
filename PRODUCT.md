# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are developers and power users of AI coding harnesses (Claude Code, Cursor, VS Code Copilot, and similar MCP clients) who want **one endpoint** that aggregates every MCP server and skill they use. The dashboard is their control room: they sign in, register their own MCP servers, mint API tokens, toggle modules and individual tools, and browse the skills hub. A secondary audience is the person deploying the workstation (self-hosted, single machine or small fleet), who cares that it is secure by default and easy to run.

## Product Purpose

MCP Workstation is a self-hosted MCP server that aggregates everything: one `/mcp` endpoint carries every tool from every built-in module and every user-registered MCP server, plus a skills hub of reusable agent instruction sets. It is multi-user: sign-in with Google/GitHub (or email), per-user servers, per-user API tokens, and per-user control over every module and individual tool.

## Positioning

One endpoint, every MCP and skill — self-hosted, multi-user, and granular. A neighboring product cannot truthfully copy: per-request tool catalogs built from the authenticated user's own servers and prefs (absolute isolation), per-tool toggles down to a single tool name, everything on by default, secrets encrypted at rest, and an MCP + skills hub in one surface.

## Operating Context

- Dashboard at `/`, sign-in with Google/GitHub or email/password (Better Auth).
- Users register `stdio` or `http` MCP servers (secrets stored AES-256-GCM encrypted, never
  returned), toggle servers on/off, mint and revoke API tokens, toggle whole modules or
  individual tools, and enable/disable skills. User-registered `stdio` commands run as the
  hub's own OS user, so they are refused unless the operator allowlists the executable via
  `STDIO_ALLOWED_COMMANDS` (empty by default); `http` servers are unrestricted.
- Connected clients hit `/mcp` with `Authorization: Bearer <token>` using the 2026-07-28
  stateless protocol (legacy transports bridged). A client can also complete an OAuth 2.1
  authorization-code + PKCE flow against the built-in authorization server and receive the
  same kind of `mcw_` bearer token.
- Everything is on by default; missing keys disable only their module.
- The dashboard is a single page with a sidebar rail and views: Dashboard, MCP Directory,
  Connect, Servers, API Tokens, Credentials, Modules & Tools, Skills, Settings (+ the Auth
  view when signed out).

## Capabilities and Constraints

- Multi-user auth (Google, GitHub, email) with per-user isolation; per-user servers, tokens, prefs.
- 19 built-in modules registered by `registerBuiltins()` (`src/server.ts`), grouped by category
  (Utilities, Web & API, Knowledge & Memory, Files & Data, Development, Productivity,
  Communication, Finance & Crypto, Web & News, Skills Hub) — time, uuid, fetch, memory,
  filesystem, knowledge, github, jira, search, postgres, sqlite, notion, slack, crypto, hn,
  weather, devkit, youtube, skills — and every catalog additionally carries the
  `workstation` operations module (`workstation_status` / `workstation_reload`), so
  `workstation_status` reports 20 modules.
- Per-module and per-tool toggles; per-user skills hub (skills/*.md, loadable via skills_list / skills_get).
- Constraint (user-confirmed): **dark theme** (shipped as the default register; a
  persisted DAY/NIGHT toggle is part of the design — see DESIGN.md); **sidebar + views
  structure** stays; **all current features** stay; Google/GitHub + email sign-in flow stays.
- Implementation: dashboard source in `web/src/` — React 19 + Vite + Tailwind CSS v4 +
  Meta's Astryx design system — built by `npm run build:web` into the committed `public/`
  bundle, which the Node backend serves; backend is plain TypeScript (Node ≥ 22.5,
  `node:sqlite`, Better Auth, MCP SDK v2 stateless).
- Stack is an existing codebase — not an open decision.

## Brand Commitments

- Name: **MCP Workstation**. Mark: ⚡ bolt.
- Dark theme (binding). Sidebar + views information architecture (binding).
- No claims of features the product does not have; no fabricated testimonials, customers, or benchmarks.

## Evidence on Hand

- Working product: dashboard, platform mode, per-user catalogs, skills hub. Automated
  coverage is **backend-side**: `npm test` (core smoke), `npm run test:platform`
  (sign-up → tokens → per-user `/mcp` → isolation → OAuth 2.1 AS round trip) and
  `npm run test:integrations` (GitHub + Jira against a **local mock** API). The dashboard
  itself has no UI/visual tests — only `npm run typecheck:web` and the Vite build.
- Network integrations that need no keys: CoinGecko (crypto), Hacker News, Open-Meteo
  (weather). They were exercised by hand; **no automated test calls them** — the smoke
  suites only assert the tools are listed, so the live response shape is untested.
  Google/GitHub sign-in is wired through Better Auth and is also verified by hand: CI
  signs in with **email/password**, so provider round-trips are not automated.
- No user-generated testimonials exist; do not fabricate any.

## Product Principles

1. **Everything on by default, off with precision.** New users get every module, tool, and skill; turning something off is always possible down to a single tool.
2. **Isolation is absolute.** A user only ever sees their own servers, tokens, and preferences — enforced per request.
3. **One hub, two kinds of capability.** MCP tools and skills share one surface and one endpoint; neither is a second-class citizen.
4. **Ship-grade by default.** Secrets encrypted at rest, tokens hashed, missing keys degrade gracefully, destructive actions require confirmation.
5. **First impressions are the product.** This is software being shipped to others; the dashboard must read as premium and precise in the first seconds.
