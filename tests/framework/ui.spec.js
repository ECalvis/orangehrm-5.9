const { test, expect } = require('@playwright/test');

const { BasePage } = require('../../src/ui/base-page');
const { createUi } = require('../../src/ui');
const { SELECTORS, byLabelText, iconButton } = require('../../src/ui/selectors');
const { OxdForm } = require('../../src/ui/components/oxd-form');
const { OxdSelect } = require('../../src/ui/components/oxd-select');
const { OxdTable } = require('../../src/ui/components/oxd-table');
const { OxdDatePicker } = require('../../src/ui/components/oxd-date-picker');
const { OxdDialog } = require('../../src/ui/components/oxd-dialog');
const { OxdToast } = require('../../src/ui/components/oxd-toast');
const { login } = require('../../src/ui/workflows/login');
const { createEmployee } = require('../../src/ui/workflows/create-employee');
const { applyLeave } = require('../../src/ui/workflows/apply-leave');
const { createUser } = require('../../src/ui/workflows/create-user');

function mockPage({ countFor } = {}) {
  const calls = [];
  let currentUrl = 'http://orangehrm.test/';

  class Locator {
    constructor(selector) {
      this.selector = selector;
    }

    locator(selector) {
      return new Locator(`${this.selector} >> ${selector}`);
    }

    filter(options) {
      calls.push({ method: 'filter', selector: this.selector, options });
      return this;
    }

    first() {
      calls.push({ method: 'first', selector: this.selector });
      return this;
    }

    last() {
      calls.push({ method: 'last', selector: this.selector });
      return this;
    }

    getByRole(role, options) {
      return new Locator(`${this.selector} >> role=${role} ${JSON.stringify(options || {})}`);
    }

    getByPlaceholder(text, options) {
      return new Locator(
        `${this.selector} >> placeholder=${text} ${JSON.stringify(options || {})}`,
      );
    }

    getByText(text, options) {
      return new Locator(`${this.selector} >> text=${text} ${JSON.stringify(options || {})}`);
    }

    async click() {
      calls.push({ method: 'click', selector: this.selector });
    }

    async fill(value) {
      calls.push({ method: 'fill', selector: this.selector, value });
    }

    async press(key) {
      calls.push({ method: 'press', selector: this.selector, key });
    }

    async scrollIntoViewIfNeeded() {
      calls.push({ method: 'scrollIntoViewIfNeeded', selector: this.selector });
    }

    async waitFor(options) {
      calls.push({ method: 'waitFor', selector: this.selector, options });
    }

    async count() {
      return countFor ? (countFor(this.selector) ?? 1) : 1;
    }

    async innerText() {
      if (this.selector.includes(SELECTORS.inputFieldError)) return ' Required field ';
      if (this.selector.includes(SELECTORS.selectTrigger)) return ' Admin ';
      if (this.selector.includes('role=dialog')) return ' Delete Ada? ';
      if (this.selector.includes(SELECTORS.toast)) return ' Saved ';
      return ' text ';
    }
  }

  return {
    calls,
    page: {
      locator: (selector) => new Locator(selector),
      getByRole: (role, options) => new Locator(`role=${role} ${JSON.stringify(options || {})}`),
      getByPlaceholder: (text, options) =>
        new Locator(`placeholder=${text} ${JSON.stringify(options || {})}`),
      async goto(url, options) {
        currentUrl = url;
        calls.push({ method: 'goto', url, options });
      },
      async waitForLoadState(state) {
        calls.push({ method: 'waitForLoadState', state });
      },
      async waitForFunction(callback, argument) {
        calls.push({ method: 'waitForFunction', callback, argument });
      },
      url: () => currentUrl,
      title: async () => 'OrangeHRM',
    },
  };
}

test.describe('OXD selector boundary', () => {
  test('centralizes stable selector strings and safely quotes dynamic labels', () => {
    expect(SELECTORS.cardTableCard).toBe('.oxd-table-card');
    expect(SELECTORS.overlay).toBe('.oxd-overlay[role="dialog"]');
    expect(byLabelText('Employee "Name"')).toContain('text-is("Employee \\"Name\\"")');
    expect(iconButton('trash')).toBe('.oxd-icon.bi-trash');
  });
});

