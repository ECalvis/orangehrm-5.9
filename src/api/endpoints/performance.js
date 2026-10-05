const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createPerformanceApi(client) {
  return createRouteGroup(client, {
    kpis: {
      list: route('GET', '/performance/kpis'),
      create: route('POST', '/performance/kpis'),
      delete: route('DELETE', '/performance/kpis'),
      get: route('GET', '/performance/kpis/{id}'),
      update: route('PUT', '/performance/kpis/{id}'),
    },
    supervisors: {
      list: route('GET', '/performance/supervisors'),
      create: route('POST', '/performance/supervisors'),
      delete: route('DELETE', '/performance/supervisors'),
    },
    reviews: {
      list: route('GET', '/performance/manage/reviews'),
      create: route('POST', '/performance/manage/reviews'),
      delete: route('DELETE', '/performance/manage/reviews'),
      get: route('GET', '/performance/manage/reviews/{id}'),
      update: route('PUT', '/performance/manage/reviews/{id}'),
      mine: route('GET', '/performance/reviews'),
      listForEmployees: route('GET', '/performance/employees/reviews'),
      allowedActions: route('GET', '/performance/reviews/{reviewId}/actions/allowed'),
      kpis: route('GET', '/performance/reviews/{reviewId}/kpis'),
      getSupervisorEvaluation: route(
        'GET',
        '/performance/reviews/{reviewId}/evaluation/supervisor',
      ),
      updateSupervisorEvaluation: route(
        'PUT',
        '/performance/reviews/{reviewId}/evaluation/supervisor',
      ),
      getEmployeeEvaluation: route('GET', '/performance/reviews/{reviewId}/evaluation/employee'),
      updateEmployeeEvaluation: route('PUT', '/performance/reviews/{reviewId}/evaluation/employee'),
      getFinalEvaluation: route('GET', '/performance/reviews/{reviewId}/evaluation/final'),
      updateFinalEvaluation: route('PUT', '/performance/reviews/{reviewId}/evaluation/final'),
    },
    trackers: {
      list: route('GET', '/performance/trackers'),
      listForEmployees: route('GET', '/performance/employees/trackers'),
      getForEmployee: route('GET', '/performance/employees/trackers/{id}'),
      reviewers: route('GET', '/performance/trackers/reviewers'),
    },
    trackerConfiguration: {
      list: route('GET', '/performance/config/trackers'),
      create: route('POST', '/performance/config/trackers'),
      delete: route('DELETE', '/performance/config/trackers'),
      get: route('GET', '/performance/config/trackers/{id}'),
      update: route('PUT', '/performance/config/trackers/{id}'),
    },
    trackerLogs: {
      list: route('GET', '/performance/trackers/{trackerId}/logs'),
      create: route('POST', '/performance/trackers/{trackerId}/logs'),
      delete: route('DELETE', '/performance/trackers/{trackerId}/logs'),
      get: route('GET', '/performance/trackers/{trackerId}/logs/{id}'),
      update: route('PUT', '/performance/trackers/{trackerId}/logs/{id}'),
    },
  });
}

module.exports = { createPerformanceApi };
