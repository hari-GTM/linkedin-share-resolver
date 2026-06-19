// Central configuration loaded from environment variables.
// Cloud Run injects secrets as env vars (PORT, RESOLVER_API_KEY, LINKEDIN_COOKIES, ...).

import path from 'node:path';
import os from 'node:os';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export interface AppConfig {
  port: number;
  apiKey: string;
  /** Raw cookies blob (Playwright-compatible JSON). Never logged. */
  linkedInCookiesRaw: string;
  pageTimeoutMs: number;
  enableDebugArtifacts: boolean;
  logLevel: string;
  /** Max accepted request body size. */
  bodyLimit: string;
  /** Number of resolve attempts within a single request (browser navigations). */
  maxAttempts: number;
  /** Base backoff delay (ms) between attempts; grows exponentially. */
  backoffBaseMs: number;
  /** Directory for debug artifacts (ephemeral; Cloud Run tmpfs). */
  debugDir: string;
}

export function loadConfig(): AppConfig {
  return {
    port: intFromEnv('PORT', 8080),
    apiKey: process.env.RESOLVER_API_KEY ?? '',
    linkedInCookiesRaw: process.env.LINKEDIN_COOKIES ?? '',
    pageTimeoutMs: intFromEnv('PAGE_TIMEOUT_MS', 45_000),
    enableDebugArtifacts: boolFromEnv('ENABLE_DEBUG_ARTIFACTS', false),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    bodyLimit: process.env.BODY_LIMIT ?? '16kb',
    maxAttempts: intFromEnv('MAX_ATTEMPTS', 2),
    backoffBaseMs: intFromEnv('BACKOFF_BASE_MS', 500),
    debugDir: process.env.DEBUG_DIR ?? path.join(os.tmpdir(), 'lsr-debug'),
  };
}

// A single shared instance for the running process.
export const config = loadConfig();
