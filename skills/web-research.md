---
name: web-research
description: Effective online research — search strategically, read primary sources, cross-check claims, and answer with citations.
category: Research
version: 1.0.0
---

# Web Research

Use this skill for any "research / look up / find out" request.

## Process

1. **Decompose the question.** Break it into sub-questions; search each specifically rather than one broad query.
2. **Search strategically.** Vary keywords: official docs, vendor pages, then community discussion. Include version/date context (e.g. "2026", "v15").
3. **Prefer primary sources.** Official documentation, spec documents, the maintainer's repo. Treat blogs, forums, and AI-generated pages as secondary — verify anything important against the source of truth.
4. **Cross-check claims.** If something surprising matters (pricing, breaking changes, security), confirm it on at least two independent sources.
5. **Note the date.** Technology changes fast — say when information was current, and flag anything possibly stale.

## Output

- Answer the question directly, first.
- Cite sources inline (`[name](url)`) so the user can verify.
- If sources disagree, say so explicitly and explain which is more authoritative and why.
- State what you could not verify rather than papering over it.
