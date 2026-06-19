// Express application wiring: routes, middleware, and outcome -> HTTP mapping.

import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { config } from './config';
import { logger } from './logger';
import { requireApiKey } from './middleware/apiKey';
import { errorHandler } from './middleware/errorHandler';
import { validateShareUrl } from './validation/shareUrl';
import { loadCookies } from './browser/loadCookies';
import { resolveShareUrl } from './resolver/resolveShareUrl';
import type { ErrorCode, ResolveFailure, ResolveSuccess } from './types';

// Cookies are parsed once at startup (never logged). Re-read lazily so tests can
// override env before first call.
let cookiesCache: ReturnType<typeof loadCookies> | null = null;
function getCookies() {
  if (!cookiesCache) cookiesCache = loadCookies(config.linkedInCookiesRaw);
  return cookiesCache;
}

/** Map an internal ErrorCode to an HTTP status code. */
function statusForError(code: ErrorCode): number {
  switch (code) {
    case 'INVALID_SHARE_URL':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'LOGIN_REQUIRED':
    case 'SESSION_EXPIRED':
    case 'SECURITY_CHALLENGE':
    case 'CAPTCHA_DETECTED':
      return 502; // upstream (LinkedIn) blocked us
    case 'ACTIVITY_URL_NOT_FOUND':
      return 404;
    case 'PAGE_TIMEOUT':
      return 504;
    case 'INTERNAL_ERROR':
    default:
      return 500;
  }
}

// ---- Single-flight concurrency guard ---------------------------------------
// Keep browser concurrency low. Cloud Run runs with concurrency=1, but this
// guard protects local/dev runs and any accidental parallelism.
const MAX_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.MAX_BROWSER_CONCURRENCY ?? '1', 10) || 1,
);
let active = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) {
    active++;
    next();
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Body parser with a strict size limit.
  app.use(express.json({ limit: config.bodyLimit }));

  // GET /health — liveness probe (no auth).
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // POST /resolve — the main endpoint (requires X-API-Key).
  app.post('/resolve', requireApiKey, async (req: Request, res: Response) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const shareUrlInput = (req.body as Record<string, unknown>)?.share_url;

    // Validate input.
    const validation = validateShareUrl(shareUrlInput);
    if (!validation.valid) {
      const body: ResolveFailure = {
        status: 'failed',
        share_url: typeof shareUrlInput === 'string' ? shareUrlInput : (null as unknown as string),
        activity_url: null,
        activity_id: null,
        error_code: 'INVALID_SHARE_URL',
        error_message: validation.reason ?? 'Invalid share_url',
        resolved_at: new Date().toISOString(),
      };
      logger.info('Rejected invalid share_url', { requestId, reason: validation.reason });
      res.status(statusForError('INVALID_SHARE_URL')).json(body);
      return;
    }

    const shareUrl = validation.normalizedInput as string;
    logger.info('Resolve request received', { requestId });

    await acquire();
    try {
      const outcome = await resolveShareUrl(shareUrl, {
        config,
        cookies: getCookies(),
        requestId,
      });

      if (outcome.ok) {
        const body: ResolveSuccess = {
          status: 'resolved',
          share_url: shareUrl,
          activity_url: outcome.activityUrl as string,
          activity_id: outcome.activityId as string,
          resolved_at: new Date().toISOString(),
        };
        logger.info('Resolve request succeeded', {
          requestId,
          ms: Date.now() - startedAt,
          strategy: outcome.strategy,
          usedAuth: outcome.usedAuth,
        });
        res.status(200).json(body);
        return;
      }

      const code = outcome.errorCode ?? 'INTERNAL_ERROR';
      const body: ResolveFailure = {
        status: 'failed',
        share_url: shareUrl,
        activity_url: null,
        activity_id: null,
        error_code: code,
        error_message: outcome.errorMessage ?? 'Resolution failed',
        resolved_at: new Date().toISOString(),
      };
      logger.info('Resolve request failed', {
        requestId,
        ms: Date.now() - startedAt,
        errorCode: code,
      });
      res.status(statusForError(code)).json(body);
    } catch (err) {
      logger.error('Unexpected resolver error', { requestId, err: String(err) });
      const body: ResolveFailure = {
        status: 'failed',
        share_url: shareUrl,
        activity_url: null,
        activity_id: null,
        error_code: 'INTERNAL_ERROR',
        error_message: 'Internal server error',
        resolved_at: new Date().toISOString(),
      };
      res.status(500).json(body);
    } finally {
      release();
    }
  });

  // 404 for anything else.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ status: 'failed', error_code: 'INVALID_SHARE_URL', error_message: 'Not found' });
  });

  // Centralized error handler (must be last).
  app.use(errorHandler);

  return app;
}
