// Core resolver: open a Share URL, run the strategy chain, confirm the match,
// normalize, and return a structured outcome. Handles retries with exponential
// backoff, an unauthenticated-then-authenticated escalation, LinkedIn state
// detection, and optional debug artifacts on failure.

import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { BrowserContext, Page } from 'playwright';
import type { AppConfig } from '../config';
import { withContext } from '../browser/createBrowser';
import type { LoadCookiesResult } from '../browser/loadCookies';
import { logger } from '../logger';
import { strategies } from './strategies';
import { classifyPageState, adjustForAuthAttempt, type PageState } from './detectLinkedInState';
import { isAcceptableActivityUrl, normalizeActivityUrl, extractActivityId } from './normalizeUrl';
import type { ResolverOutcome, StrategyContext } from '../types';

export interface ResolveOptions {
  config: AppConfig;
  cookies: LoadCookiesResult;
  /** Opaque id for correlating logs across one request. */
  requestId: string;
}

const HIGH_TRUST_STRATEGIES = new Set(['current-url', 'canonical-link', 'og-url-meta']);

/** Sleep helper for backoff. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract the human-readable slug from a LinkedIn post URL, stripping the
 * author prefix ("goodera_") and the trailing "-<type>-<id>-<suffix>".
 * Used to confirm a candidate Activity URL belongs to the supplied Share URL.
 */
export function descriptiveSlug(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const seg = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    let s = decodeURIComponent(seg).toLowerCase();
    s = s.replace(/-(share|activity|ugcpost)-\d+.*$/i, '');
    const underscore = s.indexOf('_');
    if (underscore >= 0 && underscore < s.length - 1) {
      s = s.slice(underscore + 1);
    }
    return s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

/** Token-overlap comparison of two descriptive slugs. */
export function slugsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const ta = new Set(a.split('-').filter((t) => t.length > 2));
  const tb = new Set(b.split('-').filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return false;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  const ratio = common / Math.min(ta.size, tb.size);
  return ratio >= 0.6;
}

/**
 * Decide whether a candidate Activity URL is acceptable for this Share URL.
 * High-trust strategies (the page's own canonical/og/current URL) are accepted
 * outright. Anchor-scraping strategies must additionally pass slug matching when
 * a share slug is available, to avoid returning a recommendation/nearby post.
 */
function confirmCandidate(
  strategyName: string,
  candidate: string,
  shareSlug: string | null,
): boolean {
  if (!isAcceptableActivityUrl(candidate)) return false;
  if (HIGH_TRUST_STRATEGIES.has(strategyName)) return true;
  if (shareSlug == null) {
    // Can't confirm; only trust scoped main-container anchors (the timestamp
    // strategy already scopes to main/article).
    return strategyName === 'timestamp-anchor';
  }
  return slugsMatch(shareSlug, descriptiveSlug(candidate));
}

/** Build the StrategyContext bound to a live Playwright page. */
function makeStrategyContext(page: Page): StrategyContext {
  return {
    currentUrl: () => page.url(),
    async queryAttribute(selector, attribute) {
      try {
        const loc = page.locator(selector).first();
        if ((await loc.count()) === 0) return null;
        return await loc.getAttribute(attribute, { timeout: 2_000 });
      } catch {
        return null;
      }
    },
    async queryAllHrefs(selector) {
      try {
        return await page.locator(selector).evaluateAll((els) =>
          els
            .map((el) => {
              const anchor = el as unknown as { href?: string; getAttribute(name: string): string | null };
              return anchor.href || anchor.getAttribute('href') || '';
            })
            .filter((h) => h.length > 0),
        );
      } catch {
        return [];
      }
    },
    async getHtml() {
      try {
        return await page.content();
      } catch {
        return '';
      }
    },
  };
}

/** Read the visible page text + detect a real captcha widget, for failure diagnosis. */
async function readPageSignals(page: Page): Promise<{ visibleText: string; hasCaptchaWidget: boolean }> {
  let visibleText = '';
  try {
    visibleText = await page.evaluate(() => {
      const body = (globalThis as { document?: { body?: { innerText?: string } } }).document?.body;
      return (body?.innerText ?? '').slice(0, 5_000);
    });
  } catch {
    /* ignore */
  }
  let hasCaptchaWidget = false;
  try {
    const count = await page
      .locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i], #captcha-internal, .challenge-dialog')
      .count();
    hasCaptchaWidget = count > 0;
  } catch {
    /* ignore */
  }
  return { visibleText, hasCaptchaWidget };
}

