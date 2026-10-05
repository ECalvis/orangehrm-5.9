const { createRouteGroup } = require('../resource');

function createWorkspaceNotificationsApi(client) {
  return createRouteGroup(client, {
    configuration: {
      get: { method: 'GET', path: '/admin/workspace-notification/config' },
      update: { method: 'PUT', path: '/admin/workspace-notification/config' },
    },
    testRegistrations: {
      create: {
        method: 'POST',
        path: '/admin/workspace-notification/registrations/test',
      },
    },
    testRegistration: {
      create: {
        method: 'POST',
        path: '/admin/workspace-notification/registrations/{id}/test',
      },
    },
    registrations: {
      list: { method: 'GET', path: '/admin/workspace-notification/registrations' },
      create: { method: 'POST', path: '/admin/workspace-notification/registrations' },
      delete: { method: 'DELETE', path: '/admin/workspace-notification/registrations' },
      get: { method: 'GET', path: '/admin/workspace-notification/registrations/{id}' },
      update: { method: 'PUT', path: '/admin/workspace-notification/registrations/{id}' },
    },
  });
}

module.exports = { createWorkspaceNotificationsApi };
