const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createDashboardApi(client) {
  return createRouteGroup(client, {
    employeesOnLeave: { list: route('GET', '/dashboard/employees/leaves') },
    employeesBySubunit: { list: route('GET', '/dashboard/employees/subunit') },
    shortcuts: { list: route('GET', '/dashboard/shortcuts') },
    employeesByLocation: { list: route('GET', '/dashboard/employees/locations') },
    employeeTimeAtWork: { list: route('GET', '/dashboard/employees/time-at-work') },
    employeeActionSummary: {
      list: route('GET', '/dashboard/employees/action-summary'),
    },
    employeeOnLeaveTodayConfiguration: {
      get: route('GET', '/dashboard/config/employee-on-leave-today'),
      update: route('PUT', '/dashboard/config/employee-on-leave-today'),
    },
  });
}

module.exports = { createDashboardApi };
