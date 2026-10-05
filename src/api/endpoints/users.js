const { createAdminApi } = require('./admin');

function createUsersApi(client) {
  return createAdminApi(client).users;
}

module.exports = { createUsersApi, UsersApi: createUsersApi };
