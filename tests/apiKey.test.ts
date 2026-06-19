import { describe, it, expect, beforeAll } from 'vitest';
import type { Request, Response } from 'express';

// requireApiKey reads the config singleton, which is evaluated at import time.
// Set env BEFORE importing the module.
let requireApiKey: (req: Request, res: Response, next: () => void) => void;

beforeAll(async () => {
  process.env.RESOLVER_API_KEY = 'unit-test-key';
  const mod = await import('../src/middleware/apiKey');
  requireApiKey = mod.requireApiKey;
});

function mockReqRes(headers: Record<string, string>, body: Record<string, unknown> = {}) {
  const req = {
    body,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;

  const res = {
    statusCode: 0,
    payload: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  return { req, res };
}

describe('requireApiKey middleware', () => {
  it('calls next() when the key matches', () => {
    const { req, res } = mockReqRes({ 'x-api-key': 'unit-test-key' });
    let called = false;
    requireApiKey(req, res as unknown as Response, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(res.statusCode).toBe(0); // untouched
  });

  it('rejects a missing key with 401 UNAUTHORIZED', () => {
    const { req, res } = mockReqRes({});
    let called = false;
    requireApiKey(req, res as unknown as Response, () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(401);
    expect((res.payload as Record<string, unknown>).error_code).toBe('UNAUTHORIZED');
    expect((res.payload as Record<string, unknown>).status).toBe('failed');
  });

  it('rejects a wrong key with 401', () => {
    const { req, res } = mockReqRes({ 'x-api-key': 'wrong-key' });
    let called = false;
    requireApiKey(req, res as unknown as Response, () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('echoes share_url into the failure body when present', () => {
    const { req, res } = mockReqRes({ 'x-api-key': 'wrong' }, { share_url: 'https://x/y-share-1-a' });
    requireApiKey(req, res as unknown as Response, () => undefined);
    expect((res.payload as Record<string, unknown>).share_url).toBe('https://x/y-share-1-a');
  });
});
