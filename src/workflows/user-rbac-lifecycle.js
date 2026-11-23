const { terminateOwnedEmployee } = require('./terminate-employee');

function assertCollaborators({ api, db, ui }) {
  for (const [label, operation] of [
    ['api.pim.employees.create', api?.pim?.employees?.create],
    ['api.admin.users.create', api?.admin?.users?.create],
    ['api.admin.users.get', api?.admin?.users?.get],
    ['api.admin.users.update', api?.admin?.users?.update],
    ['db.employees.findById', db?.employees?.findById],
    ['db.workflowRecords.findUserById', db?.workflowRecords?.findUserById],
    ['db.workflowRecords.findUserByUsername', db?.workflowRecords?.findUserByUsername],
    ['ui.pages.login.loginAs', ui?.pages?.login?.loginAs],
    ['ui.pages.login.logout', ui?.pages?.login?.logout],
    ['ui.pages.users.goto', ui?.pages?.users?.goto],
    ['ui.pages.users.searchByUsername', ui?.pages?.users?.searchByUsername],
    ['ui.pages.users.hasRow', ui?.pages?.users?.hasRow],
    ['ui.pages.users.rowCount', ui?.pages?.users?.rowCount],
    ['ui.pages.users.hasAddButton', ui?.pages?.users?.hasAddButton],
    ['ui.base.navigateSidebar', ui?.base?.navigateSidebar],
    ['ui.base.currentUrl', ui?.base?.currentUrl],
  ]) {
    if (typeof operation !== 'function') {
      throw new TypeError(`${label} is required`);
    }
  }
}

function assertTestUser(actual, expected, enabled) {
  if (
    !actual ||
    actual.user_name !== expected.username ||
    Number(actual.emp_number) !== Number(expected.empNumber) ||
    Number(actual.user_role_id) !== 2 ||
    Number(actual.status) !== (enabled ? 1 : 0) ||
    Number(actual.deleted) !== 0
  ) {
    throw new Error('Test user ownership, ESS role, or enabled state did not match');
  }
}

