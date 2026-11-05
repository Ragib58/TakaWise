import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authedRequest, refreshSession, safeNextPath } from './auth-api';
import { getSession, resetSessionStore, setSession } from './session-store';

const me = {
  id: 'u1',
  email: 'a@b.co',
  emailVerified: true,
  status: 'ACTIVE',
  profile: { fullName: 'A', locale: 'en', timezone: 'Asia/Dhaka', defaultCurrency: 'BDT' },
  createdAt: '2026-11-05T00:00:00.000Z',
};

function sessionBody(token: string) {
  return {
    data: {
      accessToken: token,
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      user: me,
    },
    meta: { requestId: 'r' },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('auth-api', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetSessionStore();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    document.cookie = 'tw_csrf=csrf-123; path=/';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes once for concurrent callers and sends the CSRF header', async () => {
    fetchMock.mockResolvedValue(json(200, sessionBody('t1')));

    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('csrf-123');
    expect(a?.accessToken).toBe('t1');
    expect(b?.accessToken).toBe('t1');
    expect(getSession()).toMatchObject({ status: 'authenticated', accessToken: 't1' });
  });

  it('becomes anonymous when refresh fails', async () => {
    fetchMock.mockResolvedValue(
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'x', details: [], requestId: 'r' } }),
    );
    await expect(refreshSession()).resolves.toBeNull();
    expect(getSession()).toEqual({ status: 'anonymous' });
  });

  it('attaches the bearer token and retries once after a 401', async () => {
    setSession({
      status: 'authenticated',
      accessToken: 'stale',
      expiresAt: Date.now() + 600_000,
      user: me as never,
    });
    fetchMock
      .mockResolvedValueOnce(
        json(401, {
          error: { code: 'UNAUTHENTICATED', message: 'x', details: [], requestId: 'r' },
        }),
      )
      .mockResolvedValueOnce(json(200, sessionBody('fresh')))
      .mockResolvedValueOnce(json(200, { data: { ok: true }, meta: { requestId: 'r' } }));

    const result = await authedRequest<{ ok: boolean }>('/users/me');

    expect(result.data).toEqual({ ok: true });
    const auth = (call: number) =>
      new Headers((fetchMock.mock.calls[call]?.[1] as RequestInit).headers).get('Authorization');
    expect(auth(0)).toBe('Bearer stale');
    expect(auth(2)).toBe('Bearer fresh');
  });

  it.each([
    ['/app/budgets', '/app/budgets'],
    ['//evil.example', '/app/dashboard'],
    ['https://evil.example', '/app/dashboard'],
    ['/\\evil.example', '/app/dashboard'],
    [null, '/app/dashboard'],
  ])('safeNextPath(%p) → %p', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
