const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { expect, test } = require('@playwright/test');

const { AuthenticationError, OAuthRejectedError } = require('../../src/auth/errors');
const { OAuthAuthorizer } = require('../../src/auth/oauth-authorizer');
const { OAuthClient } = require('../../src/auth/oauth-client');
const { createChallenge, createState, createVerifier } = require('../../src/auth/pkce');
const { TokenManager } = require('../../src/auth/token-manager');
const { FileTokenStore } = require('../../src/auth/token-store');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function callbackRequest(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path: pathname }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      })
      .on('error', reject);
  });
}

function memoryStore(initial = null) {
  return {
    token: initial,
    load() {
      return this.token;
    },
    save(token) {
      this.token = token;
    },
    clear() {
      this.token = null;
    },
  };
}

test.describe('PKCE primitives', () => {
  test('creates valid high-entropy verifier, S256 challenge, and state values', () => {
    const verifier = createVerifier();
    const challenge = createChallenge(verifier);
    const expectedChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(expectedChallenge);
    expect(createState()).toMatch(/^[a-f0-9]{32}$/);
  });

  test('rejects empty or non-string verifiers', () => {
    expect(() => createChallenge('')).toThrow(TypeError);
    expect(() => createChallenge(null)).toThrow(TypeError);
  });
});

test.describe('OAuth client', () => {
  test('builds an authorization URL with a matching PKCE challenge and state', () => {
    const client = new OAuthClient({
      authorizationUrl: 'https://hr.example.test/oauth/authorize?scope=api',
      tokenUrl: 'https://hr.example.test/oauth/token',
      clientId: 'automation-client',
      redirectUri: 'http://localhost:9876/oauth/callback',
    });

    const request = client.createAuthorizationRequest();
    const url = new URL(request.url);

    expect(url.searchParams.get('scope')).toBe('api');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('automation-client');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:9876/oauth/callback');
    expect(url.searchParams.get('code_challenge')).toBe(createChallenge(request.verifier));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(request.state);
  });

  test('exchanges an authorization code and normalizes the token response', async () => {
    let receivedBody;
    const server = await listen(
      http.createServer((request, response) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          receivedBody = new URLSearchParams(Buffer.concat(chunks).toString());
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              access_token: 'access-value',
              refresh_token: 'refresh-value',
              token_type: 'Bearer',
              expires_in: 1800,
            }),
          );
        });
      }),
    );

    try {
      const client = new OAuthClient({
        authorizationUrl: 'http://localhost/authorize',
        tokenUrl: `http://127.0.0.1:${server.address().port}/token`,
        clientId: 'automation-client',
        clientSecret: 'client-secret',
        redirectUri: 'http://localhost:9876/oauth/callback',
      });

      const before = Date.now();
      const token = await client.exchangeCode({ code: 'auth-code', verifier: 'pkce-verifier' });

      expect(receivedBody.get('grant_type')).toBe('authorization_code');
      expect(receivedBody.get('code')).toBe('auth-code');
      expect(receivedBody.get('client_id')).toBe('automation-client');
      expect(receivedBody.get('client_secret')).toBe('client-secret');
      expect(receivedBody.get('redirect_uri')).toBe('http://localhost:9876/oauth/callback');
      expect(receivedBody.get('code_verifier')).toBe('pkce-verifier');
      expect(token).toMatchObject({
        accessToken: 'access-value',
        refreshToken: 'refresh-value',
        tokenType: 'Bearer',
      });
      expect(token.expiresAt).toBeGreaterThanOrEqual(before + 1_800_000);
    } finally {
      await closeServer(server);
    }
  });

  test('sends refresh grants and defaults omitted optional token fields', async () => {
    let receivedBody;
    const server = await listen(
      http.createServer((request, response) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          receivedBody = new URLSearchParams(Buffer.concat(chunks).toString());
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ access_token: 'new-access' }));
        });
      }),
    );

    try {
      const client = new OAuthClient({
        authorizationUrl: 'http://localhost/authorize',
        tokenUrl: `http://127.0.0.1:${server.address().port}/token`,
        clientId: 'automation-client',
        redirectUri: 'http://localhost:9876/oauth/callback',
      });

      const token = await client.refresh('old-refresh');

      expect(receivedBody.get('grant_type')).toBe('refresh_token');
      expect(receivedBody.get('refresh_token')).toBe('old-refresh');
      expect(token).toEqual({
        accessToken: 'new-access',
        refreshToken: null,
        tokenType: 'Bearer',
        expiresAt: null,
      });
    } finally {
      await closeServer(server);
    }
  });

  test('reports OAuth error responses as authentication failures', async () => {
    const server = await listen(
      http.createServer((_request, response) => {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'invalid_grant', hint: 'expired code' }));
      }),
    );

    try {
      const client = new OAuthClient({
        authorizationUrl: 'http://localhost/authorize',
        tokenUrl: `http://127.0.0.1:${server.address().port}/token`,
        clientId: 'automation-client',
        redirectUri: 'http://localhost:9876/oauth/callback',
      });

      await expect(client.refresh('refresh-value')).rejects.toMatchObject({
        name: 'OAuthRejectedError',
        status: 400,
        oauthError: 'invalid_grant',
      });
    } finally {
      await closeServer(server);
    }
  });

  test('rejects successful responses that omit the access token', async () => {
    const server = await listen(
      http.createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ refresh_token: 'refresh-value' }));
      }),
    );

    try {
      const client = new OAuthClient({
        authorizationUrl: 'http://localhost/authorize',
        tokenUrl: `http://127.0.0.1:${server.address().port}/token`,
        clientId: 'automation-client',
        redirectUri: 'http://localhost:9876/oauth/callback',
      });

      await expect(client.refresh('refresh-value')).rejects.toThrow(
        'Token response missing access_token',
      );
    } finally {
      await closeServer(server);
    }
  });
});

