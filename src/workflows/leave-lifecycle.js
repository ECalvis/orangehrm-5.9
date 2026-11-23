function assertCollaborators({ adminApi, essApi, db, ui, requireUi = true }) {
  for (const [label, operation] of [
    ['adminApi.leave.leaveTypes.create', adminApi?.leave?.leaveTypes?.create],
    ['adminApi.leave.leaveTypes.get', adminApi?.leave?.leaveTypes?.get],
    ['adminApi.leave.leaveTypes.delete', adminApi?.leave?.leaveTypes?.delete],
    ['adminApi.leave.leaveEntitlements.create', adminApi?.leave?.leaveEntitlements?.create],
    ['adminApi.leave.leaveEntitlements.get', adminApi?.leave?.leaveEntitlements?.get],
    ['adminApi.leave.leaveEntitlements.delete', adminApi?.leave?.leaveEntitlements?.delete],
    ['adminApi.leave.leaveBalance.forLeaveType', adminApi?.leave?.leaveBalance?.forLeaveType],
    ['adminApi.leave.employeeLeaveRequests.update', adminApi?.leave?.employeeLeaveRequests?.update],
    ['essApi.leave.eligibleLeaveTypes.list', essApi?.leave?.eligibleLeaveTypes?.list],
    ['essApi.leave.leaveRequests.get', essApi?.leave?.leaveRequests?.get],
    ['essApi.leave.leaveRequests.update', essApi?.leave?.leaveRequests?.update],
    ['db.workflowRecords.findLeaveTypeById', db?.workflowRecords?.findLeaveTypeById],
    [
      'db.workflowRecords.findLeaveEntitlementById',
      db?.workflowRecords?.findLeaveEntitlementById,
    ],
    ['db.workflowRecords.findLeaveRequestById', db?.workflowRecords?.findLeaveRequestById],
    [
      'db.workflowRecords.findLeaveRequestForEmployee',
      db?.workflowRecords?.findLeaveRequestForEmployee,
    ],
    ['ui.pages.login.loginAs', ui?.pages?.login?.loginAs],
    ['ui.pages.leave.applyLeave', ui?.pages?.leave?.applyLeave],
  ]) {
    if (!requireUi && label.startsWith('ui.')) {
      continue;
    }
    if (typeof operation !== 'function') {
      throw new TypeError(`${label} is required`);
    }
  }
}

function assertLeaveInputs({ employee, owner, leaveTypeName, fromDate, toDate, entitlementDays }) {
  const isDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);
    return parsed.toISOString().slice(0, 10) === value;
  };

  if (!Number.isInteger(employee?.empNumber) || employee.empNumber < 1) {
    throw new TypeError('A positive employee number is required');
  }
  if (typeof owner !== 'string' || !owner.trim()) {
    throw new TypeError('A test owner identifier is required');
  }
  if (
    typeof leaveTypeName !== 'string' ||
    leaveTypeName.trim() === '' ||
    leaveTypeName.length > 50
  ) {
    throw new TypeError('A unique leave type name of at most 50 characters is required');
  }
  if (
    !isDate(fromDate) ||
    !isDate(toDate) ||
    fromDate > toDate
  ) {
    throw new TypeError('A valid inclusive leave date range is required');
  }
  if (!Number.isInteger(entitlementDays) || entitlementDays < 1) {
    throw new TypeError('A positive whole-number entitlement is required');
  }
}

function withTestRecord(error, record) {
  const invalidParameters = error?.data?.invalidParamKeys;
  const detail = Array.isArray(invalidParameters)
    ? ` (invalid parameters: ${invalidParameters.join(', ')})`
    : '';
  const failure = new Error(
    `Leave workflow failed; test-owned records require follow-up: ${error.message}${detail}`,
    { cause: error },
  );
  failure.testRecord = record;
  return failure;
}

async function waitForLeaveBalance(adminApi, leaveTypeId, empNumber, predicate, description) {
  let latestBalance;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await adminApi.leave.leaveBalance.forLeaveType({
      pathParams: { leaveTypeId },
      params: { empNumber },
    });
    const item = Array.isArray(result?.data) ? result.data[0] : result?.data;
    latestBalance = item?.balance ?? item;
    if (predicate(latestBalance)) {
      return latestBalance;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `${description}; latest balance: ${JSON.stringify(latestBalance ?? null)}`,
  );
}