test.describe('base UI page', () => {
  test('normalizes the base URL, navigates to a server path, and waits for the shell', async () => {
    const { page, calls } = mockPage();
    const base = new BasePage(page, 'http://orangehrm.test///');

    await base.goto('/web/index.php/dashboard/index');

    expect(await base.currentUrl()).toBe('http://orangehrm.test/web/index.php/dashboard/index');
    expect(await base.title()).toBe('OrangeHRM');
    expect(calls[0]).toEqual({
      method: 'goto',
      url: 'http://orangehrm.test/web/index.php/dashboard/index',
      options: { waitUntil: 'domcontentloaded' },
    });
    expect(
      calls.some((call) => call.method === 'waitFor' && call.options.state === 'attached'),
    ).toBe(true);
  });

  test('uses full-load waits for sidebar and topbar navigation and rejects invalid inputs', async () => {
    const { page, calls } = mockPage();
    const base = new BasePage(page, 'http://orangehrm.test');

    await base.navigateSidebar('PIM');
    await base.navigateTopbar('Reports');

    expect(calls.filter((call) => call.method === 'waitForLoadState')).toHaveLength(2);
    expect(() => new BasePage(page, '')).toThrow(TypeError);
    expect(() => new BasePage(null, 'http://orangehrm.test')).toThrow(TypeError);
    await expect(base.goto('relative/path')).rejects.toThrow(TypeError);
  });
});

test.describe('OXD form', () => {
  test('fills and submits a real form using its labeled field and action', async ({ page }) => {
    await page.setContent(`
      <form class="oxd-form">
        <div class="oxd-input-group">
          <label class="oxd-label">First Name</label>
          <input class="oxd-input">
          <span class="oxd-input-field-error-message">Required field</span>
        </div>
        <div class="oxd-form-actions">
          <button type="submit">Save</button>
        </div>
      </form>
      <script>
        document.querySelector('form').addEventListener('submit', (event) => {
          event.preventDefault();
          event.currentTarget.dataset.submitted = 'true';
        });
      </script>
    `);
    const form = new OxdForm(page);

    await form.fillByLabel('First Name', 'Ada');
    expect(await form.fieldByLabel('First Name').inputValue()).toBe('Ada');
    expect(await form.errorFor('First Name')).toBe('Required field');
    await form.submit();
    await expect(page.locator('form')).toHaveAttribute('data-submitted', 'true');
  });

  test('finds fields without label-for, fills, reads first error, submits, resets, and waits', async () => {
    const { page, calls } = mockPage();
    const form = new OxdForm(page);

    await form.fillByLabel('First Name', 'Ada');
    expect(await form.errorFor('First Name')).toBe('Required field');
    await form.submit();
    await form.reset();
    await form.waitForLoad();

    expect(calls.some((call) => call.method === 'scrollIntoViewIfNeeded')).toBe(true);
    expect(calls.some((call) => call.method === 'fill' && call.value === 'Ada')).toBe(true);
    expect(calls.some((call) => call.method === 'click')).toBe(true);
    expect(
      calls.some((call) => call.method === 'waitFor' && call.options.state === 'detached'),
    ).toBe(true);
  });

  test('returns null when a field has no validation message', async () => {
    const { page } = mockPage({
      countFor: (selector) => (selector.endsWith(SELECTORS.inputFieldError) ? 0 : undefined),
    });
    expect(await new OxdForm(page).errorFor('First Name')).toBeNull();
  });
});

