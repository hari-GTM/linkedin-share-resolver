// Input validation for incoming Share URLs.
//
// Accept ONLY LinkedIn URLs that look like a Share post:
//   - host within linkedin.com
//   - contains "-share-"  OR  "urn:li:share:"
// Reject Activity URLs, UGC Post URLs, and non-LinkedIn URLs.

export interface ShareUrlValidation {
  valid: boolean;
  reason?: string;
  /** The trimmed/parsed URL when valid. */
  normalizedInput?: string;
}

const LINKEDIN_HOST_SUFFIX = 'linkedin.com';

/** True when host is linkedin.com or any subdomain of it. */
export function isLinkedInHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return h === LINKEDIN_HOST_SUFFIX || h.endsWith('.' + LINKEDIN_HOST_SUFFIX);
}

/** Does the raw URL string carry a Share marker? */
export function hasShareMarker(raw: string): boolean {
  const lower = raw.toLowerCase();
  return lower.includes('-share-') || lower.includes('urn:li:share:');
}

/** Does the raw URL string look like an Activity permalink? */
export function looksLikeActivity(raw: string): boolean {
  const lower = raw.toLowerCase();
  return lower.includes('-activity-') || lower.includes('urn:li:activity:');
}

/** Does the raw URL string look like a UGC post? */
export function looksLikeUgcPost(raw: string): boolean {
  const lower = raw.toLowerCase();
  return lower.includes('-ugcpost-') || lower.includes('urn:li:ugcpost:');
}

export function validateShareUrl(input: unknown): ShareUrlValidation {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { valid: false, reason: 'share_url must be a non-empty string' };
  }

  const raw = input.trim();

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, reason: 'share_url is not a valid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'share_url must use http or https' };
  }

  if (!isLinkedInHost(parsed.hostname)) {
    return { valid: false, reason: 'share_url must belong to linkedin.com' };
  }

  // Must carry a share marker.
  if (!hasShareMarker(raw)) {
    // Give a more specific reason when the caller sent an Activity/UGC URL.
    if (looksLikeActivity(raw)) {
      return { valid: false, reason: 'share_url is already an Activity URL, not a Share URL' };
    }
    if (looksLikeUgcPost(raw)) {
      return { valid: false, reason: 'share_url is a UGC Post URL, not a Share URL' };
    }
    return {
      valid: false,
      reason: 'share_url must contain "-share-" or "urn:li:share:"',
    };
  }

  // A URL can technically carry both markers; treat an explicit activity slug as
  // a rejection because we only resolve genuine Share URLs.
  if (looksLikeActivity(raw)) {
    return { valid: false, reason: 'share_url must not also be an Activity URL' };
  }

  return { valid: true, normalizedInput: raw };
}
