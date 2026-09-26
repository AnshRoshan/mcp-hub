---
name: regex-crafting
description: Build and harden regular expressions with a draft-test-prove loop using the regex_test tool — no guessing, every pattern verified against real samples.
category: Development
version: 1.0.0
---

# Regex Crafting

Use this skill for any "write a regex" request. Never hand over an untested
pattern — prove it with `regex_test` first.

## Process

1. **Collect samples before writing.** Ask for (or infer) at least one matching and one *near-miss* non-matching string. The near-miss is where patterns die.
2. **Draft the smallest pattern that matches.** Literal-first; add classes only where variability is real.
3. **Test with `regex_test`.** Inspect every match's `groups` and `named` output — a match count alone proves nothing about capture positions.
4. **Attack your own pattern.** Test empty input, unicode, the string as a substring of noise, and catastrophic backtracking shapes (nested quantifiers like `(a+)+b`). If a test can be slow, anchor it.
5. **Deliver with three artifacts:** the pattern, one matching example, one rejected near-miss. State the flags required (`i`, `m`) — a pattern tested with `g` may behave differently without it.

## Conventions

- Prefer named groups (`(?<year>…)`) over positional — they survive edits.
- In JS, `\d` is ASCII-only; say so if the input can contain unicode digits.
- Anchors: `^…$` with the `m` flag changes meaning per line; test both modes.
- For validation (whole-string match), wrap in `^(?:…)$` and test that a suffixed garbage string fails.
