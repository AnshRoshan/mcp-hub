---
name: code-review
description: Structured code review — read diffs critically, check for correctness, security, performance and clarity, and report findings ranked by severity.
category: Development
version: 1.0.0
---

# Code Review

Use this skill whenever asked to review code, a pull request, or a diff.

## Workflow

1. **Scope first.** Identify the changed files and the intent of the change (from the PR description or commit messages). Read the diff, then read surrounding context — never review a single changed hunk in isolation.
2. **Check in this order, ranked by severity:**
   - **Correctness** — logic bugs, off-by-one errors, race conditions, wrong null/error handling, broken invariants.
   - **Security** — injection (SQL, shell, XSS), unsafe deserialization, secrets in code/logs, missing authz checks, path traversal.
   - **Performance** — N+1 queries, unbounded loops or memory growth, work repeated in hot paths, blocking I/O in async code.
   - **Clarity & maintainability** — misleading names, dead code, duplicated logic, missing error paths, over-engineering.
3. **Every finding needs:** a severity tag (`critical` / `major` / `minor` / `nit`), the exact file+line, why it matters, and a concrete suggested fix.
4. **Be specific, not generic.** Say `"x may be null when y is falsy — guard with ?."` not `"handle nulls"`.
5. **Acknowledge what's good.** Note 1-3 things the code does well so the tone stays constructive.

## Output format

```markdown
## Review: <change title>

### Critical
- `file.ts:42` — <issue> → <fix>

### Major
- ...

### Minor / Nits
- ...

### Highlights
- ...
```
