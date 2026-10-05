const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createWorkspaceNotificationsApi(client) {
  return createRouteGroup(client, {
    configuration: {
      get: route('GET', '/admin/workspace-notification/config'),
      update: route('PUT', '/admin/workspace-notification/config'),
    },
    testRegistrations: {
      create: route('POST', '/admin/workspace-notification/registrations/test'),
    },
    testRegistration: {
      create: route('POST', '/admin/workspace-notification/registrations/{id}/test'),
    },
    registrations: {
      list: route('GET', '/admin/workspace-notification/registrations'),
      create: route('POST', '/admin/workspace-notification/registrations'),
      delete: route('DELETE', '/admin/workspace-notification/registrations'),
      get: route('GET', '/admin/workspace-notification/registrations/{id}'),
      update: route('PUT', '/admin/workspace-notification/registrations/{id}'),
    },
  });
}

module.exports = { createWorkspaceNotificationsApi };
