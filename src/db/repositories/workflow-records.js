class WorkflowRecordsRepository {
  constructor(client) {
    this.client = client;
  }

  async findLeaveTypeById(id) {
    return this.client.selectOne(
      `SELECT id, name, deleted
         FROM ohrm_leave_type
        WHERE id = ?`,
      [id],
    );
  }

  async findLeaveEntitlementById(id) {
    return this.client.selectOne(
      `SELECT id, emp_number, leave_type_id, no_of_days, days_used,
              from_date, to_date, note, deleted
         FROM ohrm_leave_entitlement
        WHERE id = ?`,
      [id],
    );
  }

  async findLeaveRequestById(id) {
    return this.client.selectOne(
      `SELECT lr.id, lr.emp_number, lr.leave_type_id,
              MIN(l.date) AS from_date, MAX(l.date) AS to_date,
              GROUP_CONCAT(DISTINCT l.status ORDER BY l.status) AS status_codes
         FROM ohrm_leave_request lr
         LEFT JOIN ohrm_leave l ON l.leave_request_id = lr.id
        WHERE lr.id = ?
        GROUP BY lr.id, lr.emp_number, lr.leave_type_id`,
      [id],
    );
  }

  async findLeaveRequestForEmployee({ empNumber, leaveTypeId, fromDate, toDate }) {
    return this.client.selectOne(
      `SELECT lr.id, lr.emp_number, lr.leave_type_id,
              MIN(l.date) AS from_date, MAX(l.date) AS to_date,
              GROUP_CONCAT(DISTINCT l.status ORDER BY l.status) AS status_codes
         FROM ohrm_leave_request lr
         JOIN ohrm_leave l ON l.leave_request_id = lr.id
        WHERE lr.emp_number = ?
          AND lr.leave_type_id = ?
          AND l.date BETWEEN ? AND ?
        GROUP BY lr.id, lr.emp_number, lr.leave_type_id
        ORDER BY lr.id DESC
        LIMIT 1`,
      [empNumber, leaveTypeId, fromDate, toDate],
    );
  }

  async findAttendanceRecordById(id) {
    return this.client.selectOne(
      `SELECT id, employee_id, state,
              punch_in_utc_time, punch_in_user_time, punch_in_note,
              punch_in_timezone_name, punch_out_utc_time, punch_out_user_time,
              punch_out_note, punch_out_timezone_name
         FROM ohrm_attendance_record
        WHERE id = ?`,
      [id],
    );
  }

  async findTimesheetById(id) {
    return this.client.selectOne(
      `SELECT timesheet_id, employee_id, state, start_date, end_date
         FROM ohrm_timesheet
        WHERE timesheet_id = ?`,
      [id],
    );
  }

  async findTimesheetItems(timesheetId) {
    return this.client.select(
      `SELECT timesheet_item_id, timesheet_id, employee_id, project_id,
              activity_id, date, duration, comment
         FROM ohrm_timesheet_item
        WHERE timesheet_id = ?
        ORDER BY date, timesheet_item_id`,
      [timesheetId],
    );
  }

  async findTimesheetActionLogs(timesheetId) {
    return this.client.select(
      `SELECT timesheet_action_log_id, action, comment, date_time
         FROM ohrm_timesheet_action_log
        WHERE timesheet_id = ?
        ORDER BY date_time, timesheet_action_log_id`,
      [timesheetId],
    );
  }

  async findUserById(id) {
    return this.client.selectOne(
      `SELECT id, emp_number, user_name, user_role_id, status, deleted
         FROM ohrm_user
        WHERE id = ?`,
      [id],
    );
  }

  async findUserByUsername(username) {
    return this.client.selectOne(
      `SELECT id, emp_number, user_name, user_role_id, status, deleted
         FROM ohrm_user
        WHERE user_name = ?`,
      [username],
    );
  }
}

module.exports = { WorkflowRecordsRepository };
