---
name: release-notes
description: Write clear release notes — lead with what users actually gain, group by user impact, and link each entry to its change.
category: Writing
version: 1.0.0
---

# Release Notes

Use this skill whenever writing changelog entries or release notes from a set of commits or PRs.

## Structure

- **Lead with the headline.** What is the one thing a user should know about this release? Put it first — users skim.
- **Group by user impact**, not by repository structure: New features · Improvements · Fixes · Breaking changes. A "refactor" is not a user-facing category.
- **Write for the reader's question: "what changed for me?"** Every entry states the user-visible effect, not the internal mechanism.
- **Call out breaking changes loudly**, with a migration path. Never bury a breaking change in a list of fixes.
- **Link every entry** to its PR/commit so curious readers can dig in.

## Tone and rules

- Present tense, imperative verbs: "Adds…", "Fixes…", "Speeds up…". No passive vagueness ("various improvements were made").
- Be specific enough to test: "Fixes double-submission of the payment form" beats "fixes a payment bug".
- Acknowledge contributors where the project does; never fabricate names.
- Keep each entry to one or two lines; expand only when migration instructions are needed.

## Format

```markdown
## What's new
- **Headline feature** — one sentence on why it matters.
## Improvements
- ...
## Fixes
- ...
## Breaking changes
- ... — migration: ...
```
