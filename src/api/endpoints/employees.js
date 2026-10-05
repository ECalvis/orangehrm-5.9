const { createPimApi } = require('./pim');

function createEmployeesApi(client) {
  return createPimApi(client).employees;
}

module.exports = { createEmployeesApi, EmployeesApi: createEmployeesApi };
