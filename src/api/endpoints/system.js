const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createSystemApi(client) {
  return createRouteGroup(client, {
    check: {
      get: route('GET', '/core/system-check'),
    },
  });
}

module.exports = { createSystemApi };
