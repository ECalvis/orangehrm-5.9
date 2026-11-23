const { BasePage } = require('../base-page');
const { OxdForm } = require('../components/oxd-form');
const { OxdToast } = require('../components/oxd-toast');

class EmployeePersonalDetailsPage extends BasePage {
  constructor(page, baseUrl) {
    super(page, baseUrl);
    this.form = new OxdForm(page);
    this.toast = new OxdToast(page);
  }

  async goto(empNumber) {
    if (empNumber == null || String(empNumber) === '') {
      throw new TypeError('An employee number is required');
    }

    await super.goto(
      `/web/index.php/pim/viewPersonalDetails/empNumber/${encodeURIComponent(String(empNumber))}`,
    );
    await this.form.waitForLoad();
  }

  async updateMiddleName(middleName) {
    if (typeof middleName !== 'string') {
      throw new TypeError('Middle name must be a string');
    }

    await this.page.getByPlaceholder('Middle Name', { exact: true }).fill(middleName);
    await this.form.submit();
    await this.form.waitForLoad();
    await this.toast.waitForSuccess();
  }
}

module.exports = { EmployeePersonalDetailsPage };
