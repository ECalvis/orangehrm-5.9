const { terminateOwnedEmployee } = require('./terminate-employee');

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function durationInSeconds(duration) {
  if (typeof duration !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(duration)) {
    return null;
  }
  const [hours, minutes] = duration.split(':').map(Number);
  const seconds = hours * 3600 + minutes * 60;
  return seconds > 0 ? seconds : null;
}

function assertCollaborators({ api, db, ui, requireUi = true }) {
  for (const [label, operation] of [
    ['api.pim.employees.create', api?.pim?.employees?.create],
    ['api.time.customers.create', api?.time?.customers?.create],
    ['api.time.projects.create', api?.time?.projects?.create],
    ['api.time.projectActivities.create', api?.time?.projectActivities?.create],
    ['api.time.employeeTimesheets.create', api?.time?.employeeTimesheets?.create],
    ['api.time.employeeTimesheetEntries.update', api?.time?.employeeTimesheetEntries?.update],
    ['api.time.employeeTimesheet.update', api?.time?.employeeTimesheet?.update],
    ['api.time.employeeTimesheetEntries.list', api?.time?.employeeTimesheetEntries?.list],
    ['api.time.timesheetActionLogs.list', api?.time?.timesheetActionLogs?.list],
    ['db.employees.findById', db?.employees?.findById],
    ['db.employees.findByEmployeeId', db?.employees?.findByEmployeeId],
    ['db.workflowRecords.findTimesheetById', db?.workflowRecords?.findTimesheetById],
    ['db.workflowRecords.findTimesheetItems', db?.workflowRecords?.findTimesheetItems],
    ['db.workflowRecords.findTimesheetActionLogs', db?.workflowRecords?.findTimesheetActionLogs],
  ]) {
    if (typeof operation !== 'function') {
      throw new TypeError(`${label} is required`);
    }
  }
  if (requireUi) {
    for (const [label, operation] of [
      ['ui.pages.login.loginAs', ui?.pages?.login?.loginAs],
      ['ui.pages.timesheets.gotoEmployeeTimesheets', ui?.pages?.timesheets?.gotoEmployeeTimesheets],
      ['ui.pages.timesheets.viewEmployee', ui?.pages?.timesheets?.viewEmployee],
      ['ui.pages.timesheets.waitForAction', ui?.pages?.timesheets?.waitForAction],
    ]) {
      if (typeof operation !== 'function') {
        throw new TypeError(`${label} is required`);
      }
    }
  }
}

function assertInputs({ employee, owner, date, duration }) {
  if (
    !employee ||
    typeof employee.firstName !== 'string' ||
    typeof employee.lastName !== 'string' ||
    typeof employee.employeeId !== 'string' ||
    !employee.employeeId.trim()
  ) {
    throw new TypeError('Employee name and unique employee ID are required');
  }
  if (typeof owner !== 'string' || !owner.trim()) {
    throw new TypeError('A test owner identifier is required');
  }
  if (!isDate(date)) {
    throw new TypeError('A valid timesheet date is required');
  }
  if (durationInSeconds(duration) == null) {
    throw new TypeError('Duration must be between 00:01 and 23:59');
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
    throw new Error('Test employee was not persisted before creating the timesheet');
  }
}

function assertEntry(actual, expected) {
  const dateEntry = actual?.dates?.[expected.date];
  if (
    !actual ||
    Number(actual.project?.id) !== Number(expected.projectId) ||
    Number(actual.activity?.id) !== Number(expected.activityId) ||
    dateEntry?.duration !== expected.duration
  ) {
    throw new Error('Timesheet API did not return the test-owned project activity and duration');
  }
}

function assertActionLogs(logs, expectedActions) {
  const actions = Array.isArray(logs?.data) ? logs.data : [];
  for (const expected of expectedActions) {
    if (
      !actions.some(
        (log) => log?.action?.name === expected.action && log.comment === expected.comment,
      )
    ) {
      throw new Error(`Timesheet action ${expected.action} was not verified through the API`);
    }
  }
}

