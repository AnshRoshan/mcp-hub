---
name: api-smoke-test
description: Smoke-test a running HTTP API with curl — auth header shapes, status and schema assertions, rate-limit and error-path checks, in a repeatable script.
category: Testing
version: 1.0.0
---

# API Smoke Testing

Use this skill to verify a deployed service actually works — after a deploy,
before a demo, or when "it works on my machine" is disputed.

## Process

1. **Enumerate routes from the source of truth** (OpenAPI spec, router file, or docs) — not from memory. List method + path + expected status for each.
2. **Probe in order:** health endpoint → auth rejection (call a protected route with no token; it MUST be 401/403, a 200 here is a P0) → authenticated happy path → one error path (404, 422) → rate-limit behavior if advertised.
3. **Assert three layers per call:** transport (status code), shape (required fields exist — `jq -e '.id and .name'`), and semantics (the value actually changed what you expect).
4. **Write it as a script, not one-liners.** Every check: `curl -sS -o /tmp/body -w "%{http_code}"`, compare, print PASS/FAIL, exit non-zero on any FAIL. A smoke test nobody can run twice is a story.

## Patterns

- Time-box everything: `--max-time 10`; a hanging endpoint is a failure, not a slow success.
- Send `-H "Accept: application/json"` so error bodies stay parseable.
- For Bearer-token APIs, keep the token in an env var (`-H "Authorization: Bearer $TOKEN"`), never inline in the script or shell history.
- Check CORS preflight on browser-facing APIs: `curl -sSI -X OPTIONS -H "Origin: https://app.example.com" URL` and verify `access-control-allow-origin`.
- After a failed call, print the response body — "500" alone teaches nobody anything.

## Report

End with a table: route, method, expected, got, verdict. Call out the first
failure's body verbatim; downstream failures are usually the same bug.
