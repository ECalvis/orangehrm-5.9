function assertCollaborators({ api, db, empNumber, employeeId, owner }) {
  if (typeof api?.pim?.terminationReasons?.list !== 'function') {
    throw new TypeError('api.pim.terminationReasons.list is required');
  }
  if (typeof api?.pim?.employeeTerminations?.create !== 'function') {
    throw new TypeError('api.pim.employeeTerminations.create is required');
  }
  if (typeof api?.pim?.employees?.get !== 'function') {
    throw new TypeError('api.pim.employees.get is required');
  }
  if (typeof db?.employees?.findById !== 'function') {
    throw new TypeError('db.employees.findById is required');
  }
  if (empNumber == null || String(empNumber) === '') {
    throw new TypeError('An employee number is required');
  }
  if (typeof employeeId !== 'string' || !employeeId.trim()) {
    throw new TypeError('The test-owned employee ID is required');
  }
  if (typeof owner !== 'string' || !owner.trim()) {
    throw new TypeError('A test owner identifier is required');
  }
}

async function terminateOwnedEmployee({ api, db, empNumber, employeeId, owner }) {
  assertCollaborators({ api, db, empNumber, employeeId, owner });

  const ownedEmployee = await db.employees.findById(empNumber);
  if (!ownedEmployee || ownedEmployee.employee_id !== employeeId) {
    throw new Error(
      `Ownership check failed; refusing to terminate employee ${empNumber} for test ${owner}`,
    );
  }

  const { data: reasons } = await api.pim.terminationReasons.list({ limit: 100, offset: 0 });
  const reason = Array.isArray(reasons) ? reasons.find((item) => item?.id != null) : null;
  if (!reason) {
    throw new Error(
      `No termination reason is configured; test-owned employee ${empNumber} was retained`,
    );
  }

  const date = new Date().toISOString().slice(0, 10);
  const { data: termination } = await api.pim.employeeTerminations.create({
    empNumber,
    data: {
      terminationReasonId: reason.id,
      date,
      note: `Test cleanup for ${owner}`,
    },
  });
  if (termination?.id == null) {
    throw new Error(
      `Termination response did not contain an ID; test-owned employee ${empNumber} may remain active`,
    );
  }

  const [employeeResult, persisted] = await Promise.all([
    api.pim.employees.get(empNumber),
    db.employees.findById(empNumber),
  ]);
  if (
    employeeResult?.data?.terminationId !== termination.id ||
    persisted?.termination_id !== termination.id
  ) {
    throw new Error(
      `Termination was not verified for test-owned employee ${empNumber}; ` +
        'the employee may require manual follow-up',
    );
  }

  return {
    owner,
    empNumber,
    employeeId,
    terminationId: termination.id,
    state: 'terminated',
  };
}

module.exports = { terminateOwnedEmployee };
