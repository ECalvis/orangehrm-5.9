const { createRouteGroup } = require('../resource');

function createOpenIdApi(client) {
  return createRouteGroup(client, {
    providers: {
      list: { method: 'GET', path: '/auth/openid-providers' },
      create: { method: 'POST', path: '/auth/openid-providers' },
      delete: { method: 'DELETE', path: '/auth/openid-providers' },
      get: { method: 'GET', path: '/auth/openid-providers/{id}' },
      update: { method: 'PUT', path: '/auth/openid-providers/{id}' },
    },
  });
}

module.exports = { createOpenIdApi };
