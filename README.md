# linkedin-share-resolver

[![CI](https://github.com/hari-GTM/linkedin-share-resolver/actions/workflows/ci.yml/badge.svg)](https://github.com/hari-GTM/linkedin-share-resolver/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A small API service that resolves a LinkedIn **Share** post URL to its public
**Activity** permalink, so downstream tools (e.g. [Clay](https://clay.com)) that
only accept `activity` / `ugcPost` URLs can extract post reactions.

> ### ⚠️ Responsible use & disclaimer
>
> This project automates a headless browser to read the canonical Activity
> permalink that LinkedIn already exposes for a given post. **Automated access to
> LinkedIn may violate the [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement).**
> That is a contractual (terms-of-service) consideration, not a statement about
> legality, which varies by jurisdiction.
>
> Use this software only:
> - for posts and data you are authorized to access;
> - in volumes that are reasonable and non-disruptive;
> - in compliance with applicable laws and LinkedIn's terms in your jurisdiction.
>
> It is provided **as-is, without warranty**, under the [MIT License](LICENSE).
> You are solely responsible for how you use it. The authors accept no liability
> for misuse or for any consequences of violating a third party's terms of
> service. If in doubt, consult LinkedIn's official APIs or seek legal advice.

LinkedIn sometimes exposes a post as a `share` URL:

```
https://www.linkedin.com/posts/were-headed-to-london-were-excited-share-7472364428009680896-yWay
```

…while the same post has a different **Activity** permalink:

```
https://www.linkedin.com/posts/goodera_were-headed-to-london-were-excited-activity-7472415145487421441-UGd2/
```

The Share ID and Activity ID are **different numbers**, so you cannot simply
replace `share` with `activity`. This service opens the Share URL in a headless
Chromium browser (Playwright) and reads the real Activity permalink from the
loaded page.

---

## API

### `GET /health`

No auth. Liveness probe.

```json
{ "status": "ok" }
```

### `POST /resolve`

Requires header `X-API-Key: <RESOLVER_API_KEY>`.

**Request**

```json
{ "share_url": "https://www.linkedin.com/posts/...-share-7472364428009680896-yWay" }
```

**Success — `200`**

```json
{
  "status": "resolved",
  "share_url": "<original Share URL>",
  "activity_url": "https://www.linkedin.com/posts/...-activity-7472415145487421441-UGd2/",
  "activity_id": "7472415145487421441",
  "resolved_at": "2026-06-18T18:36:00.000Z"
}
```

**Failure — `4xx`/`5xx`**

```json
{
  "status": "failed",
  "share_url": "<original Share URL>",
  "activity_url": null,
  "activity_id": null,
  "error_code": "ACTIVITY_URL_NOT_FOUND",
  "error_message": "Could not find a matching Activity permalink on the page",
  "resolved_at": "2026-06-18T18:36:00.000Z"
}
```

### Error codes → HTTP status

| error_code             | HTTP | Meaning                                              |
| ---------------------- | ---- | ---------------------------------------------------- |
| `INVALID_SHARE_URL`    | 400  | Input is not a valid LinkedIn Share URL              |
| `UNAUTHORIZED`         | 401  | Missing/invalid `X-API-Key`                          |
| `LOGIN_REQUIRED`       | 502  | LinkedIn auth wall; no usable cookies                |
| `SESSION_EXPIRED`      | 502  | Provided cookies were rejected (expired)             |
| `SECURITY_CHALLENGE`   | 502  | LinkedIn checkpoint / identity verification          |
| `CAPTCHA_DETECTED`     | 502  | LinkedIn captcha                                     |
| `ACTIVITY_URL_NOT_FOUND` | 404 | Page loaded but no matching Activity permalink found |
| `PAGE_TIMEOUT`         | 504  | Timed out loading the page                           |
| `INTERNAL_ERROR`       | 500  | Unexpected server error                              |

---

## Input validation

Only accepts URLs that:

1. Belong to `linkedin.com` (or a subdomain), and
2. Contain `-share-` **or** `urn:li:share:`.

Activity URLs, UGC Post URLs, and non-LinkedIn URLs are rejected with
`INVALID_SHARE_URL`. The Activity ID is **never** derived from the Share ID — it
is always read from the live page.

---

## Resolver strategy

The Share URL is opened in Chromium, then these strategies are tried **in order**
(see [`src/resolver/strategies.ts`](src/resolver/strategies.ts)):

1. Current browser URL after redirect
2. `link[rel="canonical"]`
3. `meta[property="og:url"]`
4. Timestamp / publication-date anchor inside the main post container
5. Any anchor containing both `/posts/` and `-activity-`
6. The permalink embedded in the page HTML/JSON (regex) — LinkedIn's
   authenticated single-post view often exposes the canonical
   `/posts/...-activity-...` URL only inside serialized page data, not as an
   anchor or `<link>` tag.

Each strategy returns zero or more candidates. A candidate is accepted only if it
belongs to LinkedIn, contains `/posts/` and `-activity-`, and has a numeric
Activity ID. Non-high-trust strategies (4–6) must additionally pass **slug
matching** against the Share URL so a recommendation / comment / nearby post is
not returned by mistake. The result is then normalized (https, `www.linkedin.com`,
no query, no fragment, slug + suffix preserved).

**Extraction runs before state detection.** Auth-wall / checkpoint / captcha
classification ([`detectLinkedInState.ts`](src/resolver/detectLinkedInState.ts))
only runs when no Activity URL was found, and is driven by the final URL and
**visible** page text (never raw HTML) — so a real result is never blocked by a
false-positive signal in LinkedIn's JavaScript bundles.

### Authentication

The resolver first tries **unauthenticated**. If it hits a login wall (or finds
nothing) and `LINKEDIN_COOKIES` are configured, it retries with an authenticated
session. Cookies are never logged, returned, or written to debug artifacts.

To obtain cookies **without any copy/paste**, run the capture helper — it opens a
browser, you log into LinkedIn normally, and it writes a ready-to-use
`cookies.json` (values are never printed):

```bash
npm run capture:cookies   # then store cookies.json in Secret Manager and delete it
```

---

## Local development

```bash
npm install            # installs deps + Chromium
cp .env.example .env   # then fill in RESOLVER_API_KEY
npm run dev            # hot-reload dev server on PORT (default 8080)
```

Build & run the production bundle:

```bash
npm run build
npm start
```

Quick manual check:

```bash
curl http://localhost:8080/health

curl -X POST http://localhost:8080/resolve \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $RESOLVER_API_KEY" \
  -d '{"share_url":"https://www.linkedin.com/posts/were-headed-to-london-were-excited-share-7472364428009680896-yWay"}'
```

---

## Tests

```bash
npm test          # fast unit + HTTP tests (no real browser, no network)
npm run test:live # OPTIONAL: drives real Chromium against LinkedIn (slow)
```

The live suite ([`tests/live/`](tests/live/)) is intentionally excluded from
`npm test`. It is best-effort and may return a recognized failure code when
LinkedIn serves an auth wall.

---

## Environment variables

| Variable                 | Default            | Purpose                                            |
| ------------------------ | ------------------ | -------------------------------------------------- |
| `PORT`                   | `8080`             | HTTP port (Cloud Run injects this)                 |
| `RESOLVER_API_KEY`       | —                  | Required. Shared secret for `X-API-Key`            |
| `LINKEDIN_COOKIES`       | —                  | Optional. Playwright-compatible cookies (JSON)     |
| `PAGE_TIMEOUT_MS`        | `45000`            | Per-navigation timeout                             |
| `ENABLE_DEBUG_ARTIFACTS` | `false`            | Capture screenshot + HTML on failure (ephemeral)   |
| `LOG_LEVEL`              | `info`             | `debug` \| `info` \| `warn` \| `error`             |
| `MAX_ATTEMPTS`           | `2`                | Navigation retries per session                     |
| `BACKOFF_BASE_MS`        | `500`              | Base for exponential backoff                       |
| `MAX_BROWSER_CONCURRENCY`| `1`                | In-process resolve concurrency guard               |
| `BODY_LIMIT`             | `16kb`             | Max request body size                              |

Never commit real secrets. See [`.env.example`](.env.example).

---

## Docker / Cloud Run

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full build, secret, and deploy steps.
The service listens on `process.env.PORT`, uses one browser context per request,
shuts down gracefully on `SIGTERM`, and is designed for Cloud Run with
concurrency `1` and min instances `0`.
