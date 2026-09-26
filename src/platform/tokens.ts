import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { PlatformDb } from "./db.js";
import { randomToken, sha256Hex } from "./crypto.js";

/**
 * Dashboard-minted tokens have no stored expiry and live until revoked, so
 * this is only the ceiling reported to a bearer client. OAuth-minted tokens
 * get a real `expires_at` instead — see OAUTH_TOKEN_LIFETIME_SECONDS.
 */
const UNREVOKED_LIFETIME_SECONDS = 60 * 60 * 24 * 365 * 10;

/** OAuth access tokens are short-lived and advertised as such. */
export const OAUTH_TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 30;

export interface MintedToken {
  id: string;
  name: string;
  /** The raw token — shown to the user exactly once, never stored. */
  token: string;
  createdAt: string;
}

/**
 * Create a token for a user. Returns the raw token once. Pass a lifetime to
 * mint one that stops working on its own; omit it for revoke-only tokens.
 */
export function mintToken(
  db: PlatformDb,
  userId: string,
  name: string,
  lifetimeSeconds?: number,
): MintedToken {
  const token = randomToken("mcw_");
  const expiresAt =
    lifetimeSeconds === undefined
      ? undefined
      : new Date(Date.now() + lifetimeSeconds * 1000).toISOString();
  const row = db.insertToken(userId, name, sha256Hex(token), expiresAt);
  return { id: row.id, name: row.name, token, createdAt: row.createdAt };
}

/**
 * Verifier for the MCP endpoint's `requireBearerAuth`. Resolves a raw API
 * token to a per-user {@link AuthInfo}; the workstation factory then builds
 * that user's tool catalog from `extra.userId`.
 */
export function createMcpTokenVerifier(db: PlatformDb): OAuthTokenVerifier {
  return {
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      const row = db.getTokenByHash(sha256Hex(token));
      if (!row) {
        // Covers unknown, expired, and whose owner's account is gone.
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Unknown, revoked or expired API token");
      }
      db.touchToken(row.id);
      return {
        token,
        clientId: row.id,
        scopes: ["mcp"],
        expiresAt:
          row.expiresAt !== null
            ? Math.floor(Date.parse(row.expiresAt) / 1000)
            : Math.floor(Date.now() / 1000) + UNREVOKED_LIFETIME_SECONDS,
        extra: { userId: row.userId },
      };
    },
  };
}
