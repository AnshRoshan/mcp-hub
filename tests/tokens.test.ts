import { test } from "node:test";
import assert from "node:assert/strict";
import { PlatformDb } from "../src/platform/db.js";
import { mintToken, OAUTH_TOKEN_LIFETIME_SECONDS } from "../src/platform/tokens.js";
import { sha256Hex } from "../src/platform/crypto.js";

/** An in-memory platform DB with one real `user` row, as bearer auth expects. */
function dbWithUser(userId = "u1"): PlatformDb {
  const db = new PlatformDb(":memory:");
  const now = new Date().toISOString();
  db.db
    .prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, "Alice", "alice@example.com", 0, now, now);
  return db;
}

test("a token resolves while its owner exists", () => {
  const db = dbWithUser();
  const minted = mintToken(db, "u1", "dashboard");
  const row = db.getTokenByHash(sha256Hex(minted.token));
  assert.equal(row?.userId, "u1");
  assert.equal(row?.expiresAt, null, "revoke-only tokens carry no expiry");
});

test("a token stops resolving once its lifetime passes", () => {
  const db = dbWithUser();
  const expired = mintToken(db, "u1", "oauth", -60);
  assert.equal(db.getTokenByHash(sha256Hex(expired.token)), undefined);

  const live = mintToken(db, "u1", "oauth", OAUTH_TOKEN_LIFETIME_SECONDS);
  const row = db.getTokenByHash(sha256Hex(live.token));
  assert.ok(row?.expiresAt);
  assert.ok(Date.parse(row.expiresAt) > Date.now());
});

test("deleting an account invalidates its tokens", () => {
  const db = dbWithUser();
  const minted = mintToken(db, "u1", "dashboard");
  assert.ok(db.getTokenByHash(sha256Hex(minted.token)));
  db.db.prepare("DELETE FROM user WHERE id = ?").run("u1");
  assert.equal(db.getTokenByHash(sha256Hex(minted.token)), undefined);
});
