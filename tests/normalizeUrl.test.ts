import { describe, it, expect } from 'vitest';
import {
  normalizeActivityUrl,
  isAcceptableActivityUrl,
} from '../src/resolver/normalizeUrl';

const CANON =
  'https://www.linkedin.com/posts/goodera_were-headed-to-london-were-excited-activity-7472415145487421441-UGd2/';

describe('isAcceptableActivityUrl', () => {
  it('accepts a well-formed activity permalink', () => {
    expect(isAcceptableActivityUrl(CANON)).toBe(true);
  });
  it('rejects non-linkedin host', () => {
    expect(
      isAcceptableActivityUrl('https://evil.com/posts/x-activity-123-ab/'),
    ).toBe(false);
  });
  it('rejects when /posts/ is missing', () => {
    expect(
      isAcceptableActivityUrl('https://www.linkedin.com/feed/x-activity-123-ab/'),
    ).toBe(false);
  });
  it('rejects when -activity- is missing', () => {
    expect(
      isAcceptableActivityUrl('https://www.linkedin.com/posts/x-share-123-ab/'),
    ).toBe(false);
  });
  it('rejects when no numeric id is present', () => {
    expect(
      isAcceptableActivityUrl('https://www.linkedin.com/posts/x-activity-abc/'),
    ).toBe(false);
  });
});

describe('normalizeActivityUrl', () => {
  it('upgrades scheme to https and host to www.linkedin.com', () => {
    const out = normalizeActivityUrl(
      'http://linkedin.com/posts/goodera_were-headed-activity-7472415145487421441-UGd2/',
    );
    expect(out).toBe(
      'https://www.linkedin.com/posts/goodera_were-headed-activity-7472415145487421441-UGd2/',
    );
  });

  it('removes query parameters', () => {
    const out = normalizeActivityUrl(`${CANON}?utm_source=share&rcm=abc`);
    expect(out).toBe(CANON);
    expect(out).not.toContain('?');
  });

  it('removes fragments', () => {
    const out = normalizeActivityUrl(`${CANON}#comments`);
    expect(out).toBe(CANON);
    expect(out).not.toContain('#');
  });

  it('removes both query and fragment together', () => {
    const out = normalizeActivityUrl(`${CANON}?x=1#y`);
    expect(out).toBe(CANON);
  });

  it('preserves the full permalink slug and suffix', () => {
    const out = normalizeActivityUrl(CANON);
    expect(out).toContain('goodera_were-headed-to-london-were-excited-activity-7472415145487421441-UGd2');
  });

  it('returns null for an unacceptable url', () => {
    expect(normalizeActivityUrl('https://example.com/foo')).toBeNull();
  });

  it('strips a port', () => {
    const out = normalizeActivityUrl(
      'https://www.linkedin.com:443/posts/x-activity-123456789-ab/',
    );
    expect(out).toBe('https://www.linkedin.com/posts/x-activity-123456789-ab/');
  });
});
