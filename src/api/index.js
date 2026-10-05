const { ApiClient } = require('./client');
const { EmployeesApi } = require('./endpoints/employees');
const { UsersApi } = require('./endpoints/users');

function createApi({ baseUrl, tokenManager, logger } = {}) {
  const client = new ApiClient({ baseUrl, tokenManager, logger });

  return {
    employees: new EmployeesApi(client),
    users: new UsersApi(client),
    _client: client,
  };
}

module.exports = { createApi };
