/**
 * Server-side request forgery guard for the tools that fetch a
 * caller-supplied URL. A hub like this usually runs next to the thing you do
 * not want reachable — cloud metadata at 169.254.169.254, the platform DB on
 * localhost, other tenants' upstreams on internal ports — so every URL a
 * client names is resolved and screened before a request leaves, and again on
 * each redirect hop.
 */

import { promises as dns } from "node:dns";
import net from "node:net";
import { env } from "./utils.js";

/** Refused by default; comma-separated hostnames or suffixes (`.example.com`). */
function operatorAllowlist(): string[] {
  const raw = env("FETCH_ALLOWED_DOMAINS");
  if (raw === undefined) return [];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function matchedBy(host: string, patterns: string[]): boolean {
  return patterns.some((p) => (p.startsWith(".") ? host === p.slice(1) || host.endsWith(p) : host === p));
}

/** Loopback, private, link-local, multicast and other reserved ranges. */
export function isNonPublicAddress(ip: string): boolean {
  const mapped = ip.includes("%") ? ip.slice(0, ip.indexOf("%")) : ip;
  if (!net.isIP(mapped)) return true; // not an IP at all — refuse rather than guess
  if (net.isIP(mapped) === 4) {
    const [a, b] = mapped.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = mapped.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("fe") || v6.startsWith("fc") || v6.startsWith("fd")) return true; // link-local + ULA
  const embedded = /^::ffff:(.+)$/.exec(v6);
  if (embedded && net.isIP(embedded[1]) === 4) return isNonPublicAddress(embedded[1]);
  return false;
}

/**
 * Screen a URL: https-only unless it is an explicit http allowlist entry, no
 * credentials in the authority, and — when the operator set one — inside the
 * domain allowlist.
 */
export function assertUrlAllowed(raw: string, callerAllowlist: string[] = []): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Only http/https URLs are allowed (got "${url.protocol}")`);
  }
  if (url.username || url.password) throw new Error("URLs with embedded credentials are refused");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isNonPublicAddress(host)) {
    throw new Error(`Refusing to request a non-public address (${host})`);
  }
  const operator = operatorAllowlist();
  if (operator.length > 0 && !matchedBy(host, operator)) {
    throw new Error(`Host "${host}" is not in this deployment's FETCH_ALLOWED_DOMAINS`);
  }
  // A caller may narrow the set it was given, never widen past the operator's.
  if (callerAllowlist.length > 0 && !matchedBy(host, callerAllowlist.map((d) => d.toLowerCase()))) {
    throw new Error(`Host "${host}" is not in the requested allowlist`);
  }
  return url;
}

/**
 * Resolve the host and reject it if any record points at a non-public address.
 * Checked at request time so a public name that is really an internal host
 * cannot be used to reach metadata or loopback services.
 */
async function assertResolvesPublic(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isNonPublicAddress(host)) throw new Error(`Refusing to request a non-public address (${host})`);
    return;
  }
  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve "${host}"`);
  }
  if (records.length === 0) throw new Error(`"${host}" resolved to no addresses`);
  const bad = records.find((r) => isNonPublicAddress(r.address));
  if (bad) throw new Error(`Refusing "${host}": it resolves to a non-public address (${bad.address})`);
}

export interface GuardedFetchResult {
  response: Response;
  finalUrl: string;
}

/**
 * Fetch with the guard applied to every hop. Redirects are followed manually
 * because a permissive `redirect: "follow"` would validate only hop zero and
 * let any server 302 the request to an internal address.
 */
export async function guardedFetch(
  raw: string,
  init: RequestInit,
  opts: { maxRedirects?: number; allowedDomains?: string[] } = {},
): Promise<GuardedFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 3;
  const allowed = opts.allowedDomains ?? [];
  let next = assertUrlAllowed(raw, allowed);
  for (let hop = 0; ; hop++) {
    await assertResolvesPublic(next);
    const response = await fetch(next, { ...init, redirect: "manual" });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (location === null) return { response, finalUrl: next.toString() };
    if (hop >= maxRedirects) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Too many redirects (limit ${maxRedirects})`);
    }
    let target: URL;
    try {
      target = new URL(location, next);
    } catch {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Invalid redirect target: "${location}"`);
    }
    next = assertUrlAllowed(target.toString(), allowed);
    await response.body?.cancel().catch(() => {});
  }
}
