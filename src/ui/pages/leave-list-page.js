const { BasePage } = require('../base-page');
const { OxdTable } = require('../components/oxd-table');
const { OxdForm } = require('../components/oxd-form');
const { OxdSelect } = require('../components/oxd-select');
const { OxdDatePicker } = require('../components/oxd-date-picker');
const { OxdToast } = require('../components/oxd-toast');

class LeaveListPage extends BasePage {
  constructor(page, baseUrl) {
    super(page, baseUrl);
    this.table = new OxdTable(page);
    this.form = new OxdForm(page);
    this.select = new OxdSelect(page);
    this.date = new OxdDatePicker(page);
    this.toast = new OxdToast(page);
  }

  async goto() {
    await super.goto('/web/index.php/leave/viewLeaveList');
  }

  async applyLeave({ leaveType, fromDate, toDate, comment = '' }) {
    await super.goto('/web/index.php/leave/applyLeave');
    await this.form.waitForLoad();
    await this.select.select('Leave Type', leaveType);
    await this.form.waitForLoad();
    await this.date.set('From Date', fromDate);
    await this.date.set('To Date', toDate);
    if (comment) {
      await this.form.fillByLabel('Comments', comment);
    }
    await this.page.getByRole('button', { name: 'Apply', exact: true }).click();
    await this.form.waitForLoad();
    await this.toast.waitForSuccess();
  }

  async rowCount() {
    return this.table.rowCount();
  }

  async hasRow(text) {
    return (await this.table.rowByText(text).count()) > 0;
  }
}

module.exports = { LeaveListPage };
