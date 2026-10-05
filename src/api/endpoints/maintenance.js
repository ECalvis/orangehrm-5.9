const { createRouteGroup } = require('../resource');

function createMaintenanceApi(client) {
  return createRouteGroup(client, {
    purge: {
      delete: { method: 'DELETE', path: '/maintenance/purge' },
    },
    purgeCandidates: {
      delete: { method: 'DELETE', path: '/maintenance/candidates/purge' },
    },
    candidates: {
      list: { method: 'GET', path: '/maintenance/candidates' },
    },
  });
}

module.exports = { createMaintenanceApi };
