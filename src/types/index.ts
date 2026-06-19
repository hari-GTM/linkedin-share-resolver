// Shared types for the LinkedIn Share -> Activity resolver service.

/** Error codes returned to the caller. Stable contract for Clay. */
export type ErrorCode =
  | 'INVALID_SHARE_URL'
  | 'UNAUTHORIZED'
  | 'LOGIN_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'SECURITY_CHALLENGE'
  | 'CAPTCHA_DETECTED'
  | 'ACTIVITY_URL_NOT_FOUND'
  | 'PAGE_TIMEOUT'
  | 'INTERNAL_ERROR';

export type ResolveStatus = 'resolved' | 'failed';

/** Successful resolution payload returned to the client. */
export interface ResolveSuccess {
  status: 'resolved';
  share_url: string;
  activity_url: string;
  activity_id: string;
  resolved_at: string;
}

/** Failure payload returned to the client. */
export interface ResolveFailure {
  status: 'failed';
  share_url: string;
  activity_url: null;
  activity_id: null;
  error_code: ErrorCode;
  error_message: string;
  resolved_at: string;
}

export type ResolveResponse = ResolveSuccess | ResolveFailure;

/**
 * Internal result of the resolver core (browser layer).
 * The HTTP layer maps this into ResolveResponse.
 */
export interface ResolverOutcome {
  ok: boolean;
  activityUrl?: string;
  activityId?: string;
  /** Which strategy produced the accepted result (for logs/debugging). */
  strategy?: string;
  /** Whether the authenticated (cookie) session was used. */
  usedAuth?: boolean;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

/**
 * A resolver strategy: given a Playwright page, return ZERO OR MORE candidate
 * Activity URLs. The caller confirms each candidate (acceptance + slug match)
 * and picks the first that fits the supplied Share URL. Returning several
 * candidates lets the caller skip recommendation/nearby-post links.
 * Strategies must NOT throw for "not found" — only for genuine errors.
 */
export interface Strategy {
  name: string;
  extract: (ctx: StrategyContext) => Promise<string[]>;
}

/** Minimal surface of a Playwright Page the strategies depend on. */
export interface StrategyContext {
  /** Current page URL (after any redirects). */
  currentUrl: () => string;
  /** Evaluate a DOM query and return a single matching attribute value. */
  queryAttribute: (selector: string, attribute: string) => Promise<string | null>;
  /** Collect href values for all anchors matching a selector. */
  queryAllHrefs: (selector: string) => Promise<string[]>;
  /** Full page HTML (page.content()), for strategies that scan embedded JSON. */
  getHtml: () => Promise<string>;
}

/** Custom error carrying a stable ErrorCode for the HTTP layer. */
export class ResolverError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ResolverError';
    this.code = code;
  }
}