test.describe('OXD select, table, date, dialog, and toast components', () => {
  test('selects exact options, reads a selected value, and chooses autocomplete results', async () => {
    const { page, calls } = mockPage();
    const select = new OxdSelect(page);

    await select.open('User Role');
    await select.choose('User Role', 'Admin');
    await select.select('Status', 'Enabled');
    expect(await select.selectedValue('User Role')).toBe('Admin');
    await select.autocomplete('Employee Name', 'Ada', 'Ada Lovelace');

    expect(calls.filter((call) => call.method === 'click').length).toBeGreaterThanOrEqual(3);
    expect(calls.some((call) => call.method === 'fill' && call.value === 'Ada')).toBe(true);
    expect(calls.some((call) => call.method === 'filter')).toBe(true);
    expect(
      calls.some((call) => call.method === 'waitFor' && call.options.state === 'visible'),
    ).toBe(true);
  });

  test('targets card rows and supports actions, checkboxes, sorting, and condition waits', async () => {
    const { page, calls } = mockPage();
    const table = new OxdTable(page);

    expect(await table.rowCount()).toBe(1);
    table.checkboxInRow('Ada Lovelace');
    table.actionInRow('Ada Lovelace', 'trash');
    await table.clickAction('Ada Lovelace', 'pencil');
    table.selectAllCheckbox();
    await table.sortBy('Name');
    await table.sortBy('Name', 'desc');
    await table.waitForLoad();
    await table.waitForRowCount(3);

    expect(calls.some((call) => call.method === 'waitForFunction')).toBe(true);
    expect(
      calls.some((call) => call.method === 'filter' && call.options.hasText === 'Ada Lovelace'),
    ).toBe(true);
    expect(
      calls.some((call) => call.method === 'click' && call.selector.includes('bi-pencil')),
    ).toBe(true);
    expect(table.root()).toBeTruthy();
    await expect(table.sortBy('Name', 'sideways')).rejects.toThrow(TypeError);
    await expect(table.waitForRowCount(-1)).rejects.toThrow(TypeError);
  });

  test('sets, clears, and opens date fields through stable OXD selectors', async () => {
    const { page, calls } = mockPage();
    const date = new OxdDatePicker(page);

    await date.set('From Date', '2026-10-06');
    await date.clear('To Date');
    await date.open('From Date');

    expect(calls.filter((call) => call.method === 'press')).toHaveLength(2);
    expect(calls.some((call) => call.method === 'fill' && call.value === '2026-10-06')).toBe(true);
    expect(
      calls.some((call) => call.method === 'waitFor' && call.options.state === 'visible'),
    ).toBe(true);
  });

  test('reads, confirms, and cancels OXD dialogs', async () => {
    const { page, calls } = mockPage();
    const dialog = new OxdDialog(page);

    await dialog.waitFor();
    expect(await dialog.text()).toBe('Delete Ada?');
    await dialog.confirm();
    await dialog.cancel();

    expect(calls.filter((call) => call.method === 'click')).toHaveLength(2);
    expect(
      calls.filter((call) => call.method === 'waitFor' && call.options.state === 'detached'),
    ).toHaveLength(2);
  });

  test('waits for success/error toasts, reads content, and dismisses without timing assumptions', async () => {
    const { page, calls } = mockPage();
    const toast = new OxdToast(page);

    await toast.waitForSuccess();
    await toast.waitForSuccess('Saved');
    await toast.waitForError();
    await toast.waitForError('Saved');
    expect(await toast.text()).toBe('Saved');
    await toast.dismiss();

    expect(calls.filter((call) => call.method === 'click')).toHaveLength(1);
    expect(
      calls.filter((call) => call.method === 'waitFor' && call.options.state === 'visible'),
    ).toHaveLength(6);
  });
});

