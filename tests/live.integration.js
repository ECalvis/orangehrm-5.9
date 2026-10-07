const axios = require('axios');
const { expect, test } = require('@playwright/test');

const { createApi } = require('../src/api');
const { OAuthAuthorizer } = require('../src/auth/oauth-authorizer');
const { OAuthClient } = require('../src/auth/oauth-client');
const { FileTokenStore } = require('../src/auth/token-store');
const { TokenManager } = require('../src/auth/token-manager');
const env = require('../src/config/env');
const users = require('../src/config/users');
const { createDb } = require('../src/db');
const { createUi } = require('../src/ui');

function createLiveApi(roleName) {
  const user = users[roleName];
  const oauth = new OAuthClient({
    authorizationUrl: env.oauthAuthUrl,
    tokenUrl: env.oauthTokenUrl,
    clientId: env.oauthClientId,
    clientSecret: env.oauthClientSecret,
    redirectUri: env.oauthRedirectUri,
  });
  const authorizer = new OAuthAuthorizer({
    callbackHost: env.callbackHost,
    callbackPort: env.callbackPort,
    callbackPath: env.callbackPath,
    timeoutMs: 120_000,
  });
  const tokenManager = new TokenManager({
    oauth,
    authorizer,
    store: new FileTokenStore(user.tokenFile),
    credentials: { username: user.username, password: user.password },
  });

  return createApi({ baseUrl: env.apiBaseUrl, tokenManager });
}

function createLiveDb() {
  return createDb({
    host: process.env.OHRM_DB_HOST,
    port: Number(process.env.OHRM_DB_PORT),
    user: process.env.OHRM_DB_USER,
    password: process.env.OHRM_DB_PASSWORD ?? '',
    database: process.env.OHRM_DB_NAME,
  });
}

test.describe('Live OrangeHRM integration', () => {
  test('admin authenticates in the real UI and opens the employee list', async ({ page }) => {
    const ui = createUi(page, env.baseUrl);

    await ui.pages.login.loginAs('admin');
    await expect(page).toHaveURL(/\/web\/index\.php\/dashboard\/index/);

    await ui.pages.employees.goto();
    await expect(ui.pages.employees.table.root()).toBeVisible();
    await ui.pages.employees.table.waitForLoad();
    expect(await ui.pages.employees.rowCount()).toBeGreaterThan(0);
  });

  test('ESS authenticates in the real UI', async ({ page }) => {
    const ui = createUi(page, env.baseUrl);

    await ui.pages.login.loginAs('ess');
    await expect(page).toHaveURL(/\/web\/index\.php\/dashboard\/index/);
  });

  test('admin API employee data matches live database records', async () => {
    const api = createLiveApi('admin');
    const db = createLiveDb();

    try {
      const result = await api.pim.employees.list({ limit: 100, offset: 0 });
      const databaseCount = await db.employees.countAll();

      expect(result.meta.total).toBe(databaseCount);
      expect(result.data.length).toBe(Math.min(databaseCount, 100));

      for (const employee of result.data.slice(0, 5)) {
        const persisted = await db.employees.findById(employee.empNumber);

        expect(persisted).not.toBeNull();
        expect(persisted).toMatchObject({
          emp_number: employee.empNumber,
          emp_firstname: employee.firstName,
          emp_lastname: employee.lastName,
        });
        expect(persisted.emp_middle_name ?? '').toBe(employee.middleName ?? '');
      }

      const transaction = await db.client.transaction(async (client) => {
        const first = await client.selectOne(
          'SELECT CONNECTION_ID() AS connectionId, @@transaction_isolation AS isolationLevel',
        );
        const secondConnectionId = await client.selectValue('SELECT CONNECTION_ID()');

        return { ...first, secondConnectionId };
      });

      expect(Number(transaction.connectionId)).toBeGreaterThan(0);
      expect(Number(transaction.secondConnectionId)).toBe(Number(transaction.connectionId));
      expect(String(transaction.isolationLevel).toUpperCase()).toContain('REPEATABLE-READ');
    } finally {
      await db.close();
    }
  });

  test('ESS can read its own employee but not another employee', async () => {
    const api = createLiveApi('ess');
    const db = createLiveDb();

    try {
      const essUser = await db.client.selectOne(
        `SELECT emp_number
           FROM ohrm_user
          WHERE user_name = ? AND status = 1 AND deleted = 0`,
        [users.ess.username],
      );
      const adminUser = await db.client.selectOne(
        `SELECT emp_number
           FROM ohrm_user
          WHERE user_name = ? AND status = 1 AND deleted = 0`,
        [users.admin.username],
      );

      expect(essUser?.emp_number).toBeTruthy();
      expect(adminUser?.emp_number).toBeTruthy();
      expect(essUser.emp_number).not.toBe(adminUser.emp_number);

      const ownEmployee = await api.pim.employees.get(essUser.emp_number);
      expect(ownEmployee.data.empNumber).toBe(essUser.emp_number);
      await expect(api.pim.employees.get(adminUser.emp_number)).rejects.toMatchObject({
        code: 'VALIDATION',
        status: '422',
      });
    } finally {
      await db.close();
    }
  });

  test('the live API rejects unauthenticated requests with a JSON 401', async () => {
    const response = await axios.get(`${env.apiBaseUrl}/pim/employees`, {
      headers: { Accept: 'application/json' },
      maxRedirects: 0,
      validateStatus: () => true,
    });

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.data.error).toMatchObject({ status: 401 });
  });
});
