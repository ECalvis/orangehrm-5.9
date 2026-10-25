const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createLdapApi(client) {
  return createRouteGroup(client, {
    configuration: {
      get: route('GET', '/admin/ldap-config'),
      update: route('PUT', '/admin/ldap-config'),
    },
    testConnection: {
      create: route('POST', '/admin/ldap-test-connection'),
    },
    userSync: {
      get: route('GET', '/admin/ldap/user-sync'),
      create: route('POST', '/admin/ldap/user-sync'),
    },
  });
}

module.exports = { createLdapApi };
