---
name: test-driven-development
description: Test-driven development — write a failing test first, make it pass with the smallest change, then refactor. Use whenever implementing a feature that can be tested.
category: Development
version: 1.0.0
---

# Test-Driven Development

Use this skill whenever implementing new behavior that can be tested (functions, endpoints, components, bug fixes).

## The red-green-refactor loop

1. **Write a failing test first.** Name it for the behavior, not the implementation (`it("returns 404 for an unknown id")`). Run it and watch it fail for the right reason — a real assertion, not a syntax error.
2. **Write the smallest code that passes.** Resist writing the "full" solution; pass the test, then move on.
3. **Refactor with the safety net.** Clean up duplication and naming while the test keeps proving behavior. Commit at green.

## Rules

- **One behavior per test.** If a test asserts three things, split it.
- **Test the contract, not the internals.** Prefer public behavior over implementation details, so refactors don't rewrite tests.
- **Cover the edges:** empty input, max sizes, errors, timezones, encoding, auth failures — not just the happy path.
- **Keep tests fast and deterministic.** No sleeps, no wall-clock dependence, no reliance on network order.
- **When a bug is reported:** write a test that reproduces it first, watch it fail, fix the code, then watch it pass. The test stays forever.

## Output

Summarize: what behavior was added, the test that proves it, and the command to run it.
