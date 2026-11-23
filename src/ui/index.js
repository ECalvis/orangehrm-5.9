const { BasePage } = require('./base-page');
const { OxdForm } = require('./components/oxd-form');
const { OxdSelect } = require('./components/oxd-select');
const { OxdTable } = require('./components/oxd-table');
const { OxdDatePicker } = require('./components/oxd-date-picker');
const { OxdDialog } = require('./components/oxd-dialog');
const { OxdToast } = require('./components/oxd-toast');

const { LoginPage } = require('./pages/login-page');
const { DashboardPage } = require('./pages/dashboard-page');
const { EmployeeListPage } = require('./pages/employee-list-page');
const { AddEmployeePage } = require('./pages/add-employee-page');
const { EmployeePersonalDetailsPage } = require('./pages/employee-personal-details-page');
const { AttendancePage } = require('./pages/attendance-page');
const { LeaveListPage } = require('./pages/leave-list-page');
const { AdminUsersPage } = require('./pages/admin-users-page');
const { TimesheetPage } = require('./pages/timesheet-page');

function createUi(page, baseUrl) {
  return {
    base: new BasePage(page, baseUrl),
    components: {
      form: new OxdForm(page),
      select: new OxdSelect(page),
      table: new OxdTable(page),
      date: new OxdDatePicker(page),
      dialog: new OxdDialog(page),
      toast: new OxdToast(page),
    },
    pages: {
      login: new LoginPage(page, baseUrl),
      dashboard: new DashboardPage(page, baseUrl),
      employees: new EmployeeListPage(page, baseUrl),
      addEmployee: new AddEmployeePage(page, baseUrl),
      employeePersonalDetails: new EmployeePersonalDetailsPage(page, baseUrl),
      attendance: new AttendancePage(page, baseUrl),
      leave: new LeaveListPage(page, baseUrl),
      users: new AdminUsersPage(page, baseUrl),
      timesheets: new TimesheetPage(page, baseUrl),
    },
  };
}

module.exports = { createUi };
