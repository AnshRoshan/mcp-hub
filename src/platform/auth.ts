import { betterAuth } from "better-auth";
import type { DatabaseSync } from "node:sqlite";
import { env, envBool } from "../utils.js";

export interface AuthConfig {
  /** URL clients use to reach this server, e.g. https://workstation.example.com */
  baseURL: string;
  secret: string;
  googleClientId?: string;
  googleClientSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  /** Allow email/password signup+signin (default: dev only). */
  allowEmail: boolean;
  /** Extra origins allowed to make auth requests (e.g. the dashboard's origin). */
  trustedOrigins?: string[];
}

export interface PlatformAuth {
  handler: (request: Request) => Promise<Response>;
  api: ReturnType<typeof betterAuth>["api"];
  options: ReturnType<typeof betterAuth>["options"];
  /** Resolve the signed-in user for a cookie-bearing request, or null. */
  sessionUser: (headers: Headers) => Promise<{
    id: string;
    email: string;
    name: string;
    image?: string;
  } | null>;
}

/**
 * Minimal OAuth scopes — only what the dashboard actually uses.
 * Google: identity + profile picture. GitHub: public profile + email.
 * We never request mail/Drive/contacts (Google) or repo write access (GitHub).
 */
const GOOGLE_SCOPES = ["openid", "email", "profile"];
const GITHUB_SCOPES = ["read:user", "user:email"];

/** Build the Better Auth instance bound to the shared platform SQLite file. */
export function createAuth(db: DatabaseSync, config: AuthConfig): PlatformAuth {
  const socialProviders: Record<string, { clientId: string; clientSecret: string; scopes: string[] }> = {};
  if (config.googleClientId && config.googleClientSecret) {
    socialProviders.google = {
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      scopes: GOOGLE_SCOPES,
    };
  }
  if (config.githubClientId && config.githubClientSecret) {
    socialProviders.github = {
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
      scopes: GITHUB_SCOPES,
    };
  }

  const auth = betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    database: db,
    trustedOrigins: [...(config.trustedOrigins ?? []), config.baseURL],
    socialProviders,
    ...(config.allowEmail ? { emailAndPassword: { enabled: true } } : {}),
    advanced: {
      cookiePrefix: "mcw",
      defaultCookieAttributes: {
        secure: config.baseURL.startsWith("https://"),
        sameSite: "lax",
      },
    },
    // Don't silently disable everything when no providers are configured.
    // The dashboard will show a hint if there's no way to sign in.
    logger: { disabled: !envBool("AUTH_DEBUG", false) },
  });

  return {
    handler: (request) => auth.handler(request),
    api: auth.api,
    options: auth.options,
    sessionUser: async (headers) => {
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) return null;
      return {
        id: session.user.id,
        email: session.user.email ?? "",
        name: session.user.name ?? "",
        image: session.user.image ?? undefined,
      };
    },
  };
}

/** Read the platform config from the environment. Returns null when platform mode is off. */
export function platformEnabled(): boolean {
  return env("BETTER_AUTH_SECRET") !== undefined;
}

/** Derive the public base URL: BETTER_AUTH_URL, or PUBLIC_BASE_URL, or localhost:PORT. */
function resolveBaseURL(port: number): string {
  return (
    env("BETTER_AUTH_URL") ??
    env("PUBLIC_BASE_URL") ??
    `http://localhost:${port}`
  );
}

/** Config for the platform (call only when platformEnabled()). */
export function loadAuthConfig(port: number): AuthConfig {
  const baseURL = resolveBaseURL(port);
  return {
    baseURL,
    secret: env("BETTER_AUTH_SECRET")!,
    googleClientId: env("GOOGLE_CLIENT_ID"),
    googleClientSecret: env("GOOGLE_CLIENT_SECRET"),
    githubClientId: env("GITHUB_CLIENT_ID"),
    githubClientSecret: env("GITHUB_CLIENT_SECRET"),
    // Email/password is a dev convenience; the product is Google + GitHub.
    allowEmail: envBool("ALLOW_EMAIL_AUTH", true),
    trustedOrigins: env("TRUSTED_ORIGINS")
      ? env("TRUSTED_ORIGINS")!.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
  };
}
