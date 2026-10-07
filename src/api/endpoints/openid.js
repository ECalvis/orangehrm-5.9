const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createOpenIdApi(client) {
  return createRouteGroup(client, {
    providers: {
      list: route('GET', '/auth/openid-providers'),
      create: route('POST', '/auth/openid-providers'),
      delete: route('DELETE', '/auth/openid-providers'),
      get: route('GET', '/auth/openid-providers/{id}'),
      update: route('PUT', '/auth/openid-providers/{id}'),
    },
  });
}

module.exports = { createOpenIdApi };
