const { BasePage } = require('../base-page');
const { OxdTable } = require('../components/oxd-table');
const { OxdForm } = require('../components/oxd-form');
const { OxdSelect } = require('../components/oxd-select');

class AdminUsersPage extends BasePage {
  constructor(page, baseUrl) {
    super(page, baseUrl);
    this.table = new OxdTable(page);
    this.form = new OxdForm(page);
    this.select = new OxdSelect(page);
  }

  async goto() {
    await super.goto('/web/index.php/admin/viewSystemUsers');
  }

  async searchByUsername(username) {
    await this.form.fillByLabel('Username', username);
    await this.page.getByRole('button', { name: 'Search', exact: true }).click();
    await this.table.waitForLoad();
  }

  async addUser() {
    await this.page.getByRole('button', { name: /Add/i }).click();
    await this.page.waitForLoadState('domcontentloaded');
    await this.waitForReady();
  }

  async createUser({ username, role, employeeName, status = 'Enabled', password }) {
    await this.addUser();
    await this.select.select('User Role', role);
    await this.select.autocomplete('Employee Name', employeeName, employeeName);
    await this.select.select('Status', status);
    await this.form.fillByLabel('Username', username);
    await this.form.fillByLabel('Password', password);
    await this.form.fillByLabel('Confirm Password', password);
    await this.form.submit();
    await this.form.waitForLoad();
  }

  async rowCount() {
    return this.table.rowCount();
  }

  async hasRow(text) {
    return (await this.table.rowByText(text).count()) > 0;
  }

  async hasAddButton() {
    return (await this.page.getByRole('button', { name: /Add/i }).count()) > 0;
  }
}

module.exports = { AdminUsersPage };
