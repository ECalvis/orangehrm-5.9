const { expect, test } = require('@playwright/test');

const {
  cleanupLeaveLifecycle,
  createLeaveLifecycle,
} = require('../../src/workflows/leave-lifecycle');
const { createAttendanceLifecycle } = require('../../src/workflows/attendance-lifecycle');

function createLeaveCollaborators() {
  const calls = [];
  const state = {
    type: { id: 11, name: 'QA Leave 12345678', deleted: 0 },
    entitlement: {
      id: 22,
      emp_number: 2,
      leave_type_id: 11,
      no_of_days: 1,
      days_used: 0,
      deleted: 0,
    },
    request: {
      id: 33,
      emp_number: 2,
      leave_type_id: 11,
      status_codes: '1',
    },
  };
  const adminApi = {
    leave: {
      leaveTypes: {
        async create(data) {
          calls.push(['type.create', data]);
          return { data: { id: state.type.id } };
        },
        async get(id) {
          calls.push(['type.get', id]);
          return { data: state.type };
        },
        async delete({ ids }) {
          calls.push(['type.delete', ids]);
          state.type.deleted = 1;
        },
      },
      leaveEntitlements: {
        async create(data) {
          calls.push(['entitlement.create', data]);
          return { data: { id: state.entitlement.id } };
        },
        async get(id) {
          calls.push(['entitlement.get', id]);
          return { data: state.entitlement };
        },
        async delete({ ids }) {
          calls.push(['entitlement.delete', ids]);
          state.entitlement.deleted = 1;
        },
      },
      leaveBalance: {
        async forLeaveType({ pathParams, params }) {
          calls.push(['balance', pathParams.leaveTypeId, params.empNumber]);
          const statusCodes = String(state.request.status_codes).split(',');
          return {
            data: [
              {
                balance: {
                  entitled: 1,
                  pending: statusCodes.includes('1') ? 1 : 0,
                  scheduled: statusCodes.includes('2') ? 1 : 0,
                },
              },
            ],
          };
        },
      },
      employeeLeaveRequests: {
        async update({ pathParams, data }) {
          calls.push(['request.adminUpdate', pathParams.leaveRequestId, data.action]);
          state.request.status_codes = '2';
        },
      },
    },
  };
  const essApi = {
    leave: {
      eligibleLeaveTypes: {
        async list() {
          calls.push(['types.eligible']);
          return { data: [{ id: state.type.id }] };
        },
      },
      leaveRequests: {
        async get({ pathParams, params }) {
          calls.push(['request.get', pathParams.leaveRequestId, params.model]);
          return { data: { id: state.request.id } };
        },
        async update({ pathParams, data }) {
          calls.push(['request.essUpdate', pathParams.leaveRequestId, data.action]);
          state.request.status_codes = '0';
        },
      },
    },
  };
  const db = {
    workflowRecords: {
      async findLeaveTypeById(id) {
        calls.push(['db.type', id]);
        return state.type;
      },
      async findLeaveEntitlementById(id) {
        calls.push(['db.entitlement', id]);
        return state.entitlement;
      },
      async findLeaveRequestById(id) {
        calls.push(['db.request', id]);
        return state.request;
      },
      async findLeaveRequestForEmployee(input) {
        calls.push(['db.requestForEmployee', input]);
        return state.request;
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
      leave: {
        async goto() {
          calls.push(['ui.leave.goto']);
        },
        async applyLeave(input) {
          calls.push(['ui.leave.applyLeave', input]);
        },
        async hasRow(text) {
          calls.push(['ui.leave.hasRow', text]);
          return true;
        },
      },
    },
  };

  return { adminApi, calls, db, essApi, state, ui };
}

const leaveInput = {
  employee: { empNumber: 2 },
  owner: 'leave-test-owner',
  leaveTypeName: 'QA Leave 12345678',
  fromDate: '2026-11-25',
  toDate: '2026-11-25',
  entitlementDays: 1,
};

test.describe('cross-layer leave lifecycle workflow', () => {
  test('provisions a type and entitlement, applies as ESS, and verifies admin approval', async () => {
    const collaborators = createLeaveCollaborators();

    await expect(createLeaveLifecycle({ ...collaborators, ...leaveInput })).resolves.toMatchObject({
      owner: leaveInput.owner,
      empNumber: 2,
      leaveTypeId: 11,
      entitlementId: 22,
      leaveRequestId: 33,
      state: 'SCHEDULED',
    });

    expect(collaborators.calls).toContainEqual(['ui.login', 'ess']);
    expect(collaborators.calls.some(([name]) => name === 'ui.leave.applyLeave')).toBe(true);
    expect(collaborators.calls).toContainEqual(['request.get', 33, 'detailed']);
    expect(collaborators.calls).toContainEqual(['request.adminUpdate', 33, 'APPROVE']);
    expect(collaborators.state.request.status_codes).toBe('2');
  });

  test('rejects malformed or reversed date ranges before creating records', async () => {
    const collaborators = createLeaveCollaborators();

    await expect(
      createLeaveLifecycle({
        ...collaborators,
        ...leaveInput,
        fromDate: '2026-02-30',
      }),
    ).rejects.toThrow('A valid inclusive leave date range is required');
    await expect(
      createLeaveLifecycle({
        ...collaborators,
        ...leaveInput,
        fromDate: '2026-11-26',
      }),
    ).rejects.toThrow('A valid inclusive leave date range is required');
    expect(collaborators.calls).toEqual([]);
  });

  test('cancels only the owned request, soft-deletes its entitlement and leave type, and verifies cleanup', async () => {
    const collaborators = createLeaveCollaborators();
    const record = await createLeaveLifecycle({ ...collaborators, ...leaveInput });

    await expect(cleanupLeaveLifecycle({ ...collaborators, record })).resolves.toMatchObject({
      owner: leaveInput.owner,
      state: 'CANCELLED',
      cleaned: true,
    });
    expect(collaborators.calls).toContainEqual(['request.essUpdate', 33, 'CANCEL']);
    expect(collaborators.calls).toContainEqual(['entitlement.delete', [22]]);
    expect(collaborators.calls).toContainEqual(['type.delete', [11]]);
  });

  test('refuses entitlement cleanup when the persisted owner does not match', async () => {
    const collaborators = createLeaveCollaborators();
    const record = await createLeaveLifecycle({
      ...collaborators,
      ...leaveInput,
    });
    record.leaveTypeName = 'an unrelated test leave type';

    await expect(cleanupLeaveLifecycle({ ...collaborators, record })).rejects.toThrow(
      'Ownership check failed',
    );
    expect(collaborators.calls.some(([name]) => name.endsWith('.delete'))).toBe(false);
  });
});

test.describe('cross-layer attendance lifecycle workflow', () => {
  test('creates an owned employee, punches in and out, and verifies API/DB/UI state', async () => {
    const calls = [];
    const employee = {
      firstName: 'QA',
      lastName: 'Attendance',
      employeeId: 'QA1234ABCD',
    };
    const api = {
      pim: {
        employees: {
          async create(data) {
            calls.push(['employee.create', data]);
            return { data: { empNumber: 42 } };
          },
        },
      },
      attendance: {
        employeeRecords: {
          async create({ pathParams, data }) {
            calls.push(['attendance.create', pathParams.empNumber, data.time]);
            return { data: { id: 8 } };
          },
          async update({ pathParams, data }) {
            calls.push(['attendance.update', pathParams.empNumber, data.time]);
          },
        },
        record: {
          async get(id) {
            calls.push(['attendance.get', id]);
            return { data: { id, state: { name: 'PUNCHED OUT' } } };
          },
        },
      },
    };
    const db = {
      employees: {
        async findById(id) {
          calls.push(['employee.find', id]);
          return {
            emp_number: id,
            employee_id: employee.employeeId,
            emp_firstname: employee.firstName,
            emp_lastname: employee.lastName,
            purged_at: null,
          };
        },
      },
      workflowRecords: {
        async findAttendanceRecordById(id) {
          calls.push(['attendance.find', id]);
          return {
            id,
            employee_id: 42,
            state: 'PUNCHED OUT',
            punch_in_utc_time: '2026-11-24 09:00:00',
            punch_out_utc_time: '2026-11-24 09:30:00',
            punch_in_note: 'attendance-test',
            punch_out_note: 'attendance-test',
            punch_in_timezone_name: 'UTC',
            punch_out_timezone_name: 'UTC',
          };
        },
      },
    };
    const ui = {
      pages: {
        login: { loginAs: async (role) => calls.push(['ui.login', role]) },
        attendance: {
          goto: async () => calls.push(['ui.attendance.goto']),
          hasRow: async (name) => {
            calls.push(['ui.attendance.hasRow', name]);
            return true;
          },
        },
      },
    };

    await expect(
      createAttendanceLifecycle({
        api,
        db,
        ui,
        employee,
        owner: 'attendance-test',
        date: '2026-11-24',
        punchInTime: '09:00',
        punchOutTime: '09:30',
        timezoneName: 'UTC',
        timezoneOffset: '0.0',
      }),
    ).resolves.toMatchObject({
      empNumber: 42,
      attendanceId: 8,
      state: 'PUNCHED OUT',
    });

    expect(calls).toContainEqual(['attendance.create', 42, '09:00']);
    expect(calls).toContainEqual(['attendance.update', 42, '09:30']);
    expect(calls).toContainEqual(['ui.attendance.hasRow', 'QA Attendance']);
  });

  test('rejects non-increasing punch times before creating an employee', async () => {
    let creates = 0;
    await expect(
      createAttendanceLifecycle({
        api: {
          pim: { employees: { create: async () => (creates += 1) } },
          attendance: {
            employeeRecords: { create: async () => {}, update: async () => {} },
            record: { get: async () => ({ data: {} }) },
          },
        },
        db: {
          employees: { findById: async () => null },
          workflowRecords: { findAttendanceRecordById: async () => null },
        },
        ui: {
          pages: {
            login: { loginAs: async () => {} },
            attendance: {
              goto: async () => {},
              hasRow: async () => false,
            },
          },
        },
        employee: { firstName: 'QA', lastName: 'Invalid', employeeId: 'QA1234ABCD' },
        owner: 'attendance-test',
        date: '2026-11-24',
        punchInTime: '10:00',
        punchOutTime: '10:00',
        timezoneName: 'UTC',
        timezoneOffset: '0.0',
      }),
    ).rejects.toThrow('A valid date and ordered punch-in/punch-out times are required');
    expect(creates).toBe(0);
  });
});
