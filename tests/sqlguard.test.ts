import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReadOnly, hasSecondStatement, SQL_WRITE_RE, stripSqlComments } from "../src/utils.js";

const readOnly = { allowWrite: false, writeRe: SQL_WRITE_RE, dbName: "testdb", envVar: "TEST_WRITE" };

test("a comment prefix cannot hide a write keyword", () => {
  assert.equal(stripSqlComments("  -- drop everything\nDROP TABLE users").startsWith("DROP"), true);
  assert.equal(stripSqlComments("/* harmless */ DELETE FROM t").startsWith("DELETE"), true);
  assert.throws(() => assertReadOnly("-- x\nDROP TABLE users", readOnly), /read-only mode/);
  assert.throws(() => assertReadOnly("/* ok */ INSERT INTO t VALUES (1)", readOnly), /read-only mode/);
});

test("a data-modifying CTE is treated as a write", () => {
  assert.throws(() => assertReadOnly("WITH c AS (SELECT 1) INSERT INTO t SELECT * FROM c", readOnly), /read-only mode/);
  assert.throws(() => assertReadOnly("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", readOnly), /read-only mode/);
  assert.doesNotThrow(() => assertReadOnly("WITH c AS (SELECT 1) SELECT * FROM c", readOnly));
});

test("a second statement is refused rather than silently executed", () => {
  assert.equal(hasSecondStatement("SELECT 1; DROP TABLE users"), true);
  assert.equal(hasSecondStatement("SELECT 1;"), false);
  assert.equal(hasSecondStatement("SELECT 'a;b'"), false, "semicolon inside a literal is not a separator");
  assert.equal(hasSecondStatement('SELECT "x;y" FROM t'), false);
  assert.throws(() => assertReadOnly("SELECT 1; DROP TABLE users", readOnly), /one statement per call/);
  assert.doesNotThrow(() => assertReadOnly("SELECT 'a;b' AS x", readOnly));
});

test("reads that merely look like writes are not blocked by the classifier", () => {
  // `REPLACE` is deliberately absent from the leading-keyword list: it is both a
  // write statement and a string function, and the engine-level read-only open
  // (verified in the smoke suite) is what actually stops the write. Listing it
  // would break `SELECT replace(x, 'a', 'b')` for no security gain.
  for (const sql of ["SELECT replace(name, 'a', 'b') FROM t", "SELECT * FROM t WHERE x = 'delete'"]) {
    assert.doesNotThrow(() => assertReadOnly(sql, readOnly), sql);
  }
});

test("plain reads still pass and writes are still caught bare", () => {
  for (const sql of ["SELECT 1", "  select * from t where x = 1", "EXPLAIN SELECT 1", "PRAGMA table_info(docs)"]) {
    assert.doesNotThrow(() => assertReadOnly(sql, readOnly), sql);
  }
  for (const sql of ["UPDATE t SET a = 1", "DELETE FROM t", "VACUUM", "pragma journal_mode = wal"]) {
    assert.throws(() => assertReadOnly(sql, readOnly), /read-only mode/, sql);
  }
  assert.doesNotThrow(() => assertReadOnly("DELETE FROM t", { ...readOnly, allowWrite: true }));
});
