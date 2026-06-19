import { describe, it, expect } from 'vitest';
import { classifyPageState, adjustForAuthAttempt } from '../src/resolver/detectLinkedInState';

describe('classifyPageState', () => {
  it('returns not-blocked for a normal post page', () => {
    const s = classifyPageState({
      finalUrl: 'https://www.linkedin.com/posts/goodera_x-activity-123-ab/',
      visibleText: 'Goodera We are headed to London. Like Comment Repost',
    });
    expect(s.blocked).toBe(false);
  });

  it('does NOT flag a normal page just because raw bundles mention captcha', () => {
    // Regression: full HTML used to contain "recaptcha" in JS bundles and caused
    // false CAPTCHA_DETECTED. Classification now uses visible text only.
    const s = classifyPageState({
      finalUrl: 'https://www.linkedin.com/posts/goodera_x-activity-123-ab/',
      visibleText: 'A normal post with lots of visible words but no challenge',
      hasCaptchaWidget: false,
    });
    expect(s.blocked).toBe(false);
  });

  it('detects an auth wall by URL', () => {
    const s = classifyPageState({
      finalUrl: 'https://www.linkedin.com/authwall?sessionRedirect=x',
      visibleText: '',
    });
    expect(s.blocked).toBe(true);
    expect(s.errorCode).toBe('LOGIN_REQUIRED');
  });

  it('detects login required by visible text', () => {
    const s = classifyPageState({
      finalUrl: 'https://www.linkedin.com/feed/update/x',
      visibleText: 'Please Sign in to continue your session',
    });
    expect(s.blocked).toBe(true);
    expect(s.errorCode).toBe('LOGIN_REQUIRED');
  });

  it('detects a security checkpoint by URL', () => {
    const s = classifyPageState({
      finalUrl: 'https://www.linkedin.com/checkpoint/lg/login-submit',
      visibleText: 'verify your identity',
    });
    expect(s.blocked).toBe(true);
    expect(s.errorCode).toBe('SECURITY_CHALLENGE');
  });

  it('detects a captcha via a real widget', () => {
    const s = classifyPageState({
      finalUrl: 'https://www.linkedin.com/checkpoint/challenge/',
      visibleText: 'are you a human',
      hasCaptchaWidget: true,
    });
    expect(s.blocked).toBe(true);
    expect(s.errorCode).toBe('CAPTCHA_DETECTED');
  });

  it('detects a captcha on a checkpoint page with captcha wording', () => {
    const s = classifyPageState({
      finalUrl: 'https://www.linkedin.com/checkpoint/challenge/verify',
      visibleText: 'Please solve this puzzle to continue',
    });
    expect(s.blocked).toBe(true);
    expect(s.errorCode).toBe('CAPTCHA_DETECTED');
  });
});

describe('adjustForAuthAttempt', () => {
  it('upgrades LOGIN_REQUIRED to SESSION_EXPIRED when auth was used', () => {
    const base = { blocked: true, errorCode: 'LOGIN_REQUIRED' as const, reason: 'x' };
    const out = adjustForAuthAttempt(base, true);
    expect(out.errorCode).toBe('SESSION_EXPIRED');
  });

  it('leaves LOGIN_REQUIRED unchanged when auth was not used', () => {
    const base = { blocked: true, errorCode: 'LOGIN_REQUIRED' as const, reason: 'x' };
    const out = adjustForAuthAttempt(base, false);
    expect(out.errorCode).toBe('LOGIN_REQUIRED');
  });
});
