---
name: secrets-handling
description: Keep secrets safe in code and infrastructure — never log or commit them, use environment variables and secret managers, and rotate anything exposed.
category: Security
version: 1.0.0
---

# Secrets Handling

Use this skill whenever working with API keys, tokens, passwords, or any credential — in code, config, docs, or prompts.

## The rules

- **Never hardcode.** No keys in source, config files, or test fixtures. Secrets live in environment variables, secret managers (Vault, AWS Secrets Manager, Doppler, 1Password CLI), or the platform's own secret store.
- **Never log or echo.** Redact tokens from logs, error messages, and stack traces. A secret that reaches a log line is a leaked secret.
- **Never paste into prompts or chat.** API keys do not belong in conversations, issue trackers, or docs. Use placeholders (`<YOUR_API_KEY>`) in examples.
- **Check what you are committing.** Before any commit: `git diff` for secrets, check `.gitignore`, and run a secret scanner (gitleaks, trufflehog, or your CI's scanner) on the diff.
- **Env files are local.** `.env` is for local development only and must be gitignored; ship `.env.example` with placeholder values and a comment for where each value comes from.
- **Scope and rotate.** Use the least-privileged token that works, set expiry where supported, and rotate credentials on a schedule — and immediately on any suspected exposure.

## If a secret leaks

1. **Rotate it now** — revoke and replace the credential before investigating. Assume exposure is real.
2. **Find the spread** — grep history, logs, and forks; a committed secret is in every clone.
3. **Fix the flow** — move the secret to env/secret manager and add a scanner to CI so it cannot return.

## Review checklist

- [ ] No secrets in tracked files or history
- [ ] `.env` gitignored; `.env.example` present with placeholders
- [ ] Logging redacts credentials
- [ ] Tokens are scoped, expiring, and rotated
