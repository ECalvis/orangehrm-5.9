const { createRouteGroup } = require('../resource');

function createBrandingApi(client) {
  return createRouteGroup(client, {
    theme: {
      get: { method: 'GET', path: '/admin/theme' },
      update: { method: 'PUT', path: '/admin/theme' },
      delete: { method: 'DELETE', path: '/admin/theme' },
    },
    preview: {
      create: { method: 'POST', path: '/admin/theme/preview' },
    },
  });
}

module.exports = { createBrandingApi };
