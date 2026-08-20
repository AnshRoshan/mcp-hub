---
name: sql-querying
description: Write safe, efficient SQL — inspect schemas first, use parameterized queries, prefer indexes, and never run destructive statements without confirmation.
category: Data
version: 1.0.0
---

# SQL Querying

Use this skill whenever writing or running SQL against a database.

## Before querying

- **Inspect first.** List tables, view schemas/columns and indexes before writing queries. Never guess column names.
- **Know the dialect.** MySQL, Postgres, SQLite and MSSQL differ — check which engine you're on before writing syntax.

## Writing queries

- **Parameterize everything.** Never interpolate user input into SQL strings; use bound parameters (`?` / `$1` / `%s`). This is non-negotiable.
- **`SELECT` only what you need** — no `SELECT *` in application code.
- **Use `LIMIT`** on exploratory queries so a mistake can't return millions of rows.
- **Prefer index-friendly filters**: equality on indexed columns, then ranges. Avoid `WHERE func(col) = x` — it defeats indexes.
- **Aggregate carefully** — know whether `COUNT(*)` vs `COUNT(col)` (NULLs excluded) matters for the question.

## Safety

- Never run `DELETE`, `UPDATE`, `DROP`, `TRUNCATE` or `ALTER` without (1) a `SELECT` first showing exactly which rows are affected, and (2) explicit user confirmation.
- Wrap multi-statement writes in a transaction.
- Prefer `SELECT ... FOR UPDATE` / `UPSERT` over read-then-write races where needed.

## Explain

- For slow queries, run `EXPLAIN` and look for full table scans, missing indexes, or accidental cross joins.