function withTestRecord(error, record) {
  const failure = new Error(
    `Timesheet workflow failed; test-owned records are retained for follow-up. ` +
      `${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
  failure.testRecord = record;
  return failure;
}

async function createTimesheetLifecycle({
  api,
  db,
  ui,
  employee,
  owner,
  date,
  duration = '01:00',
}) {
  assertCollaborators({ api, db, ui });
  assertInputs({ employee, owner, date, duration });

  const record = {
    owner,
    empNumber: null,
    employeeId: employee.employeeId,
    customerId: null,
    projectId: null,
    activityId: null,
    timesheetId: null,
    date,
    duration,
    retained: true,
  };
  const suffix = employee.employeeId;
  const customerName = `QA Timesheet Customer ${suffix}`;
  const projectName = `QA Timesheet Project ${suffix}`;
  const activityName = `QA Timesheet Activity ${suffix}`;

  try {
    let employeeResult;
    try {
      employeeResult = await api.pim.employees.create(employee);
    } catch (createError) {
      try {
        const persistedEmployee = await db.employees.findByEmployeeId(employee.employeeId);
        if (persistedEmployee?.employee_id === employee.employeeId) {
          record.empNumber = persistedEmployee.emp_number;
        }
      } catch (recoveryError) {
        // eslint-disable-next-line preserve-caught-error
        throw new AggregateError(
          [createError, recoveryError],
          'Employee creation failed and ownership recovery also failed',
        );
      }
      throw createError;
    }
    record.empNumber = employeeResult?.data?.empNumber;
    if (record.empNumber == null || String(record.empNumber) === '') {
      const persistedEmployee = await db.employees.findByEmployeeId(employee.employeeId);
      record.empNumber = persistedEmployee?.emp_number ?? null;
      if (record.empNumber == null) {
        throw new Error('Employee create response did not contain data.empNumber');
      }
    }
    assertEmployee(await db.employees.findById(record.empNumber), employee);

    const customer = await api.time.customers.create({
      name: customerName,
      description: owner,
    });
    record.customerId = customer?.data?.id;
    if (record.customerId == null) {
      throw new Error('Customer create response did not contain data.id');
    }

    const project = await api.time.projects.create({
      name: projectName,
      description: owner,
      customerId: record.customerId,
    });
    record.projectId = project?.data?.id;
    if (record.projectId == null) {
      throw new Error('Project create response did not contain data.id');
    }

    const activity = await api.time.projectActivities.create({
      pathParams: { projectId: record.projectId },
      data: { name: activityName },
    });
    record.activityId = activity?.data?.id;
    if (record.activityId == null) {
      throw new Error('Project activity create response did not contain data.id');
    }

    const timesheet = await api.time.employeeTimesheets.create({
      pathParams: { empNumber: record.empNumber },
      data: { date },
    });
    record.timesheetId = timesheet?.data?.id;
    if (record.timesheetId == null) {
      throw new Error('Timesheet create response did not contain data.id');
    }

    await api.time.employeeTimesheetEntries.update({
      pathParams: { timesheetId: record.timesheetId },
      data: {
        entries: [
          {
            projectId: record.projectId,
            activityId: record.activityId,
            dates: { [date]: { duration } },
          },
        ],
      },
    });

    const entries = await api.time.employeeTimesheetEntries.list({
      pathParams: { timesheetId: record.timesheetId },
    });
    const apiEntry = Array.isArray(entries?.data) ? entries.data[0] : null;
    assertEntry(apiEntry, {
      projectId: record.projectId,
      activityId: record.activityId,
      date,
      duration,
    });

    const item = (await db.workflowRecords.findTimesheetItems(record.timesheetId))[0];
    if (
      !item ||
      Number(item.employee_id) !== Number(record.empNumber) ||
      Number(item.project_id) !== Number(record.projectId) ||
      Number(item.activity_id) !== Number(record.activityId) ||
      (item.date instanceof Date
        ? item.date.toISOString().slice(0, 10)
        : String(item.date).slice(0, 10)) !== date ||
      Number(item.duration) !== durationInSeconds(duration)
    ) {
      throw new Error(
        'Timesheet entry was not persisted with the expected owner, date and duration',
      );
    }

    const submittedComment = `${owner}: submit`;
    await api.time.employeeTimesheet.update({
      pathParams: { empNumber: record.empNumber, id: record.timesheetId },
      data: { action: 'SUBMIT', comment: submittedComment },
    });
    const submittedLogs = await api.time.timesheetActionLogs.list({
      pathParams: { timesheetId: record.timesheetId },
    });
    assertActionLogs(submittedLogs, [{ action: 'SUBMITTED', comment: submittedComment }]);

    await ui.pages.login.loginAs('admin');
    await ui.pages.timesheets.gotoEmployeeTimesheets();
    await ui.pages.timesheets.viewEmployee(`${employee.firstName} ${employee.lastName}`);
    await ui.pages.timesheets.waitForAction('Submitted', submittedComment);

    const approvedComment = `${owner}: approve`;
    await api.time.employeeTimesheet.update({
      pathParams: { empNumber: record.empNumber, id: record.timesheetId },
      data: { action: 'APPROVE', comment: approvedComment },
    });

    const [persistedTimesheet, persistedItems, persistedLogs, approvedLogs] = await Promise.all([
      db.workflowRecords.findTimesheetById(record.timesheetId),
      db.workflowRecords.findTimesheetItems(record.timesheetId),
      db.workflowRecords.findTimesheetActionLogs(record.timesheetId),
      api.time.timesheetActionLogs.list({ pathParams: { timesheetId: record.timesheetId } }),
    ]);
    assertActionLogs(approvedLogs, [
      { action: 'SUBMITTED', comment: submittedComment },
      { action: 'APPROVED', comment: approvedComment },
    ]);
    if (
      !persistedTimesheet ||
      Number(persistedTimesheet.employee_id) !== Number(record.empNumber) ||
      persistedTimesheet.state !== 'APPROVED' ||
      !persistedItems.some(
        (persistedItem) =>
          Number(persistedItem.project_id) === Number(record.projectId) &&
          Number(persistedItem.activity_id) === Number(record.activityId) &&
          Number(persistedItem.duration) === durationInSeconds(duration),
      ) ||
      !persistedLogs.some(
        (log) => log.action === 'SUBMITTED' && log.comment === submittedComment,
      ) ||
      !persistedLogs.some((log) => log.action === 'APPROVED' && log.comment === approvedComment)
    ) {
      throw new Error('Approved timesheet state, entry or action history was not persisted');
    }

    await ui.pages.timesheets.gotoEmployeeTimesheets();
    await ui.pages.timesheets.viewEmployee(`${employee.firstName} ${employee.lastName}`);
    await ui.pages.timesheets.waitForAction('Approved', approvedComment);

    return {
      ...record,
      customerName,
      projectName,
      activityName,
      state: 'APPROVED',
      actions: ['SUBMITTED', 'APPROVED'],
    };
  } catch (error) {
    throw withTestRecord(error, {
      ...record,
      customerName,
      projectName,
      activityName,
    });
  }
}

async function cleanupTimesheetLifecycle({ api, db, record }) {
  if (
    !record ||
    typeof record.owner !== 'string' ||
    !record.owner.trim() ||
    typeof record.employeeId !== 'string' ||
    !record.employeeId.trim()
  ) {
    throw new TypeError('A test-owned timesheet record is required');
  }
  for (const [label, operation] of [
    ['api.pim.terminationReasons.list', api?.pim?.terminationReasons?.list],
    ['api.pim.employeeTerminations.create', api?.pim?.employeeTerminations?.create],
    ['api.pim.employees.get', api?.pim?.employees?.get],
    ['db.employees.findById', db?.employees?.findById],
    ['db.employees.findByEmployeeId', db?.employees?.findByEmployeeId],
    ['db.workflowRecords.findTimesheetById', db?.workflowRecords?.findTimesheetById],
  ]) {
    if (typeof operation !== 'function') {
      throw new TypeError(`${label} is required`);
    }
  }

  let empNumber = record.empNumber;
  if (empNumber == null) {
    const employee = await db.employees.findByEmployeeId(record.employeeId);
    if (!employee || employee.employee_id !== record.employeeId) {
      return { owner: record.owner, state: 'retained', employeeTerminated: false };
    }
    empNumber = employee.emp_number;
  }

  if (record.timesheetId != null) {
    const timesheet = await db.workflowRecords.findTimesheetById(record.timesheetId);
    if (timesheet && Number(timesheet.employee_id) !== Number(empNumber)) {
      throw new Error('Ownership check failed; refusing to terminate an unrelated timesheet owner');
    }
  }

  const termination = await terminateOwnedEmployee({
    api,
    db,
    empNumber,
    employeeId: record.employeeId,
    owner: record.owner,
  });
  const retainedTimesheet = record.timesheetId
    ? await db.workflowRecords.findTimesheetById(record.timesheetId)
    : null;
  if (
    record.timesheetId != null &&
    (!retainedTimesheet || Number(retainedTimesheet.employee_id) !== Number(empNumber))
  ) {
    throw new Error(
      `Timesheet history could not be verified after employee termination; timesheet ${record.timesheetId} was retained`,
    );
  }

  return {
    owner: record.owner,
    employeeTerminated: true,
    terminationId: termination.terminationId,
    timesheetId: record.timesheetId,
    timesheetState: retainedTimesheet?.state ?? null,
    retained: true,
  };
}

module.exports = {
  createTimesheetLifecycle,
  cleanupTimesheetLifecycle,
  durationInSeconds,
};
