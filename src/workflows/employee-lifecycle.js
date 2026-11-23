function assertDbEmployeeMatches(actual, expected, middleName) {
  if (
    !actual ||
    actual.emp_number == null ||
    actual.employee_id !== expected.employeeId ||
    actual.emp_firstname !== expected.firstName ||
    actual.emp_lastname !== expected.lastName ||
    (actual.emp_middle_name ?? '') !== middleName ||
    actual.purged_at != null
  ) {
    throw new Error('Employee data did not match the expected persisted values');
  }
}

function assertApiEmployeeMatches(actual, expected, middleName) {
  if (
    !actual ||
    actual.empNumber == null ||
    actual.employeeId !== expected.employeeId ||
    actual.firstName !== expected.firstName ||
    actual.lastName !== expected.lastName ||
    (actual.middleName ?? '') !== middleName
  ) {
    throw new Error('Employee API data did not match the expected values');
  }
}

function assertCollaborators({ api, db, ui, employee, owner, updatedMiddleName }) {
  if (typeof api?.pim?.employees?.create !== 'function') {
    throw new TypeError('api.pim.employees.create is required');
  }
  if (typeof api?.pim?.employees?.get !== 'function') {
    throw new TypeError('api.pim.employees.get is required');
  }
  if (typeof db?.employees?.findById !== 'function') {
    throw new TypeError('db.employees.findById is required');
  }
  if (typeof ui?.pages?.employees?.goto !== 'function') {
    throw new TypeError('ui.pages.employees.goto is required');
  }
  if (typeof ui?.pages?.login?.loginAs !== 'function') {
    throw new TypeError('ui.pages.login.loginAs is required');
  }
  if (typeof ui?.pages?.employees?.searchByName !== 'function') {
    throw new TypeError('ui.pages.employees.searchByName is required');
  }
  if (typeof ui?.pages?.employees?.hasRow !== 'function') {
    throw new TypeError('ui.pages.employees.hasRow is required');
  }
  if (typeof ui?.pages?.employeePersonalDetails?.goto !== 'function') {
    throw new TypeError('ui.pages.employeePersonalDetails.goto is required');
  }
  if (typeof ui?.pages?.employeePersonalDetails?.updateMiddleName !== 'function') {
    throw new TypeError('ui.pages.employeePersonalDetails.updateMiddleName is required');
  }
  if (
    !employee ||
    typeof employee.firstName !== 'string' ||
    typeof employee.lastName !== 'string' ||
    typeof employee.employeeId !== 'string'
  ) {
    throw new TypeError('Employee firstName, lastName, and employeeId are required');
  }
  if (typeof owner !== 'string' || !owner.trim()) {
    throw new TypeError('A test owner identifier is required');
  }
  if (typeof updatedMiddleName !== 'string' || updatedMiddleName === (employee.middleName ?? '')) {
    throw new TypeError('updatedMiddleName must differ from the employee middle name');
  }
}

function withCreatedEmployee(error, testRecord) {
  const failure = new Error(
    `Employee workflow failed; test-owned employee ${testRecord.empNumber} was retained. ` +
      `${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
  failure.testRecord = testRecord;
  return failure;
}

async function createEmployeeLifecycle({ api, db, ui, employee, owner, updatedMiddleName }) {
  assertCollaborators({ api, db, ui, employee, owner, updatedMiddleName });

  const created = await api.pim.employees.create(employee);
  const empNumber = created?.data?.empNumber;
  if (empNumber == null || String(empNumber) === '') {
    throw new Error('Employee create response did not contain data.empNumber');
  }

  const testRecord = {
    owner,
    empNumber,
    employeeId: employee.employeeId,
  };

  try {
    const persisted = await db.employees.findById(empNumber);
    assertDbEmployeeMatches(persisted, employee, employee.middleName ?? '');

    await ui.pages.login.loginAs('admin');
    await ui.pages.employees.goto();
    await ui.pages.employees.searchByName(`${employee.firstName} ${employee.lastName}`);
    if (!(await ui.pages.employees.hasRow(`${employee.firstName} ${employee.lastName}`))) {
      throw new Error('Created employee was not visible in the employee list');
    }

    await ui.pages.employeePersonalDetails.goto(empNumber);
    await ui.pages.employeePersonalDetails.updateMiddleName(updatedMiddleName);

    const [apiResult, updatedRow] = await Promise.all([
      api.pim.employees.get(empNumber),
      db.employees.findById(empNumber),
    ]);
    assertApiEmployeeMatches(apiResult?.data, employee, updatedMiddleName);
    assertDbEmployeeMatches(updatedRow, employee, updatedMiddleName);

    return {
      ...testRecord,
      employee: apiResult.data,
    };
  } catch (error) {
    throw withCreatedEmployee(error, testRecord);
  }
}

module.exports = { createEmployeeLifecycle };