test.describe('UI pages, workflows, and composition', () => {
  test('constructs one complete UI surface from the injected page and base URL', async () => {
    const { page } = mockPage();
    const ui = createUi(page, 'http://orangehrm.test');

    expect(Object.keys(ui.components)).toEqual([
      'form',
      'select',
      'table',
      'date',
      'dialog',
      'toast',
    ]);
    expect(Object.keys(ui.pages)).toEqual([
      'login',
      'dashboard',
      'employees',
      'addEmployee',
      'employeePersonalDetails',
      'attendance',
      'leave',
      'users',
      'timesheets',
    ]);
    await ui.pages.dashboard.goto();
  });

  test('opens employee personal details and updates a middle name through the UI', async () => {
    const { page, calls } = mockPage();
    const ui = createUi(page, 'http://orangehrm.test');

    await ui.pages.employeePersonalDetails.goto(42);
    await ui.pages.employeePersonalDetails.updateMiddleName('Updated');

    expect(calls.some((call) => call.method === 'goto' && call.url.endsWith('/42'))).toBe(true);
    expect(calls.some((call) => call.method === 'fill' && call.value === 'Updated')).toBe(true);
    expect(
      calls.some(
        (call) => call.method === 'fill' && call.selector.includes('placeholder=Middle Name'),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.method === 'click' &&
          call.selector.includes(SELECTORS.formActions) &&
          call.selector.includes('role=button'),
      ),
    ).toBe(true);
  });

  test('opens an employee timesheet and checks its action history', async () => {
    const { page, calls } = mockPage();
    const ui = createUi(page, 'http://orangehrm.test');

    await ui.pages.timesheets.gotoEmployeeTimesheets();
    await ui.pages.timesheets.viewEmployee('QA Owned Employee');
    await ui.pages.timesheets.waitForAction('Submitted', 'owned comment');

    expect(
      calls.some(
        (call) =>
          call.method === 'goto' && call.url.endsWith('/web/index.php/time/viewEmployeeTimesheet'),
      ),
    ).toBe(true);
    expect(calls.some((call) => call.method === 'fill' && call.value === 'QA Owned Employee')).toBe(
      true,
    );
    expect(
      calls.some(
        (call) =>
          call.method === 'click' &&
          call.selector.includes('form >> role=button') &&
          call.selector.includes('"name":"View"'),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) => call.method === 'filter' && call.options.hasText === 'owned comment',
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.method === 'waitFor' &&
          call.options.state === 'visible' &&
          call.selector.includes('role=row'),
      ),
    ).toBe(true);
  });

  test('returns false for rows absent from an empty OXD table', async () => {
    const { page } = mockPage({
      countFor: (selector) => (selector.includes(SELECTORS.cardTableCard) ? 0 : undefined),
    });

    const ui = createUi(page, 'http://orangehrm.test');

    expect(await ui.pages.employees.rowCount()).toBe(0);
    expect(await ui.pages.employees.hasRow('Missing')).toBe(false);
    expect(await ui.pages.leave.hasRow('Missing')).toBe(false);
    expect(await ui.pages.users.hasRow('Missing')).toBe(false);
  });

  test('checks employees in the Attendance records list', async () => {
    const { page, calls } = mockPage();
    const ui = createUi(page, 'http://orangehrm.test');

    await ui.pages.attendance.goto();
    expect(await ui.pages.attendance.hasRow('QA Owned Employee')).toBe(true);

    expect(
      calls.some(
        (call) =>
          call.method === 'goto' &&
          call.url.endsWith('/web/index.php/attendance/viewAttendanceRecord'),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.method === 'filter' &&
          call.selector === SELECTORS.cardTableRow &&
          call.options.hasText === 'QA Owned Employee',
      ),
    ).toBe(true);
  });

  test('logs in with explicit credentials and supports named login workflow', async () => {
    const { page, calls } = mockPage();
    const ui = createUi(page, 'http://orangehrm.test');

    await ui.pages.login.loginAs({ username: 'test-user', password: 'test-password' });
    await login(page, 'http://orangehrm.test', {
      username: 'workflow-user',
      password: 'workflow-password',
    });
    await ui.pages.login.logout();

    expect(calls.filter((call) => call.method === 'fill').map((call) => call.value)).toEqual([
      'test-user',
      'test-password',
      'workflow-user',
      'workflow-password',
    ]);
    expect(
      calls.some(
        (call) => call.method === 'click' && call.selector.includes(SELECTORS.userDropdown),
      ),
    ).toBe(true);
    await expect(ui.pages.login.loginAs('not-a-configured-role')).rejects.toThrow(TypeError);
  });

  test('covers employee search, navigation, create workflow, and delete confirmation flow', async () => {
    const { page, calls } = mockPage();
    const ui = createUi(page, 'http://orangehrm.test');

    await ui.pages.employees.goto();
    expect(await ui.pages.employees.rowCount()).toBe(1);
    expect(await ui.pages.employees.hasRow('Ada Lovelace')).toBe(true);
    await ui.pages.employees.searchByName('Ada');
    expect(
      calls.some(
        (call) =>
          call.method === 'fill' &&
          call.selector.includes(SELECTORS.autocompleteInput) &&
          call.value === 'Ada',
      ),
    ).toBe(true);
    await ui.pages.employees.addEmployee();
    await ui.pages.employees.deleteEmployeeByName('Ada Lovelace');
    await ui.pages.addEmployee.goto();
    await createEmployee(page, 'http://orangehrm.test', {
      firstName: 'Grace',
      middleName: '',
      lastName: 'Hopper',
      employeeId: 'E-100',
    });

    expect(calls.filter((call) => call.method === 'goto').map((call) => call.url)).toContain(
      'http://orangehrm.test/web/index.php/pim/viewEmployeeList',
    );
    expect(calls.some((call) => call.method === 'fill' && call.value === 'Grace')).toBe(true);
    expect(calls.some((call) => call.method === 'fill' && call.value === 'E-100')).toBe(true);
  });

  test('covers leave application and system-user creation workflows', async () => {
    const { page, calls } = mockPage();
    const ui = createUi(page, 'http://orangehrm.test');

    await ui.pages.leave.goto();
    expect(await ui.pages.leave.rowCount()).toBe(1);
    expect(await ui.pages.leave.hasRow('Annual Leave')).toBe(true);
    await ui.pages.leave.applyLeave({
      leaveType: 'US - Personal',
      fromDate: '2026-10-06',
      toDate: '2026-10-07',
      comment: 'Appointment',
    });
    await applyLeave(page, 'http://orangehrm.test', {
      leaveType: 'US - Personal',
      fromDate: '2026-10-08',
      toDate: '2026-10-08',
    });

    await ui.pages.users.goto();
    expect(await ui.pages.users.rowCount()).toBe(1);
    expect(await ui.pages.users.hasRow('ada')).toBe(true);
    await ui.pages.users.searchByUsername('ada');
    await createUser(page, 'http://orangehrm.test', {
      username: 'ada.test',
      role: 'ESS',
      employeeName: 'Ada Lovelace',
      password: 'test-password',
    });

    expect(calls.some((call) => call.method === 'fill' && call.value === 'Appointment')).toBe(true);
    expect(calls.some((call) => call.method === 'fill' && call.value === 'ada.test')).toBe(true);
    expect(calls.some((call) => call.method === 'fill' && call.value === '2026-10-08')).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.method === 'waitFor' &&
          call.selector.includes(SELECTORS.toastSuccess) &&
          call.options.state === 'visible',
      ),
    ).toBe(true);
  });
});
