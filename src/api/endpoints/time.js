const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createTimeApi(client) {
  return createRouteGroup(client, {
    projects: {
      list: route('GET', '/time/projects'),
      create: route('POST', '/time/projects'),
      delete: route('DELETE', '/time/projects'),
      get: route('GET', '/time/projects/{id}'),
      update: route('PUT', '/time/projects/{id}'),
    },
    validateProjectName: { get: route('GET', '/time/validation/project-name') },
    timesheetPeriod: {
      get: route('GET', '/time/time-sheet-period'),
      update: route('PUT', '/time/time-sheet-period'),
    },
    customers: {
      list: route('GET', '/time/customers'),
      create: route('POST', '/time/customers'),
      delete: route('DELETE', '/time/customers'),
      get: route('GET', '/time/customers/{id}'),
      update: route('PUT', '/time/customers/{id}'),
    },
    validateCustomerName: { get: route('GET', '/time/validation/customer-name') },
    projectActivities: {
      list: route('GET', '/time/project/{projectId}/activities'),
      create: route('POST', '/time/project/{projectId}/activities'),
      delete: route('DELETE', '/time/project/{projectId}/activities'),
      get: route('GET', '/time/project/{projectId}/activities/{id}'),
      update: route('PUT', '/time/project/{projectId}/activities/{id}'),
    },
    validateProjectActivityName: {
      get: route('GET', '/time/validation/activity-name/{id}'),
    },
    myTimesheets: {
      list: route('GET', '/time/timesheets'),
      create: route('POST', '/time/timesheets'),
    },
    myTimesheet: { update: route('PUT', '/time/timesheets/{id}') },
    employeeTimesheets: {
      list: route('GET', '/time/employees/{empNumber}/timesheets'),
      create: route('POST', '/time/employees/{empNumber}/timesheets'),
    },
    employeeTimesheet: {
      update: route('PUT', '/time/employees/{empNumber}/timesheets/{id}'),
    },
    defaultTimesheet: { get: route('GET', '/time/timesheets/default') },
    myTimesheetEntries: {
      list: route('GET', '/time/timesheets/{timesheetId}/entries'),
      update: route('PUT', '/time/timesheets/{timesheetId}/entries'),
    },
    employeeTimesheetEntries: {
      list: route('GET', '/time/employees/timesheets/{timesheetId}/entries'),
      update: route('PUT', '/time/employees/timesheets/{timesheetId}/entries'),
    },
    timesheetActionLogs: {
      list: route('GET', '/time/timesheets/{timesheetId}/action-logs'),
    },
    validateTimesheetActivity: {
      get: route('GET', '/time/validation/{timesheetId}/project-activity'),
    },
    myTimesheetEntryComments: {
      update: route('PUT', '/time/timesheets/{timesheetId}/entries/comment'),
    },
    myTimesheetEntryComment: {
      get: route('GET', '/time/timesheets/{timesheetId}/entries/{id}/comment'),
    },
    timeFormat: { get: route('GET', '/time/config/time-format') },
    copyProjectActivity: {
      get: route('GET', '/time/projects/{toProjectId}/activities/copy/{fromProjectId}'),
      create: route('POST', '/time/projects/{toProjectId}/activities/copy/{fromProjectId}'),
    },
    employeeTimesheetList: {
      list: route('GET', '/time/employees/timesheets/list'),
    },
    reports: { list: route('GET', '/time/reports') },
    reportsData: { get: route('GET', '/time/reports/data') },
    projectAdmins: { list: route('GET', '/time/project-admins') },
  });
}

module.exports = { createTimeApi };
