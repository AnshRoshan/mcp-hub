import { test } from "node:test";
import assert from "node:assert/strict";
import { isNonPublicAddress, assertUrlAllowed } from "../src/netguard.js";

test("non-public addresses are classified for the SSRF screen", () => {
  for (const ip of [
    "127.0.0.1", "127.8.9.10", // loopback
    "10.1.2.3", "172.16.5.4", "192.168.1.1", // RFC1918
    "169.254.169.254", // cloud metadata endpoint
    "0.0.0.0", "100.64.0.1", "198.18.0.1", "224.0.0.1", "240.0.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12::34",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "not-an-ip",
  ]) {
    assert.equal(isNonPublicAddress(ip), true, `${ip} should be refused`);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "172.32.0.1"]) {
    assert.equal(isNonPublicAddress(ip), false, `${ip} is public and must pass`);
  }
});

test("URL screening rejects non-http schemes and credentialed authorities", () => {
  assert.throws(() => assertUrlAllowed("file:///etc/passwd"), /Only http\/https/);
  assert.throws(() => assertUrlAllowed("gopher://example.com/x"), /Only http\/https/);
  assert.throws(() => assertUrlAllowed("not a url"), /Invalid URL/);
  assert.throws(() => assertUrlAllowed("https://user:pass@example.com/"), /embedded credentials/);
  assert.equal(assertUrlAllowed("https://example.com/x").hostname, "example.com");
});

test("URL screening refuses hosts that resolve to internal addresses", () => {
  assert.throws(() => assertUrlAllowed("http://169.254.169.254/latest/meta-data/"), /non-public address/);
  assert.throws(() => assertUrlAllowed("http://127.0.0.1:3125/mcp"), /non-public address/);
});

test("a caller allowlist can narrow but never widen past exact hosts or suffixes", () => {
  assert.equal(assertUrlAllowed("https://api.example.com/x", ["api.example.com"]).hostname, "api.example.com");
  assert.throws(() => assertUrlAllowed("https://other.example.com/x", ["api.example.com"]), /requested allowlist/);
  assert.doesNotThrow(() => assertUrlAllowed("https://sub.example.com/x", [".example.com"]));
  // Suffix entries must not match a lookalike registered domain.
  assert.throws(() => assertUrlAllowed("https://notexample.com/x", [".example.com"]), /requested allowlist/);
});
