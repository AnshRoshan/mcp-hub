---
name: api-design
description: Design clear, consistent APIs — resource naming, error contracts, versioning, and documentation that other developers can consume without guessing.
category: Development
version: 1.0.0
---

# API Design

Use this skill whenever designing or reviewing an API: endpoints, function signatures, MCP tool schemas, or library interfaces.

## Principles

- **Model resources, not actions.** Prefer `/orders` + `POST /orders/{id}/cancel` over verbs in the path; keep actions as the exception, not the pattern.
- **Consistent naming.** Plural nouns for collections, kebab-case paths, snake_case or camelCase chosen once and enforced everywhere. Be predictable.
- **Small, stable contracts.** Return exactly the shape consumers need; extra fields are easy to add later, removed fields break clients.
- **Design errors like a contract.** Every failure returns a structured error: an error code, a human message, and a stable machine-readable identifier. Never return bare 500s with HTML bodies.
- **Version the contract** when it can change: explicit versions in the path or Accept header, and a documented deprecation policy.
- **Idempotency where it matters.** POSTs that create should accept an idempotency key; retries must not double-create.
- **Validate at the boundary.** Reject bad input early with clear messages — a fast 400 beats a confusing 500.

## For MCP tools

- Name tools as `verb_noun` (`get_issue`, `create_comment`) with a one-line description of what the tool does and when to use it.
- Describe every parameter with its type, constraints, and defaults — models read these descriptions to decide what to call.
- Return structured data, not prose, so callers can reason over the result.

## Output

Review checklist: naming, error handling, idempotency, versioning, and docs — with a concrete example of the contract in full.
