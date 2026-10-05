const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createAuthenticationApi(client) {
  return createRouteGroup(client, {
    validatePassword: {
      create: route('POST', '/auth/public/validation/password'),
    },
  });
}

module.exports = { createAuthenticationApi };
