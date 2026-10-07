const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createRecruitmentApi(client) {
  return createRouteGroup(client, {
    vacancies: {
      list: route('GET', '/recruitment/vacancies'),
      create: route('POST', '/recruitment/vacancies'),
      delete: route('DELETE', '/recruitment/vacancies'),
      get: route('GET', '/recruitment/vacancies/{id}'),
      update: route('PUT', '/recruitment/vacancies/{id}'),
    },
    vacancyAttachments: {
      list: route('GET', '/recruitment/vacancies/{vacancyId}/attachments'),
      update: route('PUT', '/recruitment/vacancies/{vacancyId}/attachments/{attachmentId}'),
      create: route('POST', '/recruitment/vacancy/attachments'),
      delete: route('DELETE', '/recruitment/vacancy/attachments'),
    },
    candidates: {
      list: route('GET', '/recruitment/candidates'),
      create: route('POST', '/recruitment/candidates'),
      delete: route('DELETE', '/recruitment/candidates'),
      get: route('GET', '/recruitment/candidates/{id}'),
      update: route('PUT', '/recruitment/candidates/{id}'),
      allowedActions: route('GET', '/recruitment/candidates/{candidateId}/actions/allowed'),
      reject: route('PUT', '/recruitment/candidates/{candidateId}/reject'),
      shortlist: route('PUT', '/recruitment/candidates/{candidateId}/shortlist'),
      scheduleInterview: route('POST', '/recruitment/candidates/{candidateId}/shedule-interview'),
      markInterviewPassed: route(
        'PUT',
        '/recruitment/candidates/{candidateId}/interviews/{interviewId}/pass',
      ),
      markInterviewFailed: route(
        'PUT',
        '/recruitment/candidates/{candidateId}/interviews/{interviewId}/fail',
      ),
      offerJob: route('PUT', '/recruitment/candidates/{candidateId}/job/offer'),
      declineOffer: route('PUT', '/recruitment/candidates/{candidateId}/job/decline'),
      hire: route('PUT', '/recruitment/candidates/{candidateId}/hire'),
    },
    candidateAttachment: {
      get: route('GET', '/recruitment/candidate/{candidateId}/attachment'),
      update: route('PUT', '/recruitment/candidate/{candidateId}/attachment'),
      create: route('POST', '/recruitment/candidate/attachments'),
    },
    candidateStatuses: { list: route('GET', '/recruitment/candidates/statuses') },
    hiringManagers: { list: route('GET', '/recruitment/hiring-managers') },
    candidateInterviews: {
      get: route('GET', '/recruitment/candidates/{candidateId}/interviews/{interviewId}'),
      update: route('PUT', '/recruitment/candidates/{candidateId}/interviews/{interviewId}'),
    },
    interviewAttachments: {
      list: route('GET', '/recruitment/interviews/{interviewId}/attachments'),
      create: route('POST', '/recruitment/interviews/{interviewId}/attachments'),
      delete: route('DELETE', '/recruitment/interviews/{interviewId}/attachments'),
      get: route('GET', '/recruitment/interviews/{interviewId}/attachments/{attachmentId}'),
      update: route('PUT', '/recruitment/interviews/{interviewId}/attachments/{attachmentId}'),
    },
    candidateHistory: {
      list: route('GET', '/recruitment/candidates/{candidateId}/history'),
      get: route('GET', '/recruitment/candidates/{candidateId}/history/{historyId}'),
      update: route('PUT', '/recruitment/candidates/{candidateId}/history/{historyId}'),
    },
    interviewers: { list: route('GET', '/recruitment/interviewers') },
  });
}

module.exports = { createRecruitmentApi };
