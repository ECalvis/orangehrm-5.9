const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createMobileApi(client) {
  return createRouteGroup(client, {
    menus: {
      list: route('GET', '/mobile/menus'),
    },
  });
}

module.exports = { createMobileApi };
