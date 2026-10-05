const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createUsersApi(client) {
  const routes = createRouteGroup(client, {
    users: {
      list: route('GET', '/admin/users'),
      get: route('GET', '/admin/users/{id}'),
      create: route('POST', '/admin/users'),
      update: route('PUT', '/admin/users/{id}'),
      delete: route('DELETE', '/admin/users'),
    },
  });

  return routes.users;
}

module.exports = { createUsersApi, UsersApi: createUsersApi };
