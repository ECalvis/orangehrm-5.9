const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { expect, test } = require('@playwright/test');

const { AuthenticationError } = require('../src/auth/errors');
const { OAuthAuthorizer } = require('../src/auth/oauth-authorizer');
const { OAuthClient } = require('../src/auth/oauth-client');
const { createChallenge, createState, createVerifier } = require('../src/auth/pkce');
const { TokenManager } = require('../src/auth/token-manager');
const { FileTokenStore } = require('../src/auth/token-store');

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
        redirectUri: 'http://localhost:9876/oauth/callback',
      });

      const before = Date.now();
      const token = await client.exchangeCode({ code: 'auth-code', verifier: 'pkce-verifier' });

      expect(receivedBody.get('grant_type')).toBe('authorization_code');
      expect(receivedBody.get('code')).toBe('auth-code');
      expect(receivedBody.get('client_id')).toBe('automation-client');
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
        name: 'AuthenticationError',
        status: 400,
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
        throw new AuthenticationError('Refresh rejected');
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
