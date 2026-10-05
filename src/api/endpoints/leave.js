const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createLeaveApi(client) {
  return createRouteGroup(client, {
    holidays: {
      list: route('GET', '/leave/holidays'),
      create: route('POST', '/leave/holidays'),
      delete: route('DELETE', '/leave/holidays'),
      get: route('GET', '/leave/holidays/{id}'),
      update: route('PUT', '/leave/holidays/{id}'),
    },
    workweek: {
      get: route('GET', '/leave/workweek'),
      update: route('PUT', '/leave/workweek'),
    },
    leavePeriod: {
      get: route('GET', '/leave/leave-period'),
      update: route('PUT', '/leave/leave-period'),
    },
    leavePeriods: { list: route('GET', '/leave/leave-periods') },
    leaveTypes: {
      list: route('GET', '/leave/leave-types'),
      create: route('POST', '/leave/leave-types'),
      delete: route('DELETE', '/leave/leave-types'),
      get: route('GET', '/leave/leave-types/{id}'),
      update: route('PUT', '/leave/leave-types/{id}'),
    },
    eligibleLeaveTypes: {
      list: route('GET', '/leave/leave-types/eligible'),
      create: route('POST', '/leave/leave-types/eligible'),
      delete: route('DELETE', '/leave/leave-types/eligible'),
    },
    leaveRequests: {
      list: route('GET', '/leave/leave-requests'),
      create: route('POST', '/leave/leave-requests'),
      delete: route('DELETE', '/leave/leave-requests'),
      get: route('GET', '/leave/leave-requests/{leaveRequestId}'),
      update: route('PUT', '/leave/leave-requests/{leaveRequestId}'),
    },
    employeeLeaveRequests: {
      list: route('GET', '/leave/employees/leave-requests'),
      create: route('POST', '/leave/employees/leave-requests'),
      delete: route('DELETE', '/leave/employees/leave-requests'),
      get: route('GET', '/leave/employees/leave-requests/{leaveRequestId}'),
      update: route('PUT', '/leave/employees/leave-requests/{leaveRequestId}'),
    },
    bulkEmployeeLeaveRequests: {
      update: route('PUT', '/leave/employees/leave-requests/bulk'),
    },
    leaveEntitlements: {
      list: route('GET', '/leave/leave-entitlements'),
      create: route('POST', '/leave/leave-entitlements'),
      delete: route('DELETE', '/leave/leave-entitlements'),
      get: route('GET', '/leave/leave-entitlements/{id}'),
      update: route('PUT', '/leave/leave-entitlements/{id}'),
    },
    employeeLeaveEntitlements: {
      forEmployee: route('GET', '/leave/employees/{empNumber}/leave-entitlements'),
      list: route('GET', '/leave/employees/leave-entitlements'),
    },
    leaveBalance: {
      forLeaveType: route('GET', '/leave/leave-balance/leave-type/{leaveTypeId}'),
    },
    employeeLeaveBalances: {
      list: route('GET', '/leave/employees/leave-balances'),
    },
    validateLeaveEntitlement: {
      get: route('GET', '/leave/leave-entitlements/{id}/validation/entitlements'),
    },
    overlapLeaves: { get: route('GET', '/leave/overlap-leaves') },
    leaveRequestComments: {
      list: route('GET', '/leave/leave-requests/{leaveRequestId}/leave-comments'),
      create: route('POST', '/leave/leave-requests/{leaveRequestId}/leave-comments'),
    },
    leaveComments: {
      list: route('GET', '/leave/leaves/{leaveId}/leave-comments'),
      create: route('POST', '/leave/leaves/{leaveId}/leave-comments'),
    },
    leavesForRequest: {
      list: route('GET', '/leave/leave-requests/{leaveRequestId}/leaves'),
    },
    leave: { update: route('PUT', '/leave/leaves/{leaveId}') },
    bulkLeave: { update: route('PUT', '/leave/leaves/bulk') },
    reports: { list: route('GET', '/leave/reports') },
    reportsData: { get: route('GET', '/leave/reports/data') },
    employeeLeaves: { list: route('GET', '/leave/employees/leaves') },
  });
}

module.exports = { createLeaveApi };
