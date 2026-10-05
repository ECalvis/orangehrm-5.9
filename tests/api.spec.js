const http = require('node:http');

const { expect, test } = require('@playwright/test');

const { AuthenticationError } = require('../src/auth/errors');
const { normalizeError, normalizeSuccess } = require('../src/api/envelope');
const { ApiError, createApi } = require('../src/api');

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

test.describe('API envelope boundary', () => {
  test('normalizes response envelope defaults without flattening metadata', () => {
    expect(normalizeSuccess({ data: [1], meta: { total: 1 }, rels: [] })).toEqual({
      data: [1],
      meta: { total: 1 },
      rels: [],
    });
    expect(normalizeSuccess({ data: 1, meta: [] })).toEqual({
      data: 1,
      meta: [],
      rels: [],
    });
    expect(normalizeSuccess(null)).toEqual({ data: null, meta: {}, rels: [] });
  });

  test('maps API and OAuth errors while preserving wire status values', () => {
    expect(
      normalizeError({
        message: 'Request failed',
        response: {
          status: 422,
          data: {
            error: {
              status: '422',
              message: 'Invalid input',
              data: { invalidParamKeys: ['firstName'] },
            },
          },
        },
      }),
    ).toEqual({
      message: 'Invalid input',
      status: '422',
      code: 'VALIDATION',
      data: { invalidParamKeys: ['firstName'] },
    });

    expect(
      normalizeError({
        message: 'Request failed',
        response: {
          status: 401,
          data: { error_description: 'Token rejected', hint: 'invalid token' },
        },
      }),
    ).toEqual({
      message: 'Token rejected',
      status: 401,
      code: 'OAUTH_ERROR',
      data: { hint: 'invalid token' },
    });
  });
});

