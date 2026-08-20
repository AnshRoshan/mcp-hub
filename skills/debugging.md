---
name: debugging
description: Systematic debugging — reproduce, isolate, hypothesize, instrument, verify. Use whenever something misbehaves and the cause is not obvious.
category: Development
version: 1.0.0
---

# Debugging

Use this skill for any "why doesn't this work" request.

## The loop

1. **Reproduce first.** Get a minimal, reliable repro. If you can't reproduce, gather what the user did, in order, and what they expected vs. saw.
2. **Read the error like evidence.** Copy the exact error text, stack trace, and surrounding log lines. Note the failing line, not just the message.
3. **Form one hypothesis** about the root cause. State it explicitly: "I believe X because Y."
4. **Instrument to test it** — the cheapest probe that discriminates: a log line, a minimal unit test, or reading the docs of the API in question. Change one variable at a time.
5. **Verify the fix** against the original repro, then run the project's typecheck and relevant tests.

## Rules

- **Never guess-and-poke.** Each experiment must follow from a stated hypothesis.
- **Check the environment** — wrong version, missing env var, stale build, wrong working directory. List these before deep-diving code.
- **Bisect** — for regressions, find the change that introduced it (git bisect or binary search over commits/inputs).
- **Check the boundary** — most bugs are at edges: empty input, max sizes, timezones, encoding, float precision, off-by-one.
- **Timebox.** If a hypothesis isn't confirmed in ~15 minutes, re-examine the assumptions underneath it.

## Output

Report: what was wrong, the root cause, the fix, and how you verified it — in that order.
