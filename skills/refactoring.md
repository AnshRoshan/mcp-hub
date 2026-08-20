---
name: refactoring
description: Safe refactoring — improve structure without changing behavior, using tests as a safety net and small verifiable steps.
category: Development
version: 1.0.0
---

# Refactoring

Use this skill whenever asked to clean up, simplify, or restructure existing code without changing what it does.

## Before you start

- **Establish the safety net.** Run the existing tests. If coverage is thin on the code being touched, add characterization tests that lock in current behavior first.
- **Never mix refactor and feature work.** A refactor that also changes behavior is two changes in one and cannot be verified.

## The discipline

- **Small steps, green after each.** Rename → test → commit. Extract → test → commit. If a step is hard to verify, it is too big; split it.
- **Prefer the mechanical moves:** extract function, extract variable, rename, inline, split loop, replace condition with polymorphism, move code to its natural home.
- **Let the structure show the intent.** A function should be nameable by what it does; a module by what it owns. If you cannot name it, the structure is wrong.
- **Remove what is dead.** Unused params, duplicate branches, commented-out code, and "just in case" abstractions — delete them; git keeps history.
- **Keep the diff reviewable.** A reviewer should be able to say "this is the same code, arranged better" without re-understanding the domain.

## Output

Report the refactor as: what changed structurally, how behavior was verified (which tests), and anything you deliberately left alone.
