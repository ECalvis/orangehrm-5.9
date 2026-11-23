const { BasePage } = require('../base-page');
const { OxdSelect } = require('../components/oxd-select');

class TimesheetPage extends BasePage {
  constructor(page, baseUrl) {
    super(page, baseUrl);
    this.select = new OxdSelect(page);
  }

  async gotoEmployeeTimesheets() {
    await super.goto('/web/index.php/time/viewEmployeeTimesheet');
  }

  async viewEmployee(name) {
    await this.select.autocomplete('Employee Name', name, name);
    await this.page
      .locator('form')
      .getByRole('button', { name: 'View', exact: true })
      .click();
    await this.page.getByRole('heading', { name: /Timesheet for/i }).waitFor({ state: 'visible' });
  }

  async waitForAction(action, comment) {
    const matchingRows = this.page.getByRole('row').filter({ hasText: action });
    const row = comment ? matchingRows.filter({ hasText: comment }) : matchingRows;
    await row.first().waitFor({ state: 'visible' });
  }
}

module.exports = { TimesheetPage };
