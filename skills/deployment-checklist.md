---
name: deployment-checklist
description: Safe deployments — pre-flight checks, rollback plan, verification steps. Use before pushing anything to production.
category: DevOps
version: 1.0.0
---

# Deployment Checklist

Use this skill before any deployment or release.

## Pre-flight

- [ ] **Build passes locally**: typecheck + tests + build (`npm run build` / `tsc --noEmit` / equivalent).
- [ ] **Migrations are safe**: backward-compatible, reversible, and tested against a copy of production data.
- [ ] **Env/config diffs reviewed** — new required vars are set in the target environment, with secrets not committed anywhere.
- [ ] **Breaking changes** are called out to users, with a documented migration path.
- [ ] **Rollback plan exists**: previous artifact/commit is tagged and restorable (`git tag`, container image, or artifact ID). Know the exact command.
- [ ] **No destructive commands** (DB truncate, cache flush, force-push) scheduled as part of the deploy.

## Deploy

- Prefer small, incremental deploys over big-bang changes.
- Watch logs from the first seconds — startup errors surface immediately.

## Post-deploy verification

- [ ] Health check / smoke test passes against the *new* build.
- [ ] Monitor key metrics (error rate, latency) for 10–15 minutes, not just the first request.
- [ ] If something is wrong: **roll back first, debug second** — do not attempt fixes live in production unless the rollback path is worse.

## Golden rule

If a step in the plan is unclear, stop and clarify before deploying. Deployments should be boring.
