const { EmployeeListPage } = require('../pages/employee-list-page');
const { AddEmployeePage } = require('../pages/add-employee-page');
const { OxdToast } = require('../components/oxd-toast');

async function createEmployee(page, baseUrl, employee) {
  const list = new EmployeeListPage(page, baseUrl);
  const toast = new OxdToast(page);

  await list.goto();
  await list.addEmployee();

  const form = new AddEmployeePage(page, baseUrl);
  await form.fill(employee);
  await form.save();
  await toast.waitForSuccess();
}

module.exports = { createEmployee };