test.describe('OAuth callback', () => {
  async function withCallbackServer(run) {
    const authorizer = new OAuthAuthorizer({
      callbackHost: '127.0.0.1',
      callbackPort: 0,
      timeoutMs: 5_000,
    });
    const callback = authorizer._createCallbackServer('expected-state');
    const server = await callback.serverReady;

    try {
      await run(callback, server.address().port);
    } finally {
      await authorizer._stopCallbackServer(server);
    }
  }

  test('completes local login and consent flow in a real browser', async () => {
    const expectedState = 'integration-state';
    const authorizer = new OAuthAuthorizer({
      callbackHost: '127.0.0.1',
      callbackPort: 0,
      timeoutMs: 10_000,
      headless: true,
    });

    let submittedCredentials;
    const server = await listen(
      http.createServer((request, response) => {
        const requestUrl = new URL(request.url, 'http://127.0.0.1');

        if (requestUrl.pathname === '/oauth2/authorize') {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(`
            <!doctype html>
            <form action="/login" method="post">
              <input name="username" placeholder="Username">
              <input name="password" type="password">
              <button type="submit">Login</button>
            </form>
          `);
          return;
        }

        if (requestUrl.pathname === '/login') {
          const chunks = [];
          request.on('data', (chunk) => chunks.push(chunk));
          request.on('end', () => {
            submittedCredentials = new URLSearchParams(Buffer.concat(chunks).toString());
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(`
              <!doctype html>
              <button type="button" onclick="window.location.href='http://127.0.0.1:${authorizer.callbackPort}/oauth/callback?code=browser-code&state=${expectedState}'">
                Allow Access
              </button>
            `);
          });
          return;
        }

        response.writeHead(404);
        response.end('Not found');
      }),
    );

    try {
      const result = await authorizer.authorize({
        authorizationUrl: `http://127.0.0.1:${server.address().port}/oauth2/authorize?state=${expectedState}`,
        expectedState,
        credentials: { username: 'test-user', password: 'test-password' },
      });

      expect(result).toEqual({ code: 'browser-code', state: expectedState });
      expect(submittedCredentials.get('username')).toBe('test-user');
      expect(submittedCredentials.get('password')).toBe('test-password');
      await expect(
        callbackRequest(
          authorizer.callbackPort,
          '/oauth/callback?code=unexpected&state=unexpected',
        ),
      ).rejects.toThrow();
    } finally {
      await closeServer(server);
    }
  });

  test('accepts a callback only when its state matches', async () => {
    await withCallbackServer(async (callback, port) => {
      const result = callback.result;
      const status = await callbackRequest(
        port,
        '/oauth/callback?code=authorization-code&state=expected-state',
      );

      expect(status).toBe(200);
      await expect(result).resolves.toMatchObject({
        code: 'authorization-code',
        state: 'expected-state',
      });
    });
  });

  test('ignores unrelated callback paths without consuming the valid callback', async () => {
    await withCallbackServer(async (callback, port) => {
      const result = callback.result;

      expect(await callbackRequest(port, '/unexpected?code=ignored&state=expected-state')).toBe(
        404,
      );
      expect(
        await callbackRequest(port, '/oauth/callback?code=accepted&state=expected-state'),
      ).toBe(200);
      await expect(result).resolves.toMatchObject({ code: 'accepted' });
    });
  });

  test('rejects a mismatched state before accepting its authorization code', async () => {
    await withCallbackServer(async (callback, port) => {
      const rejected = expect(callback.result).rejects.toThrow('OAuth state mismatch');
      const status = await callbackRequest(
        port,
        '/oauth/callback?code=attacker-code&state=wrong-state',
      );

      expect(status).toBe(400);
      await rejected;
    });
  });

  test('validates state on OAuth error callbacks as well as successful callbacks', async () => {
    await withCallbackServer(async (callback, port) => {
      const rejected = expect(callback.result).rejects.toThrow('OAuth state mismatch');
      const status = await callbackRequest(
        port,
        '/oauth/callback?error=access_denied&state=wrong-state',
      );

      expect(status).toBe(400);
      await rejected;
    });
  });

  test('reports an OAuth error when its callback state is valid', async () => {
    await withCallbackServer(async (callback, port) => {
      const rejected = expect(callback.result).rejects.toThrow('access_denied');
      const status = await callbackRequest(
        port,
        '/oauth/callback?error=access_denied&error_description=User+denied&state=expected-state',
      );

      expect(status).toBe(200);
      await rejected;
    });
  });

  test('rejects callbacks without an authorization code', async () => {
    await withCallbackServer(async (callback, port) => {
      const rejected = expect(callback.result).rejects.toThrow(
        'OAuth callback did not contain a code',
      );
      const status = await callbackRequest(port, '/oauth/callback?state=expected-state');

      expect(status).toBe(200);
      await rejected;
    });
  });
});

