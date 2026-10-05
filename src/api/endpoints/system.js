const { createRouteGroup } = require('../resource');

function createSystemApi(client) {
  return createRouteGroup(client, {
    check: {
      get: { method: 'GET', path: '/core/system-check' },
    },
  });
}

module.exports = { createSystemApi };
