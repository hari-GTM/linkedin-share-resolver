import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// These tests exercise the HTTP layer WITHOUT touching Playwright: /health, the
// API-key gate, and input validation all return before any browser work.
let server: Server;
let baseUrl: string;
const KEY = 'app-test-key';

beforeAll(async () => {
  process.env.RESOLVER_API_KEY = KEY;
  process.env.LINKEDIN_COOKIES = '';
  const { createApp } = await import('../src/app');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /health', () => {
  it('returns { status: "ok" }', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /resolve auth', () => {
  it('rejects a request with no API key (401, structured)', async () => {
    const res = await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ share_url: 'https://www.linkedin.com/posts/x-share-1-ab' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error_code).toBe('UNAUTHORIZED');
    expect(body.activity_url).toBeNull();
    expect(body.activity_id).toBeNull();
    expect(typeof body.resolved_at).toBe('string');
  });

  it('rejects a wrong API key', async () => {
    const res = await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'nope' },
      body: JSON.stringify({ share_url: 'https://www.linkedin.com/posts/x-share-1-ab' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /resolve validation (structured errors)', () => {
  async function postResolve(shareUrl: unknown) {
    const res = await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ share_url: shareUrl }),
    });
    return { status: res.status, body: await res.json() };
  }

  it('rejects an Activity URL with 400 INVALID_SHARE_URL', async () => {
    const { status, body } = await postResolve(
      'https://www.linkedin.com/posts/goodera_x-activity-7472415145487421441-UGd2/',
    );
    expect(status).toBe(400);
    expect(body.status).toBe('failed');
    expect(body.error_code).toBe('INVALID_SHARE_URL');
    expect(body.activity_url).toBeNull();
    expect(body.activity_id).toBeNull();
    expect(body.share_url).toContain('activity');
    expect(typeof body.resolved_at).toBe('string');
  });

  it('rejects a non-LinkedIn domain', async () => {
    const { status, body } = await postResolve('https://example.com/posts/x-share-1-ab');
    expect(status).toBe(400);
    expect(body.error_code).toBe('INVALID_SHARE_URL');
  });

  it('rejects a UGC post URL', async () => {
    const { status, body } = await postResolve(
      'https://www.linkedin.com/feed/update/urn:li:ugcPost:7472415145487421441/',
    );
    expect(status).toBe(400);
    expect(body.error_code).toBe('INVALID_SHARE_URL');
  });

  it('rejects a missing share_url', async () => {
    const { status, body } = await postResolve(undefined);
    expect(status).toBe(400);
    expect(body.error_code).toBe('INVALID_SHARE_URL');
  });

  it('returns a structured 400 for malformed JSON', async () => {
    const res = await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: '{ this is not json',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error_code).toBe('INVALID_SHARE_URL');
  });
});