test.describe('API client and endpoint facade', () => {
  test('sends authenticated requests and returns endpoint envelopes', async () => {
    const received = [];
    const server = await listen(
      http.createServer((request, response) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          received.push({
            method: request.method,
            url: request.url,
            authorization: request.headers.authorization,
            body: Buffer.concat(chunks).toString(),
          });
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              data: [{ empNumber: 7 }],
              meta: { total: 1 },
              rels: [],
            }),
          );
        });
      }),
    );

    try {
      let tokenCalls = 0;
      const api = createApi({
        baseUrl: `http://127.0.0.1:${server.address().port}/web/index.php/api/v2/`,
        tokenManager: {
          async getAccessToken() {
            tokenCalls += 1;
            return 'access-token';
          },
        },
      });

      const result = await api.employees.list({ limit: 5, offset: 0 });
      expect(result).toEqual({
        data: [{ empNumber: 7 }],
        meta: { total: 1 },
        rels: [],
      });
      expect(received[0]).toMatchObject({
        method: 'GET',
        url: '/web/index.php/api/v2/pim/employees?limit=5&offset=0',
        authorization: 'Bearer access-token',
      });

      await api.users.create({
        username: 'qa-user',
        password: 'not-a-real-password',
        status: 1,
        userRoleId: 2,
        empNumber: 7,
      });
      expect(received[1]).toMatchObject({
        method: 'POST',
        url: '/web/index.php/api/v2/admin/users',
        authorization: 'Bearer access-token',
        body: JSON.stringify({
          username: 'qa-user',
          password: 'not-a-real-password',
          status: 1,
          userRoleId: 2,
          empNumber: 7,
        }),
      });

      await api.employees.get(7);
      await api.employees.create({ firstName: 'Test', lastName: 'Employee' });
      await api.employees.delete([7, 8]);
      await api.users.list({ limit: 2 });
      await api.users.delete(9);
      await api._client.put('/test/7', { enabled: true });
      await api._client.delete('/test/7', { ids: [7] });
      const raw = await api._client.raw({ method: 'GET', url: '/raw' });
      await api._client.request({
        method: 'GET',
        url: '/safe',
        baseURL: 'http://example.invalid',
      });

      expect(received.slice(2).map(({ method, url }) => [method, url])).toEqual([
        ['GET', '/web/index.php/api/v2/pim/employees/7'],
        ['POST', '/web/index.php/api/v2/pim/employees'],
        ['DELETE', '/web/index.php/api/v2/pim/employees'],
        ['GET', '/web/index.php/api/v2/admin/users?limit=2'],
        ['DELETE', '/web/index.php/api/v2/admin/users'],
        ['PUT', '/web/index.php/api/v2/test/7'],
        ['DELETE', '/web/index.php/api/v2/test/7'],
        ['GET', '/web/index.php/api/v2/raw'],
        ['GET', '/web/index.php/api/v2/safe'],
      ]);
      expect(received[3].body).toBe(JSON.stringify({ firstName: 'Test', lastName: 'Employee' }));
      expect(received[4].body).toBe(JSON.stringify({ ids: [7, 8] }));
      expect(received[6].body).toBe(JSON.stringify({ ids: [9] }));
      expect(received[7].body).toBe(JSON.stringify({ enabled: true }));
      expect(received[8].body).toBe(JSON.stringify({ ids: [7] }));
      expect(raw).toMatchObject({
        status: 200,
        data: { data: [{ empNumber: 7 }], meta: { total: 1 }, rels: [] },
      });
      expect(tokenCalls).toBe(11);
      await expect(api._client.get('https://example.invalid/steal')).rejects.toThrow(
        'API request URL must be a relative path',
      );
      await expect(api._client.get('/../admin/users')).rejects.toThrow(
        'API request URL must resolve within the configured API base URL',
      );
      expect(received).toHaveLength(11);
    } finally {
      await closeServer(server);
    }
  });

  test('maps API errors and prevents login redirects from becoming success responses', async () => {
    const server = await listen(
      http.createServer((request, response) => {
        if (request.url.startsWith('/not-found')) {
          response.writeHead(404, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: { status: '404', message: 'Not found' } }));
          return;
        }

        if (request.url.startsWith('/validation')) {
          response.writeHead(422, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              error: {
                status: '422',
                message: 'Invalid parameter',
                data: { invalidParamKeys: ['firstName'] },
              },
            }),
          );
          return;
        }

        response.writeHead(302, { Location: '/auth/login' });
        response.end('<html>login</html>');
      }),
    );

    try {
      const api = createApi({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        tokenManager: {
          async getAccessToken() {
            return 'access-token';
          },
        },
      });

      await expect(api._client.get('/not-found')).rejects.toMatchObject({
        name: 'ApiError',
        code: 'NOT_FOUND',
        status: '404',
      });
      await expect(api._client.get('/validation')).rejects.toMatchObject({
        code: 'VALIDATION',
        status: '422',
        data: { invalidParamKeys: ['firstName'] },
      });
      await expect(api._client.get('/redirect')).rejects.toMatchObject({
        code: 'UNKNOWN',
        status: 302,
      });
    } finally {
      await closeServer(server);
    }
  });

  test('requires a base URL and token manager interface', () => {
    expect(() => createApi({ tokenManager: {} })).toThrow(TypeError);
    expect(() => createApi({ baseUrl: 'http://localhost', tokenManager: {} })).toThrow(TypeError);
    expect(() =>
      createApi({
        baseUrl: 'https://user:password@example.test/api',
        tokenManager: { async getAccessToken() {} },
      }),
    ).toThrow(TypeError);
    expect(new ApiError('API failed', { code: 'UNKNOWN' })).toMatchObject({
      name: 'ApiError',
      code: 'UNKNOWN',
    });
  });

  test('preserves authentication failures instead of reclassifying them as API errors', async () => {
    const authenticationError = new AuthenticationError('Token acquisition failed');
    const api = createApi({
      baseUrl: 'http://localhost/api/v2',
      tokenManager: {
        async getAccessToken() {
          throw authenticationError;
        },
      },
    });

    await expect(api.employees.list()).rejects.toBe(authenticationError);
  });
});
