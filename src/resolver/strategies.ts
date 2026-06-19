// Resolver strategies. Each strategy is an isolated, independently-updatable
// attempt to surface candidate Activity URLs from a loaded page. They run in a
// fixed priority order and each returns ZERO OR MORE candidates; the caller
// (resolveShareUrl) confirms acceptance + slug match and picks the right one.
//
// None of them throw on "not found" — they return an empty array.

import type { Strategy, StrategyContext } from '../types';
import { looksLikeActivity } from '../validation/shareUrl';

/** Matches a full LinkedIn /posts/...-activity-<id>... permalink in raw text. */
const POSTS_ACTIVITY_URL_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)*linkedin\.com\/posts\/[^"'<>\\\s)]*-activity-\d+[^"'<>\\\s)]*/gi;

/** 1. The browser's current URL after any redirect. */
const currentUrlStrategy: Strategy = {
  name: 'current-url',
  async extract(ctx: StrategyContext) {
    const url = ctx.currentUrl();
    return looksLikeActivity(url) ? [url] : [];
  },
};

/** 2. <link rel="canonical" href="..."> */
const canonicalStrategy: Strategy = {
  name: 'canonical-link',
  async extract(ctx: StrategyContext) {
    const href = await ctx.queryAttribute('link[rel="canonical"]', 'href');
    return href && looksLikeActivity(href) ? [href] : [];
  },
};

/** 3. <meta property="og:url" content="..."> */
const ogUrlStrategy: Strategy = {
  name: 'og-url-meta',
  async extract(ctx: StrategyContext) {
    const content = await ctx.queryAttribute('meta[property="og:url"]', 'content');
    return content && looksLikeActivity(content) ? [content] : [];
  },
};

/**
 * 4. Timestamp / publication-date anchor inside the main post container.
 * LinkedIn renders the post's relative time as a link to the activity permalink.
 */
const timestampAnchorStrategy: Strategy = {
  name: 'timestamp-anchor',
  async extract(ctx: StrategyContext) {
    const selectors = [
      'main a.app-aware-link[href*="-activity-"]',
      'article a[href*="-activity-"]',
      'a.update-components-actor__sub-description-link[href*="-activity-"]',
      'a.feed-shared-actor__sub-description-link[href*="-activity-"]',
      'time[datetime] ~ a[href*="-activity-"]',
      'a[aria-label][href*="-activity-"]',
    ];
    const out: string[] = [];
    for (const sel of selectors) {
      const hrefs = await ctx.queryAllHrefs(sel);
      for (const h of hrefs) {
        if (looksLikeActivity(h) && h.includes('/posts/')) out.push(h);
      }
    }
    return out;
  },
};

/** 5. Any anchor containing both "/posts/" and "-activity-" (scoped first). */
const postsActivityAnchorStrategy: Strategy = {
  name: 'posts-activity-anchor',
  async extract(ctx: StrategyContext) {
    const scoped = await ctx.queryAllHrefs('main a[href*="/posts/"], article a[href*="/posts/"]');
    const all = await ctx.queryAllHrefs('a[href*="/posts/"]');
    return [...scoped, ...all].filter((h) => h.includes('/posts/') && h.includes('-activity-'));
  },
};

/**
 * 6. The permalink embedded in the page HTML/JSON. LinkedIn's authenticated
 * single-post view often exposes the canonical /posts/...-activity-... URL only
 * inside the serialized page data — not as an anchor or canonical tag. We regex
 * the full HTML for it. Multiple matches (incl. nearby/recommended posts) are
 * returned; the caller's slug confirmation selects the correct one.
 */
const htmlPermalinkStrategy: Strategy = {
  name: 'html-permalink',
  async extract(ctx: StrategyContext) {
    const html = await ctx.getHtml();
    if (!html) return [];
    const matches = html.match(POSTS_ACTIVITY_URL_RE) ?? [];
    // De-duplicate while preserving order.
    return [...new Set(matches)];
  },
};

/**
 * Ordered strategy chain. DOM-precise strategies come first; the HTML regex is a
 * strong fallback for the authenticated single-post view.
 */
export const strategies: Strategy[] = [
  currentUrlStrategy,
  canonicalStrategy,
  ogUrlStrategy,
  timestampAnchorStrategy,
  postsActivityAnchorStrategy,
  htmlPermalinkStrategy,
];