test.describe('Token manager', () => {
  test('returns a valid cached access token without refreshing', async () => {
    const store = memoryStore({ accessToken: 'cached', expiresAt: Date.now() + 300_000 });
    const oauth = {
      async refresh() {
        throw new Error('A valid cached token must not be refreshed');
      },
    };
    const manager = new TokenManager({
      oauth,
      authorizer: {},
      store,
      credentials: { username: 'user', password: 'password' },
    });

    await expect(manager.getAccessToken()).resolves.toBe('cached');
  });

  test('does not treat a cached token with unknown expiry as valid', async () => {
    const store = memoryStore({
      accessToken: 'unknown-expiry-access',
      refreshToken: 'refresh-value',
      expiresAt: null,
    });

    let refreshCalls = 0;

    const oauth = {
      async refresh(refreshToken) {
        refreshCalls += 1;
        expect(refreshToken).toBe('refresh-value');

        return {
          accessToken: 'fresh-access',
          refreshToken: 'new-refresh',
          expiresAt: Date.now() + 600_000,
        };
      },
    };

    const manager = new TokenManager({
      oauth,
      authorizer: {},
      store,
      credentials: {
        username: 'user',
        password: 'password',
      },
    });

    await expect(manager.getAccessToken()).resolves.toBe('fresh-access');

    expect(refreshCalls).toBe(1);
    expect(store.token).toMatchObject({
      accessToken: 'fresh-access',
      refreshToken: 'new-refresh',
    });
  });

  test('refreshes an expiring token and preserves an omitted refresh token', async () => {
    const store = memoryStore({
      accessToken: 'expired-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() + 1_000,
    });
    const oauth = {
      async refresh(refreshToken) {
        expect(refreshToken).toBe('old-refresh');
        return { accessToken: 'fresh-access', refreshToken: null, expiresAt: Date.now() + 600_000 };
      },
    };
    const manager = new TokenManager({
      oauth,
      authorizer: {},
      store,
      credentials: { username: 'user', password: 'password' },
    });

    await expect(manager.getAccessToken()).resolves.toBe('fresh-access');
    expect(store.token.refreshToken).toBe('old-refresh');
  });

  test('coalesces concurrent token acquisition requests', async () => {
    const store = memoryStore({
      accessToken: 'expired-access',
      refreshToken: 'refresh-value',
      expiresAt: Date.now() - 1,
    });
    let refreshCalls = 0;
    const oauth = {
      async refresh() {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { accessToken: 'fresh-access', expiresAt: Date.now() + 600_000 };
      },
    };
    const manager = new TokenManager({
      oauth,
      authorizer: {},
      store,
      credentials: { username: 'user', password: 'password' },
    });

    await expect(
      Promise.all([manager.getAccessToken(), manager.getAccessToken(), manager.getAccessToken()]),
    ).resolves.toEqual(['fresh-access', 'fresh-access', 'fresh-access']);
    expect(refreshCalls).toBe(1);
  });

  test('falls back to authorization-code flow after refresh failure', async () => {
    const store = memoryStore({
      accessToken: 'expired-access',
      refreshToken: 'revoked-refresh',
      expiresAt: Date.now() - 1,
    });
    const authorizationRequest = {
      url: 'https://hr.example.test/authorize?state=state',
      state: 'state',
      verifier: 'verifier',
    };
    const oauth = {
      async refresh() {
        throw new OAuthRejectedError('Refresh rejected', {
          status: 400,
          oauthError: 'invalid_grant',
        });
      },
      createAuthorizationRequest() {
        return authorizationRequest;
      },
      async exchangeCode(request) {
        expect(request).toEqual({ code: 'code', verifier: 'verifier' });
        return { accessToken: 'new-access', refreshToken: 'new-refresh' };
      },
    };
    const authorizer = {
      async authorize(request) {
        expect(request).toMatchObject({
          authorizationUrl: authorizationRequest.url,
          expectedState: 'state',
        });
        return { code: 'code', state: 'state' };
      },
    };
    const manager = new TokenManager({
      oauth,
      authorizer,
      store,
      credentials: { username: 'user', password: 'password' },
    });

    await expect(manager.getAccessToken()).resolves.toBe('new-access');
    expect(store.token.refreshToken).toBe('new-refresh');
  });

  test('rejects an authorization result without a code', async () => {
    const oauth = {
      createAuthorizationRequest() {
        return { url: 'https://hr.example.test/authorize', state: 'state', verifier: 'verifier' };
      },
    };
    const authorizer = {
      async authorize() {
        return { state: 'state' };
      },
    };
    const manager = new TokenManager({
      oauth,
      authorizer,
      store: memoryStore(),
      credentials: { username: 'user', password: 'password' },
    });

    await expect(manager.getAccessToken()).rejects.toThrow('Authorization did not return a code');
  });
});

