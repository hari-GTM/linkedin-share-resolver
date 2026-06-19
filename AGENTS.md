# AGENTS.md — guidance for AI assistants and contributors working in this repo

## What this is

`linkedin-share-resolver` is an Express + TypeScript + Playwright service that
takes a LinkedIn **Share** post URL and returns the corresponding public
**Activity** permalink + numeric Activity ID. It is called by Clay via an HTTP
API enrichment and runs on Google Cloud Run.

## Golden rules

- **Never derive the Activity ID from the Share ID.** They are different numbers.
  The Activity URL must always be read from the live page.
- **Never log, return, commit, or write cookies/secrets.** `LINKEDIN_COOKIES` and
  `RESOLVER_API_KEY` are sensitive. The logger redacts known sensitive keys; keep
  it that way. Debug artifacts must contain only page screenshot + HTML, never
  headers/cookies/tokens.
- **Keep the JSON response contract stable** (`status`, `share_url`,
  `activity_url`, `activity_id`, `resolved_at`, and on failure `error_code` +
  `error_message`). Clay maps these columns directly.
- **Error codes are a contract.** Only use the codes in `src/types/index.ts`.

## Architecture

```
src/
  server.ts                 process entry: listen + graceful shutdown + browser warm-up
  app.ts                    express wiring, outcome -> HTTP mapping, concurrency guard
  config.ts                 env-var config singleton
  logger.ts                 structured JSON logs with secret redaction
  resolver/
    resolveShareUrl.ts      orchestration: retries, backoff, auth fallback, matching, debug
    strategies.ts           ordered, isolated extraction strategies (UPDATE SELECTORS HERE)
    normalizeUrl.ts         acceptance + canonical normalization + activity-id extraction
    detectLinkedInState.ts  classify auth-wall / checkpoint / captcha (pure, testable)
  browser/
    createBrowser.ts        shared Chromium, per-request context, graceful close
    loadCookies.ts          parse Playwright cookies from LINKEDIN_COOKIES
  middleware/
    apiKey.ts               X-API-Key check (constant-time)
    errorHandler.ts         malformed JSON / payload-too-large / catch-all
  validation/
    shareUrl.ts             accept only linkedin.com + (-share- | urn:li:share:)
  types/index.ts            shared types + ErrorCode + ResolverError
```

## When LinkedIn changes its DOM

Selector drift is the most likely cause of `ACTIVITY_URL_NOT_FOUND`. Each
strategy in `src/resolver/strategies.ts` is isolated and ordered — update or add
strategies there. Do **not** collapse them into one hardcoded selector. Prefer
selectors scoped to the main post container (`main`, `article`) before page-wide
fallbacks, and keep the slug-confirmation in `resolveShareUrl.ts` so nearby /
recommended posts are not returned.

## Conventions

- CommonJS output (`tsconfig` `module: CommonJS`) so `node dist/server.js` runs
  cleanly in Docker — relative imports stay extensionless.
- Pure logic (validation, normalization, state detection, slug matching) must
  stay browser-free and unit-tested in `tests/`.
- Live browser tests live in `tests/live/` and are excluded from `npm test`.

## Commands

```bash
npm test           # fast suite (no browser/network)
npm run typecheck  # tsc --noEmit
npm run build      # compile to dist/
npm start          # run built server
npm run dev        # hot-reload dev
npm run test:live  # real-LinkedIn integration (slow, optional)
```

## Versioning gotcha

The `playwright` npm version **must** match the Docker base image tag
(`mcr.microsoft.com/playwright:vX.Y.Z-noble`). Currently pinned to `1.61.0`.
Bump both together.
