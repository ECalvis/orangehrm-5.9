const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createEmployeesApi(client) {
  const routes = createRouteGroup(client, {
    employees: {
      list: route('GET', '/pim/employees'),
      get: route('GET', '/pim/employees/{empNumber}'),
      create: route('POST', '/pim/employees'),
      update: route('PUT', '/pim/employees/{empNumber}'),
      delete: route('DELETE', '/pim/employees'),
    },
  });

  return routes.employees;
}

module.exports = { createEmployeesApi, EmployeesApi: createEmployeesApi };