async function createLeaveLifecycle({
  adminApi,
  essApi,
  db,
  ui,
  employee,
  owner,
  leaveTypeName,
  fromDate,
  toDate,
  entitlementFromDate = fromDate,
  entitlementToDate = toDate,
  entitlementDays,
}) {
  assertCollaborators({ adminApi, essApi, db, ui });
  assertLeaveInputs({ employee, owner, leaveTypeName, fromDate, toDate, entitlementDays });
  assertLeaveInputs({
    employee,
    owner,
    leaveTypeName,
    fromDate: entitlementFromDate,
    toDate: entitlementToDate,
    entitlementDays,
  });

  const record = {
    owner,
    empNumber: employee.empNumber,
    leaveTypeName,
    leaveTypeId: null,
    entitlementId: null,
    leaveRequestId: null,
  };

  try {
    const typeResult = await adminApi.leave.leaveTypes.create({
      name: leaveTypeName,
      situational: false,
    });
    record.leaveTypeId = typeResult?.data?.id;
    if (record.leaveTypeId == null) {
      throw new Error('Leave type create response did not contain data.id');
    }

    const entitlementResult = await adminApi.leave.leaveEntitlements.create({
      empNumber: employee.empNumber,
      entitlement: entitlementDays,
      fromDate: entitlementFromDate,
      toDate: entitlementToDate,
      leaveTypeId: record.leaveTypeId,
    });
    record.entitlementId = entitlementResult?.data?.id;
    if (record.entitlementId == null) {
      throw new Error('Leave entitlement create response did not contain data.id');
    }

    const [persistedType, persistedEntitlement, eligible] = await Promise.all([
      db.workflowRecords.findLeaveTypeById(record.leaveTypeId),
      db.workflowRecords.findLeaveEntitlementById(record.entitlementId),
      essApi.leave.eligibleLeaveTypes.list(),
    ]);

    if (
      !persistedType ||
      Number(persistedType.deleted) !== 0 ||
      persistedType.name !== leaveTypeName
    ) {
      throw new Error('Created leave type was not persisted as an active type');
    }
    if (
      !persistedEntitlement ||
      Number(persistedEntitlement.emp_number) !== employee.empNumber ||
      Number(persistedEntitlement.leave_type_id) !== record.leaveTypeId ||
      Number(persistedEntitlement.no_of_days) !== entitlementDays ||
      Number(persistedEntitlement.deleted) !== 0
    ) {
      throw new Error('Created employee leave entitlement did not match its test-owned values');
    }
    if (
      !Array.isArray(eligible?.data) ||
      !eligible.data.some((type) => type.id === record.leaveTypeId)
    ) {
      throw new Error('The entitled employee could not select the test leave type');
    }

    await ui.pages.login.loginAs('ess');
    await ui.pages.leave.applyLeave({
      leaveType: leaveTypeName,
      fromDate,
      toDate,
      comment: owner,
    });
    const persistedRequest = await db.workflowRecords.findLeaveRequestForEmployee({
      empNumber: employee.empNumber,
      leaveTypeId: record.leaveTypeId,
      fromDate,
      toDate,
    });
    record.leaveRequestId = persistedRequest?.id;
    if (record.leaveRequestId == null) {
      throw new Error('ESS leave application was not persisted for the test employee and dates');
    }

    const requestResult = await essApi.leave.leaveRequests.get({
      pathParams: { leaveRequestId: record.leaveRequestId },
      params: { model: 'detailed' },
    });
    if (requestResult?.data?.id !== record.leaveRequestId) {
      throw new Error('ESS leave request could not be read back through the API');
    }

    await adminApi.leave.employeeLeaveRequests.update({
      pathParams: { leaveRequestId: record.leaveRequestId },
      data: { action: 'APPROVE' },
    });
    const approved = await db.workflowRecords.findLeaveRequestById(record.leaveRequestId);
    const periodBalance = await waitForLeaveBalance(
      adminApi,
      record.leaveTypeId,
      employee.empNumber,
      (balance) =>
        Number(balance?.entitled) === entitlementDays && Number(balance?.scheduled) >= 1,
      'Approved leave request did not appear in the leave balance',
    );
    if (
      !approved ||
      Number(approved.emp_number) !== employee.empNumber ||
      Number(approved.leave_type_id) !== record.leaveTypeId ||
      !String(approved.status_codes).split(',').includes('2') ||
      Number(periodBalance.pending) !== 0
    ) {
      throw new Error(
        `Approved leave request was not persisted as scheduled (DB statuses: ${approved?.status_codes ?? 'missing'})`,
      );
    }

    return {
      ...record,
      state: 'SCHEDULED',
      dateRange: { fromDate, toDate },
      entitlementDays,
    };
  } catch (error) {
    throw withTestRecord(error, record);
  }
}

