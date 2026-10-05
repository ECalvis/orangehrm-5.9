const { createRouteGroup } = require('../resource');

function createAuthenticationApi(client) {
  return createRouteGroup(client, {
    validatePassword: {
      create: {
        method: 'POST',
        path: '/auth/public/validation/password',
      },
    },
  });
}

module.exports = { createAuthenticationApi };
