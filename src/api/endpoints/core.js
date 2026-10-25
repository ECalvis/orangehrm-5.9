const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createCoreApi(client) {
  return createRouteGroup(client, {
    dataGroups: {
      list: route('GET', '/core/data-groups'),
      create: route('POST', '/core/data-groups'),
      delete: route('DELETE', '/core/data-groups'),
    },
    about: { get: route('GET', '/core/about') },
    publicVersion: { get: route('GET', '/core/public/version') },
    validateUnique: { get: route('GET', '/core/validation/unique') },
  });
}

module.exports = { createCoreApi };
