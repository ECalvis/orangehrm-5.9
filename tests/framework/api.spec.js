const http = require('node:http');

const { expect, test } = require('@playwright/test');

const { AuthenticationError } = require('../../src/auth/errors');
const { normalizeError, normalizeSuccess } = require('../../src/api/envelope');
const { ApiError, createApi } = require('../../src/api');

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
  test('sends encoded query parameters to the configured API origin', async () => {
    let received;
    const server = await listen(
      http.createServer((request, response) => {
        received = {
          url: new URL(request.url, 'http://127.0.0.1'),
          authorization: request.headers.authorization,
        };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ data: { ok: true }, meta: {}, rels: [] }));
      }),
    );

    try {
      const api = createApi({
        baseUrl: `http://127.0.0.1:${server.address().port}/web/index.php/api/v2`,
        tokenManager: {
          async getAccessToken() {
            return 'access-token';
          },
        },
      });

      await expect(
        api._client.get('/query', { params: { search: 'Ada & Grace', page: 2 } }),
      ).resolves.toEqual({ data: { ok: true }, meta: {}, rels: [] });
      expect(received.url.pathname).toBe('/web/index.php/api/v2/query');
      expect(received.url.searchParams.get('search')).toBe('Ada & Grace');
      expect(received.url.searchParams.get('page')).toBe('2');
      expect(received.authorization).toBe('Bearer access-token');
    } finally {
      await closeServer(server);
    }
  });

  test('covers every documented 5.9 API operation with supported HTTP methods', () => {
    const api = createApi({
      baseUrl: 'http://localhost/web/index.php/api/v2',
      tokenManager: {
        async getAccessToken() {
          return 'access-token';
        },
      },
    });
    const expected = {
      pim: 130,
      leave: 50,
      admin: 111,
      claim: 28,
      time: 42,
      attendance: 20,
      recruitment: 39,
      dashboard: 8,
      core: 6,
      authentication: 1,
      buzz: 21,
      branding: 4,
      directory: 2,
      ldap: 5,
      maintenance: 3,
      mobile: 1,
      openid: 5,
      performance: 37,
      system: 1,
      workspaceNotifications: 9,
    };
    const counts = {};

    for (const domain of Object.keys(expected)) {
      counts[domain] = 0;
      const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        for (const child of Object.values(value)) {
          if (typeof child === 'function' && child.route) {
            counts[domain] += 1;
          } else if (typeof child === 'object') {
            visit(child);
          }
        }
      };
      visit(api[domain]);
    }

    expect(counts).toEqual(expected);
    expect(Object.values(counts).reduce((total, count) => total + count, 0)).toBe(523);
  });

  test('routes domain requests with path, query, and body data kept separate', async () => {
    const received = [];
    const server = await listen(
      http.createServer((request, response) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          received.push({
            method: request.method,
            url: request.url,
            body: Buffer.concat(chunks).toString(),
          });
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ data: null, meta: [], rels: [] }));
        });
      }),
    );

    try {
      const api = createApi({
        baseUrl: `http://127.0.0.1:${server.address().port}/web/index.php/api/v2`,
        tokenManager: {
          async getAccessToken() {
            return 'access-token';
          },
        },
      });

      await api.pim.employeePersonalDetails.get({ empNumber: 12 });
      await api.pim.employeeContactDetails.get({ empNumber: 12 });
      await api.leave.workweek.update({ startDay: 1 });
      await api.admin.users.update({ id: 8, data: { status: 0 } });
      await api.admin.subunits.delete({ id: 9 });
      await api.admin.oauthClients.create({ name: 'automation' });
      await api.time.projectActivities.create({
        projectId: 3,
        data: { name: 'Regression' },
      });
      await api.attendance.employeeRecords.delete({ empNumber: 12, ids: [4] });
      await api.recruitment.candidates.scheduleInterview({
        candidateId: 5,
        data: { interviewDate: '2026-10-05' },
      });
      await api.claim.expenses.delete({ requestId: 21, ids: [6, 7] });
      await api.dashboard.employeesOnLeave.list({ date: '2026-10-05' });
      await api.core.publicVersion.get();
      await api.authentication.validatePassword.create({ password: 'example' });
      await api.buzz.shareComments.create({
        shareId: 2,
        data: { text: 'test comment' },
      });
      await api.branding.theme.update({ primaryColor: '#123456' });
      await api.directory.employees.get({ empNumber: 12 });
      await api.ldap.testConnection.create({ host: 'ldap.example.test' });
      await api.maintenance.candidates.list({ limit: 5 });
      await api.mobile.menus.list();
      await api.openid.providers.get({ id: 4 });
      await api.performance.trackerLogs.update({
        trackerId: 11,
        id: 5,
        data: { comment: 'reviewed' },
      });
      await api.system.check.get();
      await api.workspaceNotifications.testRegistration.create({
        id: 3,
        data: { event: 'test' },
      });

      expect(received.map(({ method, url }) => [method, url])).toEqual([
        ['GET', '/web/index.php/api/v2/pim/employees/12/personal-details'],
        ['GET', '/web/index.php/api/v2/pim/employee/12/contact-details'],
        ['PUT', '/web/index.php/api/v2/leave/workweek'],
        ['PUT', '/web/index.php/api/v2/admin/users/8'],
        ['DELETE', '/web/index.php/api/v2/admin/subunits/9'],
        ['POST', '/web/index.php/api/v2/admin/oauth-clients'],
        ['POST', '/web/index.php/api/v2/time/project/3/activities'],
        ['DELETE', '/web/index.php/api/v2/attendance/employees/12/records'],
        ['POST', '/web/index.php/api/v2/recruitment/candidates/5/shedule-interview'],
        ['DELETE', '/web/index.php/api/v2/claim/requests/21/expenses'],
        ['GET', '/web/index.php/api/v2/dashboard/employees/leaves?date=2026-10-05'],
        ['GET', '/web/index.php/api/v2/core/public/version'],
        ['POST', '/web/index.php/api/v2/auth/public/validation/password'],
        ['POST', '/web/index.php/api/v2/buzz/shares/2/comments'],
        ['PUT', '/web/index.php/api/v2/admin/theme'],
        ['GET', '/web/index.php/api/v2/directory/employees/12'],
        ['POST', '/web/index.php/api/v2/admin/ldap-test-connection'],
        ['GET', '/web/index.php/api/v2/maintenance/candidates?limit=5'],
        ['GET', '/web/index.php/api/v2/mobile/menus'],
        ['GET', '/web/index.php/api/v2/auth/openid-providers/4'],
        ['PUT', '/web/index.php/api/v2/performance/trackers/11/logs/5'],
        ['GET', '/web/index.php/api/v2/core/system-check'],
        ['POST', '/web/index.php/api/v2/admin/workspace-notification/registrations/3/test'],
      ]);
      expect(received.map(({ body }) => body).filter(Boolean)).toEqual([
        JSON.stringify({ startDay: 1 }),
        JSON.stringify({ status: 0 }),
        JSON.stringify({ name: 'automation' }),
        JSON.stringify({ name: 'Regression' }),
        JSON.stringify({ ids: [4] }),
        JSON.stringify({ interviewDate: '2026-10-05' }),
        JSON.stringify({ ids: [6, 7] }),
        JSON.stringify({ password: 'example' }),
        JSON.stringify({ text: 'test comment' }),
        JSON.stringify({ primaryColor: '#123456' }),
        JSON.stringify({ host: 'ldap.example.test' }),
        JSON.stringify({ comment: 'reviewed' }),
        JSON.stringify({ event: 'test' }),
      ]);
    } finally {
      await closeServer(server);
    }
  });

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

      const result = await api.pim.employees.list({ limit: 5, offset: 0 });
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

      await api.admin.users.create({
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

      await api.pim.employees.get(7);
      await api.pim.employees.create({ firstName: 'Test', lastName: 'Employee' });
      await api.pim.employees.delete([7, 8]);
      await api.admin.users.list({ limit: 2 });
      await api.admin.users.delete(9);
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

    await expect(api.pim.employees.list()).rejects.toBe(authenticationError);
  });
});