async function cleanupLeaveLifecycle({ adminApi, essApi, db, record }) {
  assertCollaborators({ adminApi, essApi, db, requireUi: false });
  if (!record || typeof record.owner !== 'string' || !record.owner.trim()) {
    throw new TypeError('A test-owned leave record is required');
  }

  const request = record.leaveRequestId
    ? await db.workflowRecords.findLeaveRequestById(record.leaveRequestId)
    : null;
  const entitlement = record.entitlementId
    ? await db.workflowRecords.findLeaveEntitlementById(record.entitlementId)
    : null;
  const leaveType = record.leaveTypeId
    ? await db.workflowRecords.findLeaveTypeById(record.leaveTypeId)
    : null;

  if (leaveType && leaveType.name !== record.leaveTypeName) {
    throw new Error('Ownership check failed; refusing to remove a non-test leave type');
  }
  if (
    entitlement &&
    (Number(entitlement.emp_number) !== record.empNumber ||
      Number(entitlement.leave_type_id) !== record.leaveTypeId)
  ) {
    throw new Error('Ownership check failed; refusing to remove a non-test leave entitlement');
  }
  if (
    request &&
    (Number(request.emp_number) !== record.empNumber ||
      Number(request.leave_type_id) !== record.leaveTypeId)
  ) {
    throw new Error('Ownership check failed; refusing to cancel a non-test leave request');
  }

  if (request && !String(request.status_codes).split(',').includes('0')) {
    await essApi.leave.leaveRequests.update({
      pathParams: { leaveRequestId: record.leaveRequestId },
      data: { action: 'CANCEL' },
    });
    const cancelled = await db.workflowRecords.findLeaveRequestById(record.leaveRequestId);
    if (!cancelled || !String(cancelled.status_codes).split(',').includes('0')) {
      throw new Error(
        `Cancellation could not be verified; leave request ${record.leaveRequestId} was retained`,
      );
    }
    await waitForLeaveBalance(
      adminApi,
      record.leaveTypeId,
      record.empNumber,
      (balance) => Number(balance?.scheduled) === 0 && Number(balance?.pending) === 0,
      `Leave balance was not restored after cancellation; request ${record.leaveRequestId} was retained`,
    );
  }

  if (entitlement && Number(entitlement.deleted) === 0) {
    await adminApi.leave.leaveEntitlements.delete({ ids: [record.entitlementId] });
    const removedEntitlement = await db.workflowRecords.findLeaveEntitlementById(
      record.entitlementId,
    );
    if (removedEntitlement && Number(removedEntitlement.deleted) === 0) {
      throw new Error(
        `Entitlement cleanup could not be verified; entitlement ${record.entitlementId} remains active`,
      );
    }
  }

  if (leaveType && Number(leaveType.deleted) === 0) {
    await adminApi.leave.leaveTypes.delete({ ids: [record.leaveTypeId] });
    const removedType = await db.workflowRecords.findLeaveTypeById(record.leaveTypeId);
    if (removedType && Number(removedType.deleted) === 0) {
      throw new Error(
        `Leave type cleanup could not be verified; leave type ${record.leaveTypeId} remains active`,
      );
    }
  }

  return { owner: record.owner, state: 'CANCELLED', cleaned: true };
}

module.exports = { createLeaveLifecycle, cleanupLeaveLifecycle };
