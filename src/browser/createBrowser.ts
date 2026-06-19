// Browser lifecycle management. A single shared Chromium instance is launched
// lazily and reused across requests; each request gets its OWN context (cookie
// jar + page) which is closed afterward. This keeps concurrency low and memory
// bounded — appropriate for Cloud Run with concurrency=1.

import { chromium, type Browser, type BrowserContext } from 'playwright';
import { logger } from '../logger';

let browserPromise: Promise<Browser> | null = null;

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
];

/** Launch (once) and return the shared browser instance. */
export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    logger.info('Launching Chromium');
    browserPromise = chromium.launch({ headless: true, args: LAUNCH_ARGS }).catch((err) => {
      // Reset so a later request can retry the launch.
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export interface NewContextOptions {
  /** Playwright cookies to seed into the context (authenticated session). */
  cookies?: import('playwright').Cookie[];
}

/**
 * Create a fresh, isolated browser context for a single request.
 * Caller is responsible for closing it (see withContext for a safe wrapper).
 */
export async function createContext(opts: NewContextOptions = {}): Promise<BrowserContext> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  });
  if (opts.cookies && opts.cookies.length > 0) {
    await context.addCookies(opts.cookies);
  }
  return context;
}

/**
 * Run `fn` with a fresh context that is always closed afterward, even on error.
 */
export async function withContext<T>(
  opts: NewContextOptions,
  fn: (ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  const context = await createContext(opts);
  try {
    return await fn(context);
  } finally {
    await context.close().catch((err) => logger.warn('Failed to close context', { err: String(err) }));
  }
}

/** Gracefully close the shared browser (called on shutdown). */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
    logger.info('Chromium closed');
  } catch (err) {
    logger.warn('Error while closing Chromium', { err: String(err) });
  } finally {
    browserPromise = null;
  }
}
