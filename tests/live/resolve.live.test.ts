import { describe, it, expect } from 'vitest';
import { resolveShareUrl } from '../../src/resolver/resolveShareUrl';
import { loadConfig } from '../../src/config';
import { loadCookies } from '../../src/browser/loadCookies';
import { closeBrowser } from '../../src/browser/createBrowser';

// LIVE test — actually drives Chromium against LinkedIn. Excluded from the
// normal `npm test` run (see vitest.live.config.ts). Run with: npm run test:live
//
// It is best-effort: LinkedIn may serve an auth wall to unauthenticated
// traffic, in which case the outcome is a recognized failure code rather than a
// hard assertion failure. Provide LINKEDIN_COOKIES to exercise the auth path.

const SHARE_URL =
  'https://www.linkedin.com/posts/were-headed-to-london-were-excited-share-7472364428009680896-yWay';

describe('live: resolve a real Share URL', () => {
  it('returns either a resolved activity URL or a recognized failure code', async () => {
    const config = loadConfig();
    const cookies = loadCookies(config.linkedInCookiesRaw);

    const outcome = await resolveShareUrl(SHARE_URL, {
      config,
      cookies,
      requestId: 'live-test',
    });

    // eslint-disable-next-line no-console
    console.log('Live outcome:', {
      ok: outcome.ok,
      activityUrl: outcome.activityUrl,
      activityId: outcome.activityId,
      strategy: outcome.strategy,
      usedAuth: outcome.usedAuth,
      errorCode: outcome.errorCode,
    });

    if (outcome.ok) {
      expect(outcome.activityUrl).toMatch(/^https:\/\/www\.linkedin\.com\/posts\/.*-activity-\d+/);
      expect(outcome.activityId).toMatch(/^\d+$/);
    } else {
      expect([
        'LOGIN_REQUIRED',
        'SESSION_EXPIRED',
        'SECURITY_CHALLENGE',
        'CAPTCHA_DETECTED',
        'ACTIVITY_URL_NOT_FOUND',
        'PAGE_TIMEOUT',
      ]).toContain(outcome.errorCode);
    }

    await closeBrowser();
  });
});
