const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createDirectoryApi(client) {
  return createRouteGroup(client, {
    employees: {
      list: route('GET', '/directory/employees'),
      get: route('GET', '/directory/employees/{empNumber}'),
    },
  });
}

module.exports = { createDirectoryApi };
