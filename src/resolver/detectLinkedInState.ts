// Detect LinkedIn auth-wall / challenge / captcha states so the resolver can
// return a precise ErrorCode when extraction fails.
//
// IMPORTANT: this runs ONLY when no Activity URL could be extracted — it explains
// failures, it does not gate success. It is also deliberately conservative:
// classification is driven primarily by the FINAL URL (LinkedIn redirects to
// /authwall, /checkpoint, /login when it blocks) and by VISIBLE page text, never
// by raw HTML — LinkedIn's JS bundles contain words like "captcha" that would
// otherwise cause false positives on perfectly good post pages.

import type { ErrorCode } from '../types';

export interface PageState {
  /** A blocking state was detected. */
  blocked: boolean;
  errorCode?: ErrorCode;
  reason?: string;
}

export interface ClassifyInput {
  finalUrl: string;
  /** Visible page text (document.body.innerText), NOT raw HTML. */
  visibleText: string;
  /** True if a real captcha widget element was found in the DOM. */
  hasCaptchaWidget?: boolean;
}

export function classifyPageState(input: ClassifyInput): PageState {
  const url = (input.finalUrl || '').toLowerCase();
  const text = (input.visibleText || '').toLowerCase();

  // --- CAPTCHA -------------------------------------------------------------
  // Only when a real widget is present, or the URL is a challenge page with
  // captcha wording, or the VISIBLE text uses an unambiguous captcha phrase.
  if (
    input.hasCaptchaWidget ||
    (url.includes('/checkpoint/') &&
      (text.includes('captcha') || text.includes('are you a human') || text.includes('solve this puzzle'))) ||
    text.includes('complete the captcha') ||
    text.includes('complete this captcha') ||
    text.includes('enter the characters you see')
  ) {
    return { blocked: true, errorCode: 'CAPTCHA_DETECTED', reason: 'captcha challenge detected' };
  }

  // --- SECURITY CHALLENGE / CHECKPOINT ------------------------------------
  if (
    url.includes('/checkpoint/') ||
    url.includes('/uas/consumer') ||
    text.includes('security verification') ||
    text.includes('verify your identity') ||
    text.includes('quick security check') ||
    text.includes("let's do a quick security check")
  ) {
    return { blocked: true, errorCode: 'SECURITY_CHALLENGE', reason: 'security checkpoint detected' };
  }

  // --- LOGIN REQUIRED / AUTH WALL -----------------------------------------
  if (
    url.includes('/authwall') ||
    url.includes('/login') ||
    url.includes('/uas/login') ||
    url.includes('session_redirect') ||
    url.includes('linkedin.com/signup') ||
    text.includes('sign in to continue') ||
    text.includes('sign in to view') ||
    text.includes('join linkedin to see') ||
    text.includes('sign in to see this')
  ) {
    return { blocked: true, errorCode: 'LOGIN_REQUIRED', reason: 'authentication wall detected' };
  }

  return { blocked: false };
}

/**
 * When we navigated WITH cookies but still landed on a login/checkpoint page,
 * the session is stale. Upgrade LOGIN_REQUIRED -> SESSION_EXPIRED.
 */
export function adjustForAuthAttempt(state: PageState, usedAuth: boolean): PageState {
  if (usedAuth && state.blocked && state.errorCode === 'LOGIN_REQUIRED') {
    return { ...state, errorCode: 'SESSION_EXPIRED', reason: 'authenticated session rejected (expired cookies)' };
  }
  return state;
}