/** Navigate to the share URL with retries + exponential backoff. */
async function navigateWithRetries(
  page: Page,
  shareUrl: string,
  cfg: AppConfig,
  requestId: string,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      await page.goto(shareUrl, { waitUntil: 'domcontentloaded', timeout: cfg.pageTimeoutMs });
      // Best-effort settle; ignore timeout — content may already be present.
      await page
        .waitForLoadState('networkidle', { timeout: Math.min(8_000, cfg.pageTimeoutMs) })
        .catch(() => undefined);
      return;
    } catch (err) {
      lastErr = err;
      logger.warn('Navigation attempt failed', {
        requestId,
        attempt,
        maxAttempts: cfg.maxAttempts,
        err: String(err),
      });
      if (attempt < cfg.maxAttempts) {
        const backoff = cfg.backoffBaseMs * 2 ** (attempt - 1);
        await delay(backoff);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('navigation failed');
}

/** A single end-to-end attempt within one browser context (auth or not). */
async function attemptInContext(
  context: BrowserContext,
  shareUrl: string,
  shareSlug: string | null,
  usedAuth: boolean,
  opts: ResolveOptions,
): Promise<ResolverOutcome> {
  const { config: cfg, requestId } = opts;
  const page = await context.newPage();
  page.setDefaultTimeout(cfg.pageTimeoutMs);

  try {
    try {
      await navigateWithRetries(page, shareUrl, cfg, requestId);
    } catch (err) {
      const isTimeout = /timeout/i.test(String(err));
      await maybeCaptureDebug(page, cfg, requestId, 'navigation-failed');
      return {
        ok: false,
        usedAuth,
        errorCode: isTimeout ? 'PAGE_TIMEOUT' : 'INTERNAL_ERROR',
        errorMessage: isTimeout
          ? 'Timed out loading the LinkedIn page'
          : `Navigation error: ${String(err)}`,
      };
    }

    // --- Extraction first ---------------------------------------------------
    // Run strategies in order; each returns zero or more candidates. The first
    // candidate that is acceptable AND confirmed (slug match for non-high-trust
    // strategies) wins. Extraction precedes state classification so a successful
    // resolution can never be blocked by a false-positive auth/captcha signal.
    const ctx = makeStrategyContext(page);
    for (const strategy of strategies) {
      let candidates: string[] = [];
      try {
        candidates = await strategy.extract(ctx);
      } catch (err) {
        logger.warn('Strategy threw', { requestId, strategy: strategy.name, err: String(err) });
        continue;
      }

      for (const candidate of candidates) {
        if (!candidate) continue;
        if (!confirmCandidate(strategy.name, candidate, shareSlug)) continue;

        const normalized = normalizeActivityUrl(candidate);
        if (!normalized) continue;
        const activityId = extractActivityId(normalized);
        if (!activityId) continue;

        logger.info('Resolved activity URL', {
          requestId,
          strategy: strategy.name,
          usedAuth,
          activityId,
        });
        return {
          ok: true,
          activityUrl: normalized,
          activityId,
          strategy: strategy.name,
          usedAuth,
        };
      }
    }

    // --- Nothing matched: classify WHY (failure diagnosis only) -------------
    const finalUrl = page.url();
    const { visibleText, hasCaptchaWidget } = await readPageSignals(page);
    let state: PageState = classifyPageState({ finalUrl, visibleText, hasCaptchaWidget });
    state = adjustForAuthAttempt(state, usedAuth);
    if (state.blocked) {
      await maybeCaptureDebug(page, cfg, requestId, state.errorCode ?? 'blocked');
      return {
        ok: false,
        usedAuth,
        errorCode: state.errorCode,
        errorMessage: state.reason ?? 'LinkedIn blocked the request',
      };
    }

    await maybeCaptureDebug(page, cfg, requestId, 'activity-not-found');
    return {
      ok: false,
      usedAuth,
      errorCode: 'ACTIVITY_URL_NOT_FOUND',
      errorMessage: 'Could not find a matching Activity permalink on the page',
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Public entry point. Tries unauthenticated first; if that fails in a way that
 * authentication could fix and cookies are available, retries authenticated.
 */
export async function resolveShareUrl(
  shareUrl: string,
  opts: ResolveOptions,
): Promise<ResolverOutcome> {
  const shareSlug = descriptiveSlug(shareUrl);

  // Attempt 1: unauthenticated.
  const anon = await withContext({}, (context) =>
    attemptInContext(context, shareUrl, shareSlug, false, opts),
  );
  if (anon.ok) return anon;

  // Decide whether an authenticated retry is worthwhile. A logged-in session
  // commonly bypasses the auth wall / bot-check / captcha that LinkedIn serves
  // to anonymous traffic, so all of those are worth retrying with cookies.
  const authMightHelp =
    anon.errorCode === 'LOGIN_REQUIRED' ||
    anon.errorCode === 'ACTIVITY_URL_NOT_FOUND' ||
    anon.errorCode === 'SECURITY_CHALLENGE' ||
    anon.errorCode === 'CAPTCHA_DETECTED';

  if (!opts.cookies.available || !authMightHelp) {
    return anon;
  }

  logger.info('Retrying with authenticated session', {
    requestId: opts.requestId,
    firstErrorCode: anon.errorCode,
  });

  const authed = await withContext({ cookies: opts.cookies.cookies }, (context) =>
    attemptInContext(context, shareUrl, shareSlug, true, opts),
  );

  // Prefer the authenticated outcome; if it also failed, return whichever is
  // more informative (authed reflects the cookie state, e.g. SESSION_EXPIRED).
  return authed;
}

/**
 * Capture a screenshot + page HTML to an ephemeral debug folder when enabled.
 * Never writes cookies, tokens, or request headers.
 */
async function maybeCaptureDebug(
  page: Page,
  cfg: AppConfig,
  requestId: string,
  label: string,
): Promise<void> {
  if (!cfg.enableDebugArtifacts) return;
  try {
    await fs.mkdir(cfg.debugDir, { recursive: true });
    const safeLabel = label.replace(/[^a-z0-9_-]/gi, '_');
    const base = path.join(cfg.debugDir, `${requestId}-${safeLabel}`);
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => undefined);
    const html = await page.content().catch(() => '');
    if (html) await fs.writeFile(`${base}.html`, html, 'utf8');
    logger.info('Captured debug artifacts', { requestId, label, dir: cfg.debugDir });
  } catch (err) {
    logger.warn('Failed to capture debug artifacts', { requestId, err: String(err) });
  }
}
