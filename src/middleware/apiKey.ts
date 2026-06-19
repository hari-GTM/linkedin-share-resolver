// API-key authentication middleware. Compares the X-API-Key header against
// RESOLVER_API_KEY using a constant-time comparison.

import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { config } from '../config';

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still run a compare to avoid early-exit timing differences.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // Misconfiguration guard: refuse to run open if no key is configured.
  if (!config.apiKey) {
    res.status(500).json({
      status: 'failed',
      error_code: 'INTERNAL_ERROR',
      error_message: 'Server is missing RESOLVER_API_KEY configuration',
    });
    return;
  }

  const provided = req.header('x-api-key') ?? '';
  if (!provided || !safeEqual(provided, config.apiKey)) {
    res.status(401).json({
      status: 'failed',
      share_url: typeof req.body?.share_url === 'string' ? req.body.share_url : null,
      activity_url: null,
      activity_id: null,
      error_code: 'UNAUTHORIZED',
      error_message: 'Missing or invalid X-API-Key',
      resolved_at: new Date().toISOString(),
    });
    return;
  }

  next();
}
