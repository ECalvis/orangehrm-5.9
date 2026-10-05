const { createRouteGroup } = require('../resource');

function createLdapApi(client) {
  return createRouteGroup(client, {
    configuration: {
      get: { method: 'GET', path: '/admin/ldap-config' },
      update: { method: 'PUT', path: '/admin/ldap-config' },
    },
    testConnection: {
      create: { method: 'POST', path: '/admin/ldap-test-connection' },
    },
    userSync: {
      get: { method: 'GET', path: '/admin/ldap/user-sync' },
      create: { method: 'POST', path: '/admin/ldap/user-sync' },
    },
  });
}

module.exports = { createLdapApi };
