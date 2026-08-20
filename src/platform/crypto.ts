import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Derive a 32-byte AES key from the auth secret. */
function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Encrypt a plaintext string; returns `iv.tag.ciphertext` base64 parts. */
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

/** Decrypt a value produced by {@link encryptSecret}. */
export function decryptSecret(payload: string, secret: string): string {
  const [ivB64, tagB64, encB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !encB64) return "";
  const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
}

/** SHA-256 hex digest (used for API token storage — never store raw tokens). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Random URL-safe token, e.g. `mcw_<43 chars>`. */
export function randomToken(prefix = "mcw_"): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}
