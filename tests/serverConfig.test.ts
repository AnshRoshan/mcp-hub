import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSecrets, encodeSecrets, encryptStringMap, rowToConfig, serverDto } from "../src/platform/serverConfig.js";
import { encryptSecret } from "../src/platform/crypto.js";
import type { McpServerRow } from "../src/platform/db.js";

const SECRET = "unit-test-secret-unit-test-secret-1";
const SECRET_OTHER = "different-secret-different-secret-xyz";

test("secrets round-trip through the encrypted blob", () => {
  const values = { GITHUB_TOKEN: "ghp_x", NOTION_TOKEN: "ntm_y" };
  const blob = encodeSecrets(values, SECRET);
  assert.notEqual(blob, JSON.stringify(values));
  assert.ok(!blob.includes("ghp_x"), "ciphertext must not contain the raw token");
  assert.deepEqual(decodeSecrets(blob, SECRET), values);
});

test("decodeSecrets is forgiving: unset, wrong key, junk", () => {
  assert.deepEqual(decodeSecrets(undefined, SECRET), {});
  assert.deepEqual(decodeSecrets("not-a-ciphertext", SECRET), {});
  const blob = encodeSecrets({ GITHUB_TOKEN: "s" }, SECRET);
  assert.deepEqual(decodeSecrets(blob, SECRET_OTHER), {}, "wrong key must not decrypt");
});

test("decodeSecrets drops names outside the allowlist", () => {
  // Bypass encodeSecrets to simulate a tampered/crafted blob.
  const raw = encryptSecret(JSON.stringify({ GITHUB_TOKEN: "ok", DATABASE_URL: "evil" }), SECRET);
  const values = decodeSecrets(raw, SECRET);
  assert.deepEqual(Object.keys(values), ["GITHUB_TOKEN"]);
});

test("rowToConfig decrypts env/headers and maps stdio vs http", () => {
  const base: McpServerRow = {
    id: "1",
    userId: "u",
    key: "box",
    type: "stdio",
    command: "node",
    args: JSON.stringify(["-y", "srv"]),
    envEnc: encodeSecrets({ MY_VAR: "v" }, SECRET),
    enabled: 1,
    createdAt: "2026-01-01T00:00:00Z",
  };
  assert.deepEqual(rowToConfig(base, SECRET), {
    key: "box",
    type: "stdio",
    command: "node",
    args: ["-y", "srv"],
    cwd: undefined,
    env: { MY_VAR: "v" },
  });

  const httpRow: McpServerRow = {
    id: "2",
    userId: "u",
    key: "api",
    type: "http",
    url: "https://example.com/mcp",
    headersEnc: encodeSecrets({ Authorization: "Bearer x" }, SECRET),
    enabled: 1,
    createdAt: "2026-01-01T00:00:00Z",
  };
  assert.deepEqual(rowToConfig(httpRow, SECRET), {
    key: "api",
    type: "http",
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer x" },
  });
});

const serverRow = (over: Partial<McpServerRow>): McpServerRow =>
  ({
    id: "r1",
    userId: "u1",
    key: "srv",
    type: "http",
    url: "https://example.invalid/mcp",
    enabled: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as McpServerRow;

test("serverDto reports unreadable credentials instead of throwing", () => {
  const enc = encryptStringMap({ API_KEY: "value-not-returned" }, SECRET);

  const healthy = serverDto(serverRow({ envEnc: enc }), SECRET) as Record<string, unknown>;
  assert.deepEqual(healthy.envKeys, ["API_KEY"]);
  assert.equal(healthy.secretsUnreadable, false);
  assert.ok(!JSON.stringify(healthy).includes("value-not-returned"), "values must never leave the server");

  // The same row after a BETTER_AUTH_SECRET rotation. This used to throw, which
  // turned GET /api/servers into a 500 and hid every server the user owns.
  const rotated = serverDto(serverRow({ envEnc: enc }), SECRET_OTHER) as Record<string, unknown>;
  assert.deepEqual(rotated.envKeys, []);
  assert.equal(rotated.hasEnv, true, "a credential is still stored there");
  assert.equal(rotated.secretsUnreadable, true);
});
