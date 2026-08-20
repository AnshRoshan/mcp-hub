import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { PlatformDb } from "./db.js";
import { randomToken, sha256Hex } from "./crypto.js";

/** Tokens live effectively forever (they can be revoked from the dashboard). */
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 365 * 10;

export interface MintedToken {
  id: string;
  name: string;
  /** The raw token — shown to the user exactly once, never stored. */
  token: string;
  createdAt: string;
}

/** Create a token for a user. Returns the raw token once. */
export function mintToken(db: PlatformDb, userId: string, name: string): MintedToken {
  const token = randomToken("mcw_");
  const row = db.insertToken(userId, name, sha256Hex(token));
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
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Unknown API token");
      }
      db.touchToken(row.id);
      return {
        token,
        clientId: row.id,
        scopes: ["mcp"],
        expiresAt: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
        extra: { userId: row.userId },
      };
    },
  };
}
