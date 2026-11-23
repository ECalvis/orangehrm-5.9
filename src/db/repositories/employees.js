class EmployeesRepository {
  constructor(client) {
    this.client = client;
  }

  async findById(empNumber) {
    return this.client.selectOne(
      `SELECT emp_number, employee_id, emp_firstname, emp_lastname,
              emp_middle_name, termination_id, purged_at
         FROM hs_hr_employee
        WHERE emp_number = ?`,
      [empNumber],
    );
  }

  async findByEmployeeId(employeeId) {
    return this.client.selectOne(
      `SELECT emp_number, employee_id, emp_firstname, emp_lastname
         FROM hs_hr_employee
        WHERE employee_id = ? AND purged_at IS NULL`,
      [employeeId],
    );
  }

  async countAll() {
    return this.client.selectValue(
      'SELECT COUNT(*) AS n FROM hs_hr_employee WHERE purged_at IS NULL',
    );
  }

  async findOrphanedTimesheets(empNumber) {
    return this.client.select(
      `SELECT timesheet_id, employee_id, state
         FROM ohrm_timesheet
        WHERE employee_id = ?
          AND employee_id NOT IN (SELECT emp_number FROM hs_hr_employee)`,
      [empNumber],
    );
  }
}

module.exports = { EmployeesRepository };
