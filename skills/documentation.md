---
name: documentation
description: Write clear technical documentation — READMEs, API docs, changelogs. Structure for scanning, show working examples, document the why.
category: Writing
version: 1.0.0
---

# Documentation

Use this skill whenever writing or improving documentation.

## Principles

- **Lead with the answer.** The first paragraph of any doc says what this thing is and why it exists. A reader should know whether this page is for them within 5 seconds.
- **Structure for scanning.** Short sections, meaningful headings, bullet lists, tables for comparisons. Walls of prose get skimmed, not read.
- **Show working examples** — a copy-pasteable example beats a paragraph of explanation. Include expected output where it helps.
- **Document the *why*, not just the *what*.** The what changes; the why explains the design.
- **One level of detail per audience.** Quickstart for users, reference for integrators, internals for maintainers. Don't mix them in one page.

## Conventions

- Use `code` for commands, file paths, and identifiers; fenced blocks for multi-line commands.
- Keep a table of contents for anything over ~300 lines.
- Version any breaking behavior; note deprecations with timelines.

## Checklist before done

- [ ] Can a new reader run the first example without asking for help?
- [ ] Are all commands/paths actually correct (verify them)?
- [ ] Is there a "Common problems / FAQ" for the top 3 mistakes?
- [ ] Are errors people will hit documented, with fixes?