test.describe('File token store', () => {
  test('round-trips token data and clears the stored token', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orangehrm-auth-test-'));

    try {
      const store = new FileTokenStore(path.join(directory, 'nested', 'token.json'));
      const token = { accessToken: 'secret', refreshToken: 'refresh', expiresAt: 123 };

      expect(store.load()).toBeNull();
      store.save(token);
      expect(store.load()).toEqual(token);
      store.clear();
      expect(store.load()).toBeNull();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('treats malformed token data as absent and permits clearing a missing file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orangehrm-auth-test-'));

    try {
      const store = new FileTokenStore(path.join(directory, 'token.json'));

      fs.writeFileSync(store.filePath, '{invalid json', 'utf8');
      expect(store.load()).toBeNull();
      store.clear();
      expect(store.load()).toBeNull();
      store.clear();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

test.describe('Token manager refresh failure handling', () => {
  test('does not fall back to browser flow on refresh transport failure', async () => {
    const store = memoryStore({
      accessToken: 'expired-access',
      refreshToken: 'still-valid-refresh',
      expiresAt: Date.now() - 1,
    });

    const oauth = {
      async refresh() {
        throw new AuthenticationError('Token refresh failed: ECONNREFUSED', {
          cause: 'ECONNREFUSED',
        });
      },
    };

    const authorizer = {
      async authorize() {
        throw new Error('Authorizer must not be called for a transport failure');
      },
    };

    const manager = new TokenManager({
      oauth,
      authorizer,
      store,
      credentials: { username: 'user', password: 'password' },
    });

    await expect(manager.getAccessToken()).rejects.toMatchObject({
      name: 'AuthenticationError',
      cause: 'ECONNREFUSED',
    });

    // The refresh token must still be on disk — the transport failure says
    // nothing about its validity.
    expect(store.token.refreshToken).toBe('still-valid-refresh');
  });

  test('does not fall back for unrelated OAuth client rejections', async () => {
    const store = memoryStore({
      accessToken: 'expired-access',
      refreshToken: 'refresh-value',
      expiresAt: Date.now() - 1,
    });
    const oauth = {
      async refresh() {
        throw new OAuthRejectedError('invalid client', {
          status: 401,
          oauthError: 'invalid_client',
        });
      },
    };
    const authorizer = {
      async authorize() {
        throw new Error('Authorizer must not be called for invalid_client');
      },
    };
    const manager = new TokenManager({
      oauth,
      authorizer,
      store,
      credentials: { username: 'user', password: 'password' },
    });

    await expect(manager.getAccessToken()).rejects.toMatchObject({
      name: 'OAuthRejectedError',
      oauthError: 'invalid_client',
    });
  });

  test('does not launch browser fallback for rate limiting', async () => {
    const store = memoryStore({
      accessToken: 'expired-access',
      refreshToken: 'refresh-value',
      expiresAt: Date.now() - 1,
    });
    const oauth = {
      async refresh() {
        throw new OAuthRejectedError('rate limited', {
          status: 429,
          oauthError: 'temporarily_unavailable',
        });
      },
    };
    const authorizer = {
      async authorize() {
        throw new Error('Authorizer must not be called for rate limiting');
      },
    };
    const manager = new TokenManager({
      oauth,
      authorizer,
      store,
      credentials: { username: 'user', password: 'password' },
    });

    await expect(manager.getAccessToken()).rejects.toMatchObject({
      name: 'OAuthRejectedError',
      status: 429,
    });
  });

  test('falls back for OrangeHRM invalid-refresh responses', async () => {
    const store = memoryStore({
      accessToken: 'expired-access',
      refreshToken: 'invalid-refresh',
      expiresAt: Date.now() - 1,
    });
    const oauth = {
      async refresh() {
        throw new OAuthRejectedError('Token refresh rejected', {
          status: 401,
          oauthError: 'invalid_request',
          hint: 'Cannot decrypt the refresh token',
        });
      },
      createAuthorizationRequest() {
        return { url: 'https://hr.example.test/authorize', state: 'state', verifier: 'verifier' };
      },
      async exchangeCode() {
        return { accessToken: 'new-access', refreshToken: 'new-refresh' };
      },
    };
    const authorizer = {
      async authorize() {
        return { code: 'code', state: 'state' };
      },
    };
    const manager = new TokenManager({
      oauth,
      authorizer,
      store,
      credentials: { username: 'user', password: 'password' },
    });

    await expect(manager.getAccessToken()).resolves.toBe('new-access');
  });

  test('uses the new refresh token when the server rotates it', async () => {
    const store = memoryStore({
      accessToken: 'expired-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() - 1,
    });

    const oauth = {
      async refresh(refreshToken) {
        expect(refreshToken).toBe('old-refresh');
        return {
          accessToken: 'fresh-access',
          refreshToken: 'rotated-refresh',
          expiresAt: Date.now() + 600_000,
        };
      },
    };

    const manager = new TokenManager({
      oauth,
      authorizer: {},
      store,
      credentials: { username: 'user', password: 'password' },
    });

    await expect(manager.getAccessToken()).resolves.toBe('fresh-access');
    expect(store.token.refreshToken).toBe('rotated-refresh');
  });

  test('allows retry after a rejected refresh has fallen through to browser flow', async () => {
    // First call: refresh rejected, browser flow succeeds.
    // Second call: token still valid, no refresh, no browser.
    const store = memoryStore({
      accessToken: 'expired-access',
      refreshToken: 'revoked-refresh',
      expiresAt: Date.now() - 1,
    });

    let authorizeCalls = 0;

    const oauth = {
      async refresh() {
        throw new OAuthRejectedError('revoked', {
          status: 400,
          oauthError: 'invalid_grant',
        });
      },
      createAuthorizationRequest() {
        return { url: 'https://hr.example.test/authorize', state: 's', verifier: 'v' };
      },
      async exchangeCode() {
        return {
          accessToken: 'browser-access',
          refreshToken: 'browser-refresh',
          expiresAt: Date.now() + 600_000,
        };
      },
    };

    const authorizer = {
      async authorize() {
        authorizeCalls += 1;
        return { code: 'code', state: 's' };
      },
    };

    const manager = new TokenManager({
      oauth,
      authorizer,
      store,
      credentials: { username: 'user', password: 'password' },
    });

    await expect(manager.getAccessToken()).resolves.toBe('browser-access');
    expect(authorizeCalls).toBe(1);

    await expect(manager.getAccessToken()).resolves.toBe('browser-access');
    expect(authorizeCalls).toBe(1);
  });
});

test.describe('OAuth callback lifecycle', () => {
  test('times out when no callback is received', async () => {
    const authorizer = new OAuthAuthorizer({
      callbackHost: '127.0.0.1',
      callbackPort: 0,
      timeoutMs: 100,
    });

    const callback = authorizer._createCallbackServer('expected-state');
    const server = await callback.serverReady;

    try {
      await expect(callback.result).rejects.toThrow('OAuth callback timed out after 100ms');
    } finally {
      await authorizer._stopCallbackServer(server);
    }
  });
  test('rejects serverReady when the callback port is already in use', async () => {
    const blocker = await listen(http.createServer(() => {}));
    const port = blocker.address().port;

    try {
      const authorizer = new OAuthAuthorizer({
        callbackHost: '127.0.0.1',
        callbackPort: port,
        timeoutMs: 1_000,
      });

      const callback = authorizer._createCallbackServer('state');

      await expect(callback.serverReady).rejects.toThrow();
      await expect(callback.result).rejects.toThrow();
    } finally {
      await closeServer(blocker);
    }
  });
});

test.describe('Constructor validation', () => {
  test('OAuthClient rejects missing required options', () => {
    expect(() => new OAuthClient({})).toThrow(TypeError);
    expect(
      () =>
        new OAuthClient({
          authorizationUrl: 'https://x/authorize',
          tokenUrl: 'https://x/token',
          clientId: 'c',
          // missing redirectUri
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new OAuthClient({
          authorizationUrl: 'https://x/authorize',
          tokenUrl: 'https://x/token',
          clientId: 'c',
          redirectUri: 'http://localhost:9876/oauth/callback',
          timeoutMs: -1,
        }),
    ).toThrow(TypeError);
  });

  test('TokenManager rejects missing collaborators', () => {
    expect(() => new TokenManager({})).toThrow(TypeError);
    expect(
      () =>
        new TokenManager({
          oauth: {},
          authorizer: {},
          store: {},
          // missing credentials
        }),
    ).toThrow(TypeError);
  });

  test('OAuthAuthorizer rejects invalid port and timeout', () => {
    expect(() => new OAuthAuthorizer({ callbackPort: -1 })).toThrow(TypeError);
    expect(() => new OAuthAuthorizer({ callbackPort: 70000 })).toThrow(TypeError);
    expect(() => new OAuthAuthorizer({ timeoutMs: 0 })).toThrow(TypeError);
    expect(() => new OAuthAuthorizer({ screenshotDirectory: '' })).toThrow(TypeError);
  });
});

test.describe('AuthenticationError metadata', () => {
  test('copies custom metadata onto the error', () => {
    const err = new AuthenticationError('boom', { status: 401, hint: 'x' });
    expect(err.status).toBe(401);
    expect(err.hint).toBe('x');
  });

  test('does not let metadata overwrite reserved Error properties', () => {
    const err = new AuthenticationError('original message', {
      message: 'hijacked',
      name: 'HijackedName',
      stack: 'hijacked stack',
    });

    expect(err.message).toBe('original message');
    expect(err.name).toBe('AuthenticationError');
    expect(err.stack).not.toBe('hijacked stack');
  });
});

test.describe('Config validation', () => {
  const envModulePath = path.resolve(__dirname, '..', '..', 'src', 'config', 'env.js');

  // Runs env.js in a fresh child process with a controlled environment.
  // Returns a function that throws with the child's stderr if the module
  // throws, or returns stdout if it loads cleanly.
  function runEnvWith(overrides) {
    const script = `
    delete process.env.API_BASE_URL;
    Object.assign(process.env, ${JSON.stringify(overrides)});
      process.env.OHRM_BASE_URL = process.env.OHRM_BASE_URL || 'http://localhost:8080';
      process.env.OHRM_OAUTH_CLIENT_ID = process.env.OHRM_OAUTH_CLIENT_ID || 'client';
      const env = require(${JSON.stringify(envModulePath)});
      process.stdout.write(JSON.stringify({
        apiBaseUrl: env.apiBaseUrl,
        callbackHost: env.callbackHost,
        callbackPort: env.callbackPort,
        callbackPath: env.callbackPath,
      }));
    `;

    return () =>
      execFileSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  }

  test('rejects a redirect URI with no explicit port', () => {
    const run = runEnvWith({
      OHRM_OAUTH_REDIRECT_URI: 'http://localhost/oauth/callback',
    });
    expect(run).toThrow(/must include an explicit port/);
  });

  test('rejects a redirect URI with a non-numeric port', () => {
    const run = runEnvWith({
      OHRM_OAUTH_REDIRECT_URI: 'http://localhost:notaport/oauth/callback',
    });
    expect(run).toThrow(/not a valid absolute URL|invalid port/);
  });

  test('rejects a redirect URI with an out-of-range port', () => {
    const run = runEnvWith({
      OHRM_OAUTH_REDIRECT_URI: 'http://localhost:99999/oauth/callback',
    });
    expect(run).toThrow(/not a valid absolute URL|invalid port/);
  });

  test('rejects a non-http redirect URI', () => {
    const run = runEnvWith({
      OHRM_OAUTH_REDIRECT_URI: 'ftp://localhost:9876/oauth/callback',
    });
    expect(run).toThrow(/must use http/);
  });

  test('derives API and callback settings from environment values', () => {
    const run = runEnvWith({
      OHRM_BASE_URL: 'http://hr.example.test:8080',
      OHRM_OAUTH_REDIRECT_URI: 'http://127.0.0.1:12345/custom/cb',
    });
    const parsed = JSON.parse(run());

    expect(parsed).toEqual({
      apiBaseUrl: 'http://hr.example.test:8080/web/index.php/api/v2',
      callbackHost: '127.0.0.1',
      callbackPort: 12345,
      callbackPath: '/custom/cb',
    });
  });

  test('uses API_BASE_URL when configured', () => {
    const run = runEnvWith({
      API_BASE_URL: 'https://api.example.test/v2',
      OHRM_OAUTH_REDIRECT_URI: 'http://127.0.0.1:12345/oauth/callback',
    });
    const parsed = JSON.parse(run());

    expect(parsed.apiBaseUrl).toBe('https://api.example.test/v2');
  });
});
