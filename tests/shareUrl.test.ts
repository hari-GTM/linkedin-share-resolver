import { describe, it, expect } from 'vitest';
import {
  validateShareUrl,
  isLinkedInHost,
  hasShareMarker,
  looksLikeActivity,
  looksLikeUgcPost,
} from '../src/validation/shareUrl';

const VALID_SHARE =
  'https://www.linkedin.com/posts/were-headed-to-london-were-excited-share-7472364428009680896-yWay';
const ACTIVITY_URL =
  'https://www.linkedin.com/posts/goodera_were-headed-to-london-were-excited-activity-7472415145487421441-UGd2/';
const UGC_URL = 'https://www.linkedin.com/feed/update/urn:li:ugcPost:7472415145487421441/';

describe('isLinkedInHost', () => {
  it('accepts linkedin.com and subdomains', () => {
    expect(isLinkedInHost('www.linkedin.com')).toBe(true);
    expect(isLinkedInHost('linkedin.com')).toBe(true);
    expect(isLinkedInHost('in.linkedin.com')).toBe(true);
  });
  it('rejects look-alike and other domains', () => {
    expect(isLinkedInHost('linkedin.com.evil.com')).toBe(false);
    expect(isLinkedInHost('notlinkedin.com')).toBe(false);
    expect(isLinkedInHost('example.com')).toBe(false);
  });
});

describe('marker helpers', () => {
  it('detects share markers', () => {
    expect(hasShareMarker(VALID_SHARE)).toBe(true);
    expect(hasShareMarker('https://x/feed/update/urn:li:share:123')).toBe(true);
    expect(hasShareMarker(ACTIVITY_URL)).toBe(false);
  });
  it('detects activity markers', () => {
    expect(looksLikeActivity(ACTIVITY_URL)).toBe(true);
    expect(looksLikeActivity(VALID_SHARE)).toBe(false);
  });
  it('detects ugc markers', () => {
    expect(looksLikeUgcPost(UGC_URL)).toBe(true);
    expect(looksLikeUgcPost(VALID_SHARE)).toBe(false);
  });
});

describe('validateShareUrl', () => {
  it('accepts a valid Share URL', () => {
    const r = validateShareUrl(VALID_SHARE);
    expect(r.valid).toBe(true);
    expect(r.normalizedInput).toBe(VALID_SHARE);
  });

  it('accepts a urn:li:share: style URL', () => {
    const r = validateShareUrl('https://www.linkedin.com/feed/update/urn:li:share:7472364428009680896');
    expect(r.valid).toBe(true);
  });

  it('rejects a non-LinkedIn URL (wrong domain)', () => {
    const r = validateShareUrl('https://example.com/posts/foo-share-123-abcd');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/linkedin\.com/i);
  });

  it('rejects a look-alike domain', () => {
    const r = validateShareUrl('https://www.linkedin.com.evil.com/posts/foo-share-123-abcd');
    expect(r.valid).toBe(false);
  });

  it('rejects an Activity URL passed as input', () => {
    const r = validateShareUrl(ACTIVITY_URL);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/activity/i);
  });

  it('rejects a UGC Post URL passed as input', () => {
    const r = validateShareUrl(UGC_URL);
    expect(r.valid).toBe(false);
  });

  it('rejects a LinkedIn URL without any share marker', () => {
    const r = validateShareUrl('https://www.linkedin.com/in/some-person');
    expect(r.valid).toBe(false);
  });

  it('rejects non-string and empty inputs', () => {
    expect(validateShareUrl(undefined).valid).toBe(false);
    expect(validateShareUrl('').valid).toBe(false);
    expect(validateShareUrl(123 as unknown).valid).toBe(false);
  });

  it('rejects non-http(s) protocols', () => {
    const r = validateShareUrl('ftp://www.linkedin.com/posts/foo-share-123-abcd');
    expect(r.valid).toBe(false);
  });

  it('rejects a garbage string', () => {
    expect(validateShareUrl('not a url').valid).toBe(false);
  });
});
