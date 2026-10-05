const { createRouteGroup } = require('../resource');

function createDirectoryApi(client) {
  return createRouteGroup(client, {
    employees: {
      list: { method: 'GET', path: '/directory/employees' },
      get: { method: 'GET', path: '/directory/employees/{empNumber}' },
    },
  });
}

module.exports = { createDirectoryApi };
