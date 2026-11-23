const axios = require('axios');
const { expect, test } = require('@playwright/test');

const env = require('../../src/config/env');
const users = require('../../src/config/users');
const { createUi } = require('../../src/ui');
const { SELECTORS } = require('../../src/ui/selectors');
const { createLiveApi, createLiveDb } = require('./live-support');

test.describe('Live OrangeHRM application integration', () => {
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

  test('OXD label selectors address real employee form fields', async ({ page }) => {
    const ui = createUi(page, env.baseUrl);

    await ui.pages.login.loginAs('admin');
    await ui.pages.employees.goto();
    await ui.pages.employees.addEmployee();

    await ui.pages.addEmployee.fill({
      firstName: 'Selector',
      middleName: '',
      lastName: 'Smoke',
    });

    const firstName = page.getByPlaceholder('First Name');
    await expect(firstName).toHaveValue('Selector');
  });

  test('Admin user Add button opens the real user form', async ({ page }) => {
    const ui = createUi(page, env.baseUrl);

    await ui.pages.login.loginAs('admin');
    await ui.pages.users.goto();
    await ui.pages.users.addUser();

    await expect(ui.pages.users.form.fieldByLabel('Username')).toBeVisible();
  });

  test('OXD select exposes real employment status options', async ({ page }) => {
    const ui = createUi(page, env.baseUrl);

    await ui.pages.login.loginAs('admin');
    await ui.pages.employees.goto();
    await ui.components.select.open('Employment Status');

    await expect(page.locator(SELECTORS.selectDropdown)).toBeVisible();
    expect(await page.getByRole('option').count()).toBeGreaterThan(0);
  });

  test('ESS can select QA leave and open the real date picker', async ({ page }) => {
    const ui = createUi(page, env.baseUrl);

    await ui.pages.login.loginAs('ess');
    await ui.base.goto('/web/index.php/leave/applyLeave');
    await ui.components.form.waitForLoad();
    await ui.components.select.select('Leave Type', 'QA Automation Leave');
    await ui.components.form.waitForLoad();
    await ui.components.date.open('From Date');

    await expect(page.locator(SELECTORS.dateCalendar)).toBeVisible();
  });

  test('OXD employee delete dialog can be cancelled without changing data', async ({ page }) => {
    const ui = createUi(page, env.baseUrl);

    await ui.pages.login.loginAs('admin');
    await ui.pages.employees.goto();
    await ui.pages.employees.table.clickAction('EMP002', 'trash');
    await ui.pages.employees.dialog.waitFor();
    await expect(ui.pages.employees.dialog.root()).toBeVisible();

    await ui.pages.employees.dialog.cancel();
    await expect(ui.pages.employees.table.rowByText('EMP002')).toBeVisible();
  });

  test('admin API employee data matches live database records', async () => {
    const api = createLiveApi('admin');
    const db = createLiveDb();

    try {
      const result = await api.pim.employees.list({ limit: 100, offset: 0 });

      expect(result.data.length).toBe(Math.min(result.meta.total, 100));

      for (const employee of result.data) {
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
