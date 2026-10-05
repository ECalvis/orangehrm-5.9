const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createClaimApi(client) {
  return createRouteGroup(client, {
    events: {
      list: route('GET', '/claim/events'),
      create: route('POST', '/claim/events'),
      delete: route('DELETE', '/claim/events'),
      get: route('GET', '/claim/events/{id}'),
      update: route('PUT', '/claim/events/{id}'),
    },
    expenseTypes: {
      list: route('GET', '/claim/expenses/types'),
      create: route('POST', '/claim/expenses/types'),
      delete: route('DELETE', '/claim/expenses/types'),
      get: route('GET', '/claim/expenses/types/{id}'),
      update: route('PUT', '/claim/expenses/types/{id}'),
    },
    expenses: {
      list: route('GET', '/claim/requests/{requestId}/expenses'),
      create: route('POST', '/claim/requests/{requestId}/expenses'),
      delete: route('DELETE', '/claim/requests/{requestId}/expenses'),
      get: route('GET', '/claim/requests/{requestId}/expenses/{id}'),
      update: route('PUT', '/claim/requests/{requestId}/expenses/{id}'),
    },
    attachments: {
      list: route('GET', '/claim/requests/{requestId}/attachments'),
      create: route('POST', '/claim/requests/{requestId}/attachments'),
      delete: route('DELETE', '/claim/requests/{requestId}/attachments'),
      get: route('GET', '/claim/requests/{requestId}/attachments/{id}'),
      update: route('PUT', '/claim/requests/{requestId}/attachments/{id}'),
    },
    myRequests: {
      list: route('GET', '/claim/requests'),
      create: route('POST', '/claim/requests'),
      get: route('GET', '/claim/requests/{id}'),
    },
    employeeRequests: {
      create: route('POST', '/claim/employees/{empNumber}/requests'),
      list: route('GET', '/claim/employees/requests'),
      get: route('GET', '/claim/employees/{empNumber}/requests/{id}'),
    },
    requestAction: {
      get: route('GET', '/claim/requests/{requestId}/action'),
      update: route('PUT', '/claim/requests/{requestId}/action'),
    },
  });
}

module.exports = { createClaimApi };
