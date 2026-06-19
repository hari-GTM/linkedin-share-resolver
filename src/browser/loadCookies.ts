// Parse Playwright-compatible cookies from the LINKEDIN_COOKIES env var.
//
// SECURITY: cookie values are never logged or returned. This module only
// reports counts and validity, never contents.

import type { Cookie } from 'playwright';
import { logger } from '../logger';

export interface LoadCookiesResult {
  cookies: Cookie[];
  /** True when at least one usable cookie was parsed. */
  available: boolean;
}

/**
 * Accepts either:
 *  - a JSON array of Playwright cookie objects: [{ name, value, domain, path, ... }]
 *  - a JSON object with a `cookies` array property
 *
 * Each cookie must carry name + value, and either (domain & path) or a url.
 * Invalid entries are dropped. Returns an empty, unavailable result when the
 * env var is missing or unparseable (the resolver then runs unauthenticated).
 */
export function loadCookies(raw: string): LoadCookiesResult {
  if (!raw || raw.trim().length === 0) {
    return { cookies: [], available: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn('LINKEDIN_COOKIES is set but is not valid JSON; ignoring');
    return { cookies: [], available: false };
  }

  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { cookies?: unknown }).cookies)
      ? ((parsed as { cookies: unknown[] }).cookies)
      : [];

  if (arr.length === 0) {
    logger.warn('LINKEDIN_COOKIES parsed but contained no cookies; ignoring');
    return { cookies: [], available: false };
  }

  const cookies: Cookie[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    const name = typeof c.name === 'string' ? c.name : undefined;
    const value = typeof c.value === 'string' ? c.value : undefined;
    if (!name || value == null) continue;

    const domain = typeof c.domain === 'string' ? c.domain : undefined;
    const path = typeof c.path === 'string' ? c.path : undefined;
    const url = typeof c.url === 'string' ? c.url : undefined;

    // Playwright requires either url, or domain+path.
    let cookie: Cookie;
    if (domain && path) {
      cookie = normalizeFields({ name, value, domain, path }, c);
    } else {
      cookie = normalizeFields({ name, value, url: url ?? 'https://www.linkedin.com' }, c);
    }
    cookies.push(cookie);
  }

  if (cookies.length === 0) {
    logger.warn('LINKEDIN_COOKIES contained no valid cookie entries; ignoring');
    return { cookies: [], available: false };
  }

  logger.info('Loaded LinkedIn cookies', { count: cookies.length });
  return { cookies, available: true };
}

function normalizeFields(base: Record<string, unknown>, src: Record<string, unknown>): Cookie {
  const out: Record<string, unknown> = { ...base };

  if (typeof src.expires === 'number') out.expires = src.expires;
  if (typeof src.httpOnly === 'boolean') out.httpOnly = src.httpOnly;
  if (typeof src.secure === 'boolean') out.secure = src.secure;

  // sameSite must be one of Strict | Lax | None for Playwright.
  if (typeof src.sameSite === 'string') {
    const s = src.sameSite.toLowerCase();
    if (s === 'strict') out.sameSite = 'Strict';
    else if (s === 'lax') out.sameSite = 'Lax';
    else if (s === 'none' || s === 'no_restriction') out.sameSite = 'None';
  }

  return out as unknown as Cookie;
}
