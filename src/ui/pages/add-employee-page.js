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
    const nameGroup = this.form.group('Employee Full Name');
    await nameGroup.getByPlaceholder('First Name').fill(firstName);
    await nameGroup.getByPlaceholder('Middle Name').fill(middleName);
    await nameGroup.getByPlaceholder('Last Name').fill(lastName);
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
