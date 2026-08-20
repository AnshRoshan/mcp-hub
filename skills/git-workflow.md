---
name: git-workflow
description: Safe, clean git practice — inspect before acting, small focused commits, clear messages, and how to recover from common mistakes.
category: Development
version: 1.0.0
---

# Git Workflow

Use this skill for any git operation or commit request.

## Before you act

- **Always inspect first:** `git status`, `git diff`, `git log --oneline -10` to understand the working tree, staged changes, and recent commit style.
- Never run destructive commands (`reset --hard`, `push --force`, `clean -fd`, `rebase -i`) without an explicit confirmation from the user.

## Committing

- **Small, focused commits.** One logical change per commit; stage only the files that belong to it (`git add <paths>`), never `git add -A` blindly.
- **Message style:** match the repo's existing convention (check `git log`). Focus on *why*: "Add rate limiting to the auth endpoint" not "update files".
- Do not commit unrelated pre-existing changes.

## Recovering

- Accidental unstaged change → restore selectively: `git checkout -- <path>` (destructive — confirm first) or `git stash`.
- Committed something wrong → `git commit --amend` for the most recent commit, `git revert <sha>` for older ones (never rewrite shared history).
- Lost work → check `git reflog` before anything else.

## Branch hygiene

- Keep branches short-lived; pull/rebase to stay current instead of merging stale branches.
- Never force-push to shared branches.
