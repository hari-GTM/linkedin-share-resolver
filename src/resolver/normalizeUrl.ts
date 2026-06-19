// Normalization + acceptance checks for resolved Activity URLs.

import { isLinkedInHost } from '../validation/shareUrl';

const ACTIVITY_ID_RE = /-activity-(\d+)/i;

/** Extract the numeric Activity ID from an Activity URL, or null. */
export function extractActivityId(url: string): string | null {
  const m = ACTIVITY_ID_RE.exec(url);
  return m ? m[1] : null;
}

/**
 * A candidate is an acceptable Activity URL only when it:
 *  - belongs to LinkedIn
 *  - contains "/posts/"
 *  - contains "-activity-"
 *  - contains a numeric Activity ID
 */
export function isAcceptableActivityUrl(candidate: string): boolean {
  if (!candidate) return false;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (!isLinkedInHost(parsed.hostname)) return false;
  const lowerPath = parsed.pathname.toLowerCase();
  if (!lowerPath.includes('/posts/')) return false;
  if (!lowerPath.includes('-activity-')) return false;
  return extractActivityId(candidate) != null;
}

/**
 * Normalize an accepted Activity URL into the canonical public permalink form:
 *  - https scheme
 *  - www.linkedin.com host
 *  - query parameters removed
 *  - fragment removed
 *  - full permalink slug + suffix preserved
 *  - no trailing slash duplication (single trailing slash preserved if present)
 *
 * Returns null when the candidate cannot be parsed / is not acceptable.
 */
export function normalizeActivityUrl(candidate: string): string | null {
  if (!isAcceptableActivityUrl(candidate)) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  parsed.protocol = 'https:';
  parsed.hostname = 'www.linkedin.com';
  parsed.port = '';
  parsed.search = '';
  parsed.hash = '';

  // Preserve the path exactly (slug + activity suffix). URL keeps the leading
  // slash and any single trailing slash that was present.
  return parsed.toString();
}
