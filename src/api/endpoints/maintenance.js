const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createMaintenanceApi(client) {
  return createRouteGroup(client, {
    purge: {
      delete: route('DELETE', '/maintenance/purge'),
    },
    purgeCandidates: {
      delete: route('DELETE', '/maintenance/candidates/purge'),
    },
    candidates: {
      list: route('GET', '/maintenance/candidates'),
    },
  });
}

module.exports = { createMaintenanceApi };
