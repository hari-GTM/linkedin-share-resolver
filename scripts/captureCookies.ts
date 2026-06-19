/**
 * captureCookies.ts — capture a LinkedIn session WITHOUT manual copy/paste.
 *
 * It opens a real (headed) Chromium window. You log into LinkedIn normally in
 * that window. Once you're logged in, the script extracts the session cookies
 * directly from the browser and writes them to `cookies.json` in the exact
 * Playwright-compatible format this service expects.
 *
 * The cookie VALUES are never printed to the terminal. The output file is
 * git-ignored. Upload it to Secret Manager, then delete it (see DEPLOYMENT.md).
 *
 * It launches a real, visible browser. To avoid any dependency on Playwright's
 * downloaded Chromium build, it prefers a browser you already have installed
 * (Microsoft Edge, then Chrome) and only falls back to Playwright's bundled
 * Chromium if neither is available.
 *
 * Usage:
 *   npm run capture:cookies                 # writes ./cookies.json
 *   npm run capture:cookies -- out.json     # custom output path
 *   CAPTURE_CHANNEL=chrome npm run capture:cookies   # force a specific browser
 *   CAPTURE_CHANNEL=chromium npm run capture:cookies # force bundled Chromium
 */

import { chromium, type Browser, type Cookie } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const OUTPUT = path.resolve(process.argv[2] ?? 'cookies.json');
const LOGIN_URL = 'https://www.linkedin.com/login';
const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes to finish logging in
const POLL_MS = 2000;

/**
 * Launch a visible browser, preferring an already-installed system browser.
 * Order: explicit CAPTURE_CHANNEL -> Edge -> Chrome -> Playwright Chromium.
 */
async function launchVisibleBrowser(): Promise<Browser> {
  const forced = process.env.CAPTURE_CHANNEL?.trim().toLowerCase();
  const channels = forced
    ? forced === 'chromium'
      ? []
      : [forced]
    : ['msedge', 'chrome'];

  for (const channel of channels) {
    try {
      const browser = await chromium.launch({ headless: false, channel });
      console.log(`Using system browser: ${channel}`);
      return browser;
    } catch {
      // Not installed / not launchable — try the next option.
    }
  }

  const browser = await chromium.launch({ headless: false });
  console.log('Using Playwright-bundled Chromium');
  return browser;
}

/** A logged-in LinkedIn session always carries the `li_at` auth cookie. */
function isLoggedIn(cookies: Cookie[]): boolean {
  return cookies.some((c) => c.name === 'li_at' && c.value.length > 0 && /linkedin\.com$/i.test(c.domain.replace(/^\./, '')));
}

async function main(): Promise<void> {
  console.log('Opening a browser window. Log into LinkedIn in that window…');
  console.log('(Cookie values are never shown here. This window will close automatically once login is detected.)\n');

  const browser = await launchVisibleBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + MAX_WAIT_MS;
  let cookies: Cookie[] = [];
  let loggedIn = false;

  while (Date.now() < deadline) {
    cookies = await context.cookies();
    if (isLoggedIn(cookies)) {
      loggedIn = true;
      break;
    }
    await page.waitForTimeout(POLL_MS);
  }

  if (!loggedIn) {
    await browser.close();
    console.error('\nTimed out waiting for login. Nothing was written. Re-run and complete login within 5 minutes.');
    process.exit(1);
  }

  // Keep only linkedin.com cookies. Playwright's cookie shape is already exactly
  // what context.addCookies() / this service's loadCookies() accept.
  const linkedInCookies = cookies.filter((c) =>
    /(^|\.)linkedin\.com$/i.test(c.domain.replace(/^\./, '')),
  );

  await fs.writeFile(OUTPUT, JSON.stringify(linkedInCookies, null, 2), 'utf8');
  await browser.close();

  console.log(`\n✔ Captured ${linkedInCookies.length} LinkedIn cookies -> ${OUTPUT}`);
  console.log('  (values intentionally not displayed)\n');
  console.log('Next steps:');
  console.log('  1. Store in Secret Manager:');
  console.log(`       gcloud secrets create LINKEDIN_COOKIES --data-file="${OUTPUT}" --replication-policy=automatic`);
  console.log('     (or add a new version if it already exists:)');
  console.log(`       gcloud secrets versions add LINKEDIN_COOKIES --data-file="${OUTPUT}"`);
  console.log('  2. Delete the local file so cookies are not left on disk:');
  console.log(`       rm "${OUTPUT}"`);
  console.log('  3. Redeploy with --set-secrets "...,LINKEDIN_COOKIES=LINKEDIN_COOKIES:latest"\n');
}

main().catch((err) => {
  console.error('captureCookies failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
