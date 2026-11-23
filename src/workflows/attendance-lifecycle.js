function assertCollaborators({ api, db, ui }) {
  for (const [label, operation] of [
    ['api.pim.employees.create', api?.pim?.employees?.create],
    ['api.attendance.employeeRecords.create', api?.attendance?.employeeRecords?.create],
    ['api.attendance.employeeRecords.update', api?.attendance?.employeeRecords?.update],
    ['api.attendance.record.get', api?.attendance?.record?.get],
    ['db.employees.findById', db?.employees?.findById],
    ['db.workflowRecords.findAttendanceRecordById', db?.workflowRecords?.findAttendanceRecordById],
    ['ui.pages.login.loginAs', ui?.pages?.login?.loginAs],
    ['ui.pages.attendance.goto', ui?.pages?.attendance?.goto],
    ['ui.pages.attendance.hasRow', ui?.pages?.attendance?.hasRow],
  ]) {
    if (typeof operation !== 'function') {
      throw new TypeError(`${label} is required`);
    }
  }
}

function assertInputs({ employee, owner, date, punchInTime, punchOutTime, timezoneName, timezoneOffset }) {
  if (
    !employee ||
    typeof employee.firstName !== 'string' ||
    typeof employee.lastName !== 'string' ||
    typeof employee.employeeId !== 'string'
  ) {
    throw new TypeError('Employee name and unique employee ID are required');
  }
  if (typeof owner !== 'string' || !owner.trim()) {
    throw new TypeError('A test owner identifier is required');
  }
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof punchInTime !== 'string' ||
    !/^\d{2}:\d{2}$/.test(punchInTime) ||
    typeof punchOutTime !== 'string' ||
    !/^\d{2}:\d{2}$/.test(punchOutTime) ||
    punchOutTime <= punchInTime
  ) {
    throw new TypeError('A valid date and ordered punch-in/punch-out times are required');
  }
  if (
    typeof timezoneName !== 'string' ||
    !timezoneName.trim() ||
    typeof timezoneOffset !== 'string' ||
    !/^[+-]?\d{1,2}(?:\.\d+)?$/.test(timezoneOffset)
  ) {
    throw new TypeError('A valid attendance timezone name and offset are required');
  }
}

function assertEmployee(actual, expected) {
  if (
    !actual ||
    actual.employee_id !== expected.employeeId ||
    actual.emp_firstname !== expected.firstName ||
    actual.emp_lastname !== expected.lastName ||
    actual.purged_at != null
  ) {
    throw new Error('Test employee was not persisted before attendance was recorded');
  }
}

function assertAttendance(actual, expected) {
  if (
    !actual ||
    Number(actual.employee_id) !== expected.empNumber ||
    actual.state !== 'PUNCHED OUT' ||
    !actual.punch_in_utc_time ||
    !actual.punch_out_utc_time ||
    actual.punch_in_note !== expected.owner ||
    actual.punch_out_note !== expected.owner ||
    actual.punch_in_timezone_name !== expected.timezoneName ||
    actual.punch_out_timezone_name !== expected.timezoneName
  ) {
    throw new Error('Punch-in and punch-out were not persisted as one owned attendance record');
  }
}

function withTestRecord(error, record) {
  const details =
    error && typeof error === 'object' && error.data != null
      ? ` Response details: ${JSON.stringify(error.data)}.`
      : '';
  const failure = new Error(
    `Attendance workflow failed; test-owned employee ${record.employeeId} was retained. ` +
      `${error instanceof Error ? error.message : String(error)}.${details}`,
    { cause: error },
  );
  failure.testRecord = record;
  return failure;
}

async function createAttendanceLifecycle({
  api,
  db,
  ui,
  employee,
  owner,
  date,
  punchInTime,
  punchOutTime,
  timezoneName,
  timezoneOffset,
}) {
  assertCollaborators({ api, db, ui });
  assertInputs({ employee, owner, date, punchInTime, punchOutTime, timezoneName, timezoneOffset });

  const record = { owner, empNumber: null, employeeId: employee.employeeId, attendanceId: null };
  try {
    const employeeResult = await api.pim.employees.create(employee);
    record.empNumber = employeeResult?.data?.empNumber;
    if (record.empNumber == null) {
      throw new Error('Employee create response did not contain data.empNumber');
    }

    assertEmployee(await db.employees.findById(record.empNumber), employee);

    const attendanceInput = {
      date,
      time: punchInTime,
      timezoneOffset,
      timezoneName,
      note: owner,
    };
    const created = await api.attendance.employeeRecords.create({
      pathParams: { empNumber: record.empNumber },
      data: attendanceInput,
    });
    record.attendanceId = created?.data?.id;
    if (record.attendanceId == null) {
      throw new Error('Punch-in response did not contain data.id');
    }

    await api.attendance.employeeRecords.update({
      pathParams: { empNumber: record.empNumber },
      data: { ...attendanceInput, time: punchOutTime },
    });

    const [apiRecord, persisted] = await Promise.all([
      api.attendance.record.get(record.attendanceId),
      db.workflowRecords.findAttendanceRecordById(record.attendanceId),
    ]);
    assertAttendance(persisted, {
      empNumber: record.empNumber,
      owner,
      timezoneName,
    });
    if (
      Number(apiRecord?.data?.id) !== Number(record.attendanceId) ||
      apiRecord?.data?.state?.name?.toUpperCase() !== 'PUNCHED OUT'
    ) {
      throw new Error(
        `Attendance API returned id ${apiRecord?.data?.id} and state ` +
          `${apiRecord?.data?.state?.name}; expected id ${record.attendanceId} and state PUNCHED OUT`,
      );
    }

    await ui.pages.login.loginAs('admin');
    await ui.pages.attendance.goto();
    if (!(await ui.pages.attendance.hasRow(`${employee.firstName} ${employee.lastName}`))) {
      throw new Error('Test employee was not visible in the Admin Attendance records list');
    }

    return {
      ...record,
      state: 'PUNCHED OUT',
      date,
      punchInTime,
      punchOutTime,
      timezoneName,
    };
  } catch (error) {
    throw withTestRecord(error, record);
  }
}

module.exports = { createAttendanceLifecycle };
