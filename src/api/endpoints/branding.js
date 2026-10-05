const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createBrandingApi(client) {
  return createRouteGroup(client, {
    theme: {
      get: route('GET', '/admin/theme'),
      update: route('PUT', '/admin/theme'),
      delete: route('DELETE', '/admin/theme'),
    },
    preview: {
      create: route('POST', '/admin/theme/preview'),
    },
  });
}

module.exports = { createBrandingApi };
