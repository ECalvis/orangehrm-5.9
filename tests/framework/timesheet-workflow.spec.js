const { expect, test } = require('@playwright/test');

const {
  cleanupTimesheetLifecycle,
  createTimesheetLifecycle,
  durationInSeconds,
} = require('../../src/workflows/timesheet-lifecycle');

function createTimesheetCollaborators() {
  const calls = [];
  const state = {
    actionLogs: [],
    timesheet: { timesheet_id: 44, employee_id: 42, state: 'APPROVED' },
    item: {
      timesheet_item_id: 55,
      timesheet_id: 44,
      employee_id: 42,
      project_id: 22,
      activity_id: 33,
      date: new Date('2026-11-23T00:00:00.000Z'),
      duration: 5400,
    },
  };
  const api = {
    pim: {
      employees: {
        async create(employee) {
          calls.push(['employee.create', employee.employeeId]);
          return { data: { empNumber: 42 } };
        },
      },
    },
    time: {
      customers: {
        async create(data) {
          calls.push(['customer.create', data.name]);
          return { data: { id: 11 } };
        },
      },
      projects: {
        async create(data) {
          calls.push(['project.create', data.name, data.customerId]);
          return { data: { id: 22 } };
        },
      },
      projectActivities: {
        async create({ pathParams, data }) {
          calls.push(['activity.create', pathParams.projectId, data.name]);
          return { data: { id: 33 } };
        },
      },
      employeeTimesheets: {
        async create({ pathParams, data }) {
          calls.push(['timesheet.create', pathParams.empNumber, data.date]);
          return { data: { id: 44 } };
        },
      },
      employeeTimesheetEntries: {
        async update({ pathParams, data }) {
          calls.push(['entries.update', pathParams.timesheetId, data.entries]);
        },
        async list({ pathParams }) {
          calls.push(['entries.list', pathParams.timesheetId]);
          return {
            data: [
              {
                project: { id: 22 },
                activity: { id: 33 },
                dates: { '2026-11-23': { duration: '01:30' } },
              },
            ],
          };
        },
      },
      employeeTimesheet: {
        async update({ pathParams, data }) {
          calls.push(['timesheet.update', pathParams.id, data.action]);
          state.actionLogs.push({
            action: { name: `${data.action}TED`.replace('APPROVETED', 'APPROVED') },
            comment: data.comment,
          });
        },
      },
      timesheetActionLogs: {
        async list({ pathParams }) {
          calls.push(['actionLogs.list', pathParams.timesheetId]);
          return { data: state.actionLogs };
        },
      },
    },
  };
  const db = {
    employees: {
      async findById(id) {
        calls.push(['employee.findById', id]);
        return {
          employee_id: 'QA1234ABCD',
          emp_firstname: 'QA',
          emp_lastname: 'Timesheet',
          purged_at: null,
        };
      },
      async findByEmployeeId(id) {
        calls.push(['employee.findByEmployeeId', id]);
        return { emp_number: 42 };
      },
    },
    workflowRecords: {
      async findTimesheetById(id) {
        calls.push(['timesheet.find', id]);
        return state.timesheet;
      },
      async findTimesheetItems(id) {
        calls.push(['items.find', id]);
        return [state.item];
      },
      async findTimesheetActionLogs(id) {
        calls.push(['actionLogs.find', id]);
        return state.actionLogs.map((log, index) => ({
          action: log.action.name,
          comment: log.comment,
          timesheet_action_log_id: index + 1,
        }));
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
      timesheets: {
        async gotoEmployeeTimesheets() {
          calls.push(['ui.timesheets.goto']);
        },
        async viewEmployee(name) {
          calls.push(['ui.timesheets.view', name]);
        },
        async waitForAction(action, comment) {
          calls.push(['ui.timesheets.waitForAction', action, comment]);
        },
      },
    },
  };
  return { api, calls, db, state, ui };
}

const timesheetInput = {
  employee: {
    firstName: 'QA',
    lastName: 'Timesheet',
    employeeId: 'QA1234ABCD',
  },
  owner: 'timesheet-test-owner',
  date: '2026-11-23',
  duration: '01:30',
};

test.describe('cross-layer timesheet lifecycle workflow', () => {
  test('creates an owned timesheet, submits, approves and verifies API/DB/UI state', async () => {
    const collaborators = createTimesheetCollaborators();

    await expect(
      createTimesheetLifecycle({ ...collaborators, ...timesheetInput }),
    ).resolves.toMatchObject({
      owner: timesheetInput.owner,
      empNumber: 42,
      customerId: 11,
      projectId: 22,
      activityId: 33,
      timesheetId: 44,
      state: 'APPROVED',
      retained: true,
    });

    expect(collaborators.calls).toContainEqual(['timesheet.update', 44, 'SUBMIT']);
    expect(collaborators.calls).toContainEqual(['timesheet.update', 44, 'APPROVE']);
    expect(collaborators.calls).toContainEqual([
      'ui.timesheets.waitForAction',
      'Submitted',
      `${timesheetInput.owner}: submit`,
    ]);
    expect(collaborators.calls).toContainEqual([
      'ui.timesheets.waitForAction',
      'Approved',
      `${timesheetInput.owner}: approve`,
    ]);
  });

  test('rejects invalid dates and durations before creating any records', async () => {
    for (const [input, message] of [
      [{ date: '2026-02-30' }, 'A valid timesheet date is required'],
      [{ date: '0000-00-00' }, 'A valid timesheet date is required'],
      [{ duration: '00:00' }, 'Duration must be between 00:01 and 23:59'],
      [{ duration: '24:00' }, 'Duration must be between 00:01 and 23:59'],
      [{ duration: '01:60' }, 'Duration must be between 00:01 and 23:59'],
    ]) {
      const collaborators = createTimesheetCollaborators();
      await expect(
        createTimesheetLifecycle({
          ...collaborators,
          ...timesheetInput,
          ...input,
        }),
      ).rejects.toThrow(message);
      expect(collaborators.calls).toEqual([]);
    }
  });

  test('preserves ownership metadata when a dependent setup operation fails', async () => {
    const collaborators = createTimesheetCollaborators();
    collaborators.api.time.projects.create = async () => {
      throw new Error('Project setup failed');
    };

    const error = await createTimesheetLifecycle({
      ...collaborators,
      ...timesheetInput,
    }).catch((failure) => failure);

    expect(error.message).toContain('Project setup failed');
    expect(error.testRecord).toMatchObject({
      owner: timesheetInput.owner,
      empNumber: 42,
      employeeId: timesheetInput.employee.employeeId,
      customerId: 11,
      projectId: null,
      retained: true,
    });
  });

  test('recovers the owned employee number when the create response fails after persistence', async () => {
    const collaborators = createTimesheetCollaborators();
    collaborators.api.pim.employees.create = async () => {
      throw new Error('Employee create response failed');
    };
    collaborators.db.employees.findByEmployeeId = async () => ({
      emp_number: 42,
      employee_id: timesheetInput.employee.employeeId,
    });

    const error = await createTimesheetLifecycle({
      ...collaborators,
      ...timesheetInput,
    }).catch((failure) => failure);

    expect(error.message).toContain('Employee create response failed');
    expect(error.testRecord).toMatchObject({
      empNumber: 42,
      employeeId: timesheetInput.employee.employeeId,
      retained: true,
    });
  });

  test('terminates only the owned employee and verifies historical timesheet retention', async () => {
    const collaborators = createTimesheetCollaborators();
    const record = {
      owner: timesheetInput.owner,
      employeeId: timesheetInput.employee.employeeId,
      empNumber: 42,
      timesheetId: 44,
    };
    const terminationCalls = [];
    const api = {
      pim: {
        ...collaborators.api.pim,
        terminationReasons: {
          async list() {
            return { data: [{ id: 2 }] };
          },
        },
        employeeTerminations: {
          async create({ empNumber }) {
            terminationCalls.push(empNumber);
            return { data: { id: 77 } };
          },
        },
        employees: {
          async get() {
            return { data: { terminationId: 77 } };
          },
        },
      },
    };
    collaborators.db.employees.findById = async () => ({
      employee_id: timesheetInput.employee.employeeId,
      termination_id: 77,
    });
    collaborators.db.employees.findByEmployeeId = async () => ({
      emp_number: 42,
      employee_id: timesheetInput.employee.employeeId,
    });
    record.empNumber = null;

    await expect(
      cleanupTimesheetLifecycle({ api, db: collaborators.db, record }),
    ).resolves.toMatchObject({
      owner: record.owner,
      employeeTerminated: true,
      timesheetId: 44,
      timesheetState: 'APPROVED',
      retained: true,
    });
    expect(terminationCalls).toEqual([42]);
  });

  test('refuses cleanup when the persisted timesheet belongs to another employee', async () => {
    const collaborators = createTimesheetCollaborators();
    collaborators.db.workflowRecords.findTimesheetById = async () => ({
      timesheet_id: 44,
      employee_id: 99,
      state: 'APPROVED',
    });
    let terminated = false;
    const api = {
      pim: {
        terminationReasons: { list: async () => ({ data: [{ id: 2 }] }) },
        employeeTerminations: {
          create: async () => {
            terminated = true;
            return { data: { id: 77 } };
          },
        },
        employees: { get: async () => ({ data: { terminationId: 77 } }) },
      },
    };

    await expect(
      cleanupTimesheetLifecycle({
        api,
        db: collaborators.db,
        record: {
          owner: timesheetInput.owner,
          employeeId: timesheetInput.employee.employeeId,
          empNumber: 42,
          timesheetId: 44,
        },
      }),
    ).rejects.toThrow('Ownership check failed');
    expect(terminated).toBe(false);
  });

  test('converts only valid nonzero HH:MM durations', () => {
    expect(durationInSeconds('01:30')).toBe(5400);
    expect(durationInSeconds('00:00')).toBeNull();
    expect(durationInSeconds('25:00')).toBeNull();
  });
});
