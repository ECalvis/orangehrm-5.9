const { expect, test } = require('@playwright/test');

const { createEmployeeLifecycle } = require('../../src/workflows/employee-lifecycle');
const { terminateOwnedEmployee } = require('../../src/workflows/terminate-employee');
const { createTestIdentity } = require('../../src/workflows/test-data');

function createEmployeeCollaborators({ databaseError } = {}) {
  const calls = [];
  let databaseReads = 0;
  const employee = {
    firstName: 'Workflow',
    middleName: '',
    lastName: 'Employee',
    employeeId: 'QA1234ABCD',
  };
  const apiEmployee = {
    empNumber: 42,
    employeeId: employee.employeeId,
    firstName: employee.firstName,
    middleName: 'Updated',
    lastName: employee.lastName,
    terminationId: null,
  };
  const databaseEmployee = {
    emp_number: 42,
    employee_id: employee.employeeId,
    emp_firstname: employee.firstName,
    emp_middle_name: 'Updated',
    emp_lastname: employee.lastName,
    purged_at: null,
  };
  const api = {
    pim: {
      employees: {
        async create(data) {
          calls.push(['api.create', data]);
          return { data: { empNumber: 42 } };
        },
        async get(empNumber) {
          calls.push(['api.get', empNumber]);
          return { data: apiEmployee };
        },
      },
    },
  };
  const db = {
    employees: {
      async findById(empNumber) {
        calls.push(['db.findById', empNumber]);
        databaseReads += 1;
        if (databaseError) {
          throw databaseError;
        }
        return databaseReads === 1
          ? {
              ...databaseEmployee,
              emp_middle_name: employee.middleName,
            }
          : databaseEmployee;
      },
    },
  };
  const ui = {
    pages: {
      login: {
        async loginAs(role) {
          calls.push(['ui.login', role]);
        },
      },
      employees: {
        async goto() {
          calls.push(['ui.employeeList.goto']);
        },
        async searchByName(name) {
          calls.push(['ui.employeeList.searchByName', name]);
        },
        async hasRow(name) {
          calls.push(['ui.employeeList.hasRow', name]);
          return true;
        },
      },
      employeePersonalDetails: {
        async goto(empNumber) {
          calls.push(['ui.employeeDetails.goto', empNumber]);
        },
        async updateMiddleName(value) {
          calls.push(['ui.employeeDetails.updateMiddleName', value]);
        },
      },
    },
  };

  return { api, calls, db, employee, ui };
}

test.describe('cross-layer employee workflow', () => {
  test('creates through the API, verifies DB and UI, updates in UI, then re-verifies', async () => {
    const collaborators = createEmployeeCollaborators();
    const result = await createEmployeeLifecycle({
      ...collaborators,
      owner: 'employee-lifecycle-test',
      updatedMiddleName: 'Updated',
    });

    expect(result).toMatchObject({
      owner: 'employee-lifecycle-test',
      empNumber: 42,
      employeeId: collaborators.employee.employeeId,
      employee: { middleName: 'Updated' },
    });
    expect(collaborators.calls.map(([name]) => name)).toEqual([
      'api.create',
      'db.findById',
      'ui.login',
      'ui.employeeList.goto',
      'ui.employeeList.searchByName',
      'ui.employeeList.hasRow',
      'ui.employeeDetails.goto',
      'ui.employeeDetails.updateMiddleName',
      'api.get',
      'db.findById',
    ]);
  });

  test('surfaces the owned record when verification fails after creation', async () => {
    const collaborators = createEmployeeCollaborators({
      databaseError: new Error('database connection lost'),
    });

    await expect(
      createEmployeeLifecycle({
        ...collaborators,
        owner: 'employee-lifecycle-test',
        updatedMiddleName: 'Updated',
      }),
    ).rejects.toMatchObject({
      message: /test-owned employee 42 was retained/,
      testRecord: {
        owner: 'employee-lifecycle-test',
        empNumber: 42,
        employeeId: collaborators.employee.employeeId,
      },
      cause: { message: 'database connection lost' },
    });
  });

  test('generates unique, length-safe employee IDs with traceable QA tags', () => {
    const first = createTestIdentity();
    const second = createTestIdentity();

    expect(first.employeeId).toMatch(/^QA[A-F0-9]{8}$/);
    expect(first.employeeId).toHaveLength(10);
    expect(first.tag).toMatch(/^QA-[A-Z0-9]+-[A-F0-9]{8}$/);
    expect(second.employeeId).not.toBe(first.employeeId);
  });

  test('terminates only through the supported API and verifies the DB state', async () => {
    const calls = [];
    const api = {
      pim: {
        terminationReasons: {
          async list(params) {
            calls.push(['reasons.list', params]);
            return { data: [{ id: 3, name: 'Contract End' }] };
          },
        },
        employeeTerminations: {
          async create({ empNumber, data }) {
            calls.push(['terminations.create', empNumber, data]);
            return { data: { id: 9 } };
          },
        },
        employees: {
          async get(empNumber) {
            calls.push(['employees.get', empNumber]);
            return { data: { empNumber, terminationId: 9 } };
          },
        },
      },
    };
    const db = {
      employees: {
        async findById(empNumber) {
          calls.push(['employees.findById', empNumber]);
          return {
            emp_number: empNumber,
            employee_id: 'QA1234ABCD',
            termination_id: 9,
          };
        },
      },
    };

    await expect(
      terminateOwnedEmployee({
        api,
        db,
        empNumber: 42,
        employeeId: 'QA1234ABCD',
        owner: 'employee-test',
      }),
    ).resolves.toMatchObject({
      owner: 'employee-test',
      empNumber: 42,
      terminationId: 9,
      state: 'terminated',
    });
    expect(calls.map(([name]) => name)).toEqual([
      'employees.findById',
      'reasons.list',
      'terminations.create',
      'employees.get',
      'employees.findById',
    ]);
  });

  test('reports missing lifecycle configuration instead of silently leaving an active record', async () => {
    const api = {
      pim: {
        terminationReasons: {
          async list() {
            return { data: [] };
          },
        },
        employeeTerminations: {
          async create() {
            throw new Error('must not create a termination without a reason');
          },
        },
        employees: { get: async () => ({ data: {} }) },
      },
    };
    const db = {
      employees: {
        findById: async () => ({ emp_number: 42, employee_id: 'QA1234ABCD' }),
      },
    };

    await expect(
      terminateOwnedEmployee({
        api,
        db,
        empNumber: 42,
        employeeId: 'QA1234ABCD',
        owner: 'employee-test',
      }),
    ).rejects.toThrow('No termination reason is configured');
  });

  test('refuses to terminate an employee whose unique ID does not match the test-owned record', async () => {
    let terminationReasonLookups = 0;
    const api = {
      pim: {
        terminationReasons: {
          async list() {
            terminationReasonLookups += 1;
            return { data: [{ id: 3 }] };
          },
        },
        employeeTerminations: { create: async () => ({ data: { id: 9 } }) },
        employees: { get: async () => ({ data: {} }) },
      },
    };
    const db = {
      employees: {
        async findById() {
          return { emp_number: 42, employee_id: 'EXISTING-EMPLOYEE' };
        },
      },
    };

    await expect(
      terminateOwnedEmployee({
        api,
        db,
        empNumber: 42,
        employeeId: 'QA1234ABCD',
        owner: 'employee-test',
      }),
    ).rejects.toThrow('Ownership check failed');
    expect(terminationReasonLookups).toBe(0);
  });
});
