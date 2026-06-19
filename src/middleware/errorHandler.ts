// Centralized error handling: malformed JSON, payload-too-large, and any
// uncaught error are turned into the structured failure response shape.

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';
import type { ResolveFailure } from '../types';

interface HttpishError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

function failure(shareUrl: unknown, code: ResolveFailure['error_code'], message: string): ResolveFailure {
  return {
    status: 'failed',
    share_url: typeof shareUrl === 'string' ? shareUrl : (null as unknown as string),
    activity_url: null,
    activity_id: null,
    error_code: code,
    error_message: message,
    resolved_at: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: HttpishError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const shareUrl = (req.body && (req.body as Record<string, unknown>).share_url) ?? null;

  // Body too large.
  if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
    logger.warn('Request body too large', { path: req.path });
    res.status(413).json(failure(shareUrl, 'INVALID_SHARE_URL', 'Request body too large'));
    return;
  }

  // Malformed JSON.
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    logger.warn('Malformed JSON body', { path: req.path });
    res.status(400).json(failure(shareUrl, 'INVALID_SHARE_URL', 'Request body is not valid JSON'));
    return;
  }

  logger.error('Unhandled error', { path: req.path, err: String(err?.message ?? err) });
  res.status(500).json(failure(shareUrl, 'INTERNAL_ERROR', 'Internal server error'));
}
