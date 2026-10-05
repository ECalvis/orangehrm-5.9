const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createAttendanceApi(client) {
  return createRouteGroup(client, {
    configuration: {
      get: route('GET', '/attendance/configs'),
      update: route('PUT', '/attendance/configs'),
    },
    latestRecord: { get: route('GET', '/attendance/records/latest') },
    punchInOverlaps: { get: route('GET', '/attendance/punch-in/overlaps') },
    punchOutOverlaps: { get: route('GET', '/attendance/punch-out/overlaps') },
    myRecords: {
      list: route('GET', '/attendance/records'),
      create: route('POST', '/attendance/records'),
      update: route('PUT', '/attendance/records'),
      delete: route('DELETE', '/attendance/records'),
    },
    employeeRecords: {
      list: route('GET', '/attendance/employees/{empNumber}/records'),
      create: route('POST', '/attendance/employees/{empNumber}/records'),
      update: route('PUT', '/attendance/employees/{empNumber}/records'),
      delete: route('DELETE', '/attendance/employees/{empNumber}/records'),
    },
    employeeSummary: { list: route('GET', '/attendance/employees/summary') },
    timezones: { list: route('GET', '/attendance/timezones') },
    currentDateTime: { get: route('GET', '/attendance/current-datetime') },
    editPunchInOverlaps: { get: route('GET', '/attendance/records/punch-in-overlaps') },
    editPunchOutOverlaps: { get: route('GET', '/attendance/records/punch-out-overlaps') },
    record: {
      get: route('GET', '/attendance/records/{id}'),
      update: route('PUT', '/attendance/records/{id}'),
    },
  });
}

module.exports = { createAttendanceApi };
