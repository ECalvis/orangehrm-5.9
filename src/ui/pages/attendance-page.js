const { BasePage } = require('../base-page');
const { SELECTORS } = require('../selectors');
const { OxdTable } = require('../components/oxd-table');

class AttendancePage extends BasePage {
  constructor(page, baseUrl) {
    super(page, baseUrl);
    this.table = new OxdTable(page);
  }

  async goto() {
    await super.goto('/web/index.php/attendance/viewAttendanceRecord');
    await this.table.waitForLoad();
  }

  async hasRow(text) {
    return (
      (await this.page
        .locator(SELECTORS.cardTableRow)
        .filter({ hasText: text })
        .count()) > 0
    );
  }
}

module.exports = { AttendancePage };
