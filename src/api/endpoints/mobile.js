const { createRouteGroup } = require('../resource');

function createMobileApi(client) {
  return createRouteGroup(client, {
    menus: {
      list: { method: 'GET', path: '/mobile/menus' },
    },
  });
}

module.exports = { createMobileApi };