function withTestRecords(error, record) {
  const failure = new Error(
    `User/RBAC workflow failed; test-owned records ${record.username} and ` +
      `${record.employeeId} require lifecycle cleanup. ` +
      `${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
  failure.testRecord = record;
  return failure;
}

async function disableOwnedUser({ api, db, record, password }) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new TypeError('The test account password is required to disable the owned user');
  }

  const user = record.userId
    ? await db.workflowRecords.findUserById(record.userId)
    : await db.workflowRecords.findUserByUsername(record.username);
  if (
    !user ||
    user.user_name !== record.username ||
    Number(user.emp_number) !== Number(record.empNumber) ||
    Number(user.user_role_id) !== 2
  ) {
    throw new Error(`Ownership check failed; refusing to disable user ${record.username}`);
  }
  if (Number(user.deleted) !== 0) {
    throw new Error(`Refusing to update deleted test user ${record.username}`);
  }

  if (Number(user.status) !== 0) {
    await api.admin.users.update({
      pathParams: { id: user.id },
      data: {
        username: user.user_name,
        password,
        changePassword: false,
        status: false,
        userRoleId: 2,
        empNumber: user.emp_number,
      },
    });
  }

  const [apiUser, persisted] = await Promise.all([
    api.admin.users.get(user.id),
    db.workflowRecords.findUserById(user.id),
  ]);
  if (apiUser?.data?.status !== false) {
    throw new Error(`Disabled state was not verified through the API for ${record.username}`);
  }
  assertTestUser(persisted, record, false);

  return { userId: user.id, username: record.username, state: 'disabled' };
}

async function cleanupUserRbacLifecycle({ api, db, record, password }) {
  const errors = [];
  let disabledUser = null;
  let terminatedEmployee = null;

  try {
    const user = await db.workflowRecords.findUserByUsername(record.username);
    if (user) {
      disabledUser = await disableOwnedUser({
        api,
        db,
        record: { ...record, userId: user.id },
        password,
      });
    }
  } catch (error) {
    errors.push(error);
  }

  try {
    const employee =
      record.empNumber == null ? null : await db.employees.findById(record.empNumber);
    if (employee && employee.termination_id == null) {
      terminatedEmployee = await terminateOwnedEmployee({
        api,
        db,
        empNumber: record.empNumber,
        employeeId: record.employeeId,
        owner: record.owner,
      });
    }
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, 'One or more user/RBAC lifecycle cleanup operations failed');
  }

  return { disabledUser, terminatedEmployee };
}

async function createUserRbacLifecycle({ api, db, ui, employee, owner, username, password }) {
  assertCollaborators({ api, db, ui });
  if (
    !employee ||
    typeof employee.employeeId !== 'string' ||
    typeof employee.firstName !== 'string' ||
    typeof employee.lastName !== 'string' ||
    typeof owner !== 'string' ||
    !owner.trim() ||
    typeof username !== 'string' ||
    !username.trim() ||
    typeof password !== 'string' ||
    password.length < 8
  ) {
    throw new TypeError('An owned employee, username, password, and owner identifier are required');
  }

  const record = {
    owner,
    username,
    employeeId: employee.employeeId,
    empNumber: null,
    userId: null,
  };

  try {
    const employeeResult = await api.pim.employees.create(employee);
    record.empNumber = employeeResult?.data?.empNumber;
    if (record.empNumber == null) {
      throw new Error('Employee create response did not contain data.empNumber');
    }

    const employeeRow = await db.employees.findById(record.empNumber);
    if (
      !employeeRow ||
      employeeRow.employee_id !== employee.employeeId ||
      employeeRow.purged_at != null
    ) {
      throw new Error('Test employee was not persisted before creating its ESS account');
    }

    const userResult = await api.admin.users.create({
      username,
      password,
      status: true,
      userRoleId: 2,
      empNumber: record.empNumber,
    });
    record.userId = userResult?.data?.id;
    if (record.userId == null) {
      throw new Error('Admin user create response did not contain data.id');
    }

    const [apiUser, persistedUser] = await Promise.all([
      api.admin.users.get(record.userId),
      db.workflowRecords.findUserById(record.userId),
    ]);
    assertTestUser(persistedUser, record, true);
    if (
      apiUser?.data?.userName !== username ||
      Number(apiUser?.data?.employee?.empNumber) !== Number(record.empNumber) ||
      apiUser?.data?.userRole?.name !== 'ESS' ||
      apiUser?.data?.status !== true
    ) {
      throw new Error('Admin user API did not return the expected enabled ESS account');
    }

    await ui.pages.login.loginAs('admin');
    await ui.pages.users.goto();
    await ui.pages.users.searchByUsername(username);
    if (!(await ui.pages.users.hasRow(username))) {
      throw new Error('Created ESS account was not visible in the Admin UI');
    }

    await ui.pages.login.logout();
    await ui.pages.login.loginAs({ username, password });
    await ui.base.navigateSidebar('My Info');
    const ownInfoUrl = await ui.base.currentUrl();
    if (
      !ownInfoUrl.includes(`/pim/viewPersonalDetails/empNumber/${record.empNumber}`) &&
      !ownInfoUrl.includes('/pim/viewMyDetails')
    ) {
      throw new Error('The new ESS account could not open its own My Info page');
    }

    await ui.pages.users.goto();
    if ((await ui.pages.users.rowCount()) !== 0 || (await ui.pages.users.hasAddButton())) {
      throw new Error('The ESS account could access privileged Admin user-management controls');
    }

    const cleanup = await cleanupUserRbacLifecycle({ api, db, record, password });
    return {
      ...record,
      role: 'ESS',
      state: 'disabled',
      employeeState: cleanup.terminatedEmployee?.state ?? 'terminated',
    };
  } catch (error) {
    throw withTestRecords(error, record);
  }
}

module.exports = {
  createUserRbacLifecycle,
  cleanupUserRbacLifecycle,
  disableOwnedUser,
};
