---
name: security-audit
description: Audit code for common vulnerabilities — injection, authn/authz, secrets, data exposure, dependency risks. A ranked checklist with concrete fixes.
category: Security
version: 1.0.0
---

# Security Audit

Use this skill when asked to audit code for security issues.

## Check in this order

1. **Injection** — SQL (parameterized?), shell (never build commands from strings), OS command, template/SSRF (URLs built from user input?). Trace every input to its sink.
2. **Authentication & authorization** — Is every protected endpoint actually checking auth? Are *ownership* checks done (user A can't touch user B's data)? Token/session expiry, default credentials.
3. **Secrets** — Hardcoded keys, secrets in client-side code, logs, or commit history. Should be env vars / secret managers, rotated, and scoped.
4. **Data exposure** — Over-broad API responses (returning password hashes, internal ids), verbose error messages leaking internals, missing rate limiting on sensitive endpoints.
5. **Dependencies** — Known-vulnerable versions (`npm audit` / `osv-scanner`), unpinned supply-chain risk in CI, abandoned packages.
6. **Web specifics** — XSS (is untrusted content escaped at the right layer?), CSRF on state-changing endpoints, open redirects, insecure headers, file upload validation.

## Output

For each finding: **severity** (`critical` / `high` / `medium` / `low`), file+line, the attack scenario in one sentence, and the concrete fix. End with the top 3 fixes to do first.
