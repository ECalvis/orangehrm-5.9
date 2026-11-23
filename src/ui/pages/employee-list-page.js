const { BasePage } = require('../base-page');
const { OxdTable } = require('../components/oxd-table');
const { OxdDialog } = require('../components/oxd-dialog');
const { OxdToast } = require('../components/oxd-toast');
const { OxdForm } = require('../components/oxd-form');

class EmployeeListPage extends BasePage {
  constructor(page, baseUrl) {
    super(page, baseUrl);
    this.table = new OxdTable(page);
    this.dialog = new OxdDialog(page);
    this.toast = new OxdToast(page);
    this.form = new OxdForm(page);
  }

  async goto() {
    await super.goto('/web/index.php/pim/viewEmployeeList');
  }

  async addEmployee() {
    await this.page.getByRole('button', { name: /Add/i }).click();
    await this.page.waitForLoadState('domcontentloaded');
    await this.waitForReady();
  }

  async searchByName(name) {
    await this.form.fillByLabel('Employee Name', name);
    await this.page.getByRole('button', { name: 'Search', exact: true }).click();
    await this.table.waitForLoad();
  }

  async deleteEmployeeByName(name) {
    await this.table.clickAction(name, 'trash');
    await this.dialog.waitFor();
    await this.dialog.confirm();
    await this.toast.waitForSuccess();
  }

  async rowCount() {
    return this.table.rowCount();
  }

  async hasRow(text) {
    return (await this.table.rowByText(text).count()) > 0;
  }
}

module.exports = { EmployeeListPage };
