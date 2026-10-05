const { BasePage } = require('../base-page');
const { OxdForm } = require('../components/oxd-form');

class AddEmployeePage extends BasePage {
  constructor(page, baseUrl) {
    super(page, baseUrl);
    this.form = new OxdForm(page);
  }

  async goto() {
    await super.goto('/web/index.php/pim/addEmployee');
  }

  async fill({ firstName, lastName, middleName = '', employeeId }) {
    await this.form.fillByLabel('First Name', firstName);
    await this.form.fillByLabel('Middle Name', middleName);
    await this.form.fillByLabel('Last Name', lastName);
    if (employeeId !== undefined) {
      await this.form.fillByLabel('Employee Id', String(employeeId));
    }
  }

  async save() {
    await this.form.submit();
    await this.form.waitForLoad();
  }
}

module.exports = { AddEmployeePage };
