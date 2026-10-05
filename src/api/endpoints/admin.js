const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createAdminApi(client) {
  return createRouteGroup(client, {
    jobTitles: {
      list: route('GET', '/admin/job-titles'),
      create: route('POST', '/admin/job-titles'),
      delete: route('DELETE', '/admin/job-titles'),
      get: route('GET', '/admin/job-titles/{id}'),
      update: route('PUT', '/admin/job-titles/{id}'),
    },
    jobSpecification: {
      get: route('GET', '/admin/job-titles/{jobTitleId}/specification'),
      update: route('PUT', '/admin/job-titles/{jobTitleId}/specification'),
      delete: route('DELETE', '/admin/job-titles/{jobTitleId}/specification'),
    },
    jobCategories: {
      list: route('GET', '/admin/job-categories'),
      create: route('POST', '/admin/job-categories'),
      delete: route('DELETE', '/admin/job-categories'),
      get: route('GET', '/admin/job-categories/{id}'),
      update: route('PUT', '/admin/job-categories/{id}'),
    },
    users: {
      list: route('GET', '/admin/users'),
      get: route('GET', '/admin/users/{id}'),
      create: route('POST', '/admin/users'),
      update: route('PUT', '/admin/users/{id}'),
      delete: route('DELETE', '/admin/users'),
    },
    subunits: {
      list: route('GET', '/admin/subunits'),
      create: route('POST', '/admin/subunits'),
      get: route('GET', '/admin/subunits/{id}'),
      update: route('PUT', '/admin/subunits/{id}'),
      delete: route('DELETE', '/admin/subunits/{id}'),
    },
    employmentStatuses: {
      list: route('GET', '/admin/employment-statuses'),
      create: route('POST', '/admin/employment-statuses'),
      delete: route('DELETE', '/admin/employment-statuses'),
      get: route('GET', '/admin/employment-statuses/{id}'),
      update: route('PUT', '/admin/employment-statuses/{id}'),
    },
    educations: {
      list: route('GET', '/admin/educations'),
      create: route('POST', '/admin/educations'),
      delete: route('DELETE', '/admin/educations'),
      get: route('GET', '/admin/educations/{id}'),
      update: route('PUT', '/admin/educations/{id}'),
    },
    skills: {
      list: route('GET', '/admin/skills'),
      create: route('POST', '/admin/skills'),
      delete: route('DELETE', '/admin/skills'),
      get: route('GET', '/admin/skills/{id}'),
      update: route('PUT', '/admin/skills/{id}'),
    },
    licenses: {
      list: route('GET', '/admin/licenses'),
      create: route('POST', '/admin/licenses'),
      delete: route('DELETE', '/admin/licenses'),
      get: route('GET', '/admin/licenses/{id}'),
      update: route('PUT', '/admin/licenses/{id}'),
    },
    languages: {
      list: route('GET', '/admin/languages'),
      create: route('POST', '/admin/languages'),
      delete: route('DELETE', '/admin/languages'),
      get: route('GET', '/admin/languages/{id}'),
      update: route('PUT', '/admin/languages/{id}'),
    },
    memberships: {
      list: route('GET', '/admin/memberships'),
      create: route('POST', '/admin/memberships'),
      delete: route('DELETE', '/admin/memberships'),
      get: route('GET', '/admin/memberships/{id}'),
      update: route('PUT', '/admin/memberships/{id}'),
    },
    organization: {
      get: route('GET', '/admin/organization'),
      update: route('PUT', '/admin/organization'),
    },
    allowedPayGradeCurrencies: {
      list: route('GET', '/admin/pay-grades/{payGradeId}/currencies/allowed'),
    },
    payGrades: {
      list: route('GET', '/admin/pay-grades'),
      create: route('POST', '/admin/pay-grades'),
      delete: route('DELETE', '/admin/pay-grades'),
      get: route('GET', '/admin/pay-grades/{id}'),
      update: route('PUT', '/admin/pay-grades/{id}'),
    },
    payGradeCurrencies: {
      list: route('GET', '/admin/pay-grades/{payGradeId}/currencies'),
      create: route('POST', '/admin/pay-grades/{payGradeId}/currencies'),
      delete: route('DELETE', '/admin/pay-grades/{payGradeId}/currencies'),
      get: route('GET', '/admin/pay-grades/{payGradeId}/currencies/{id}'),
      update: route('PUT', '/admin/pay-grades/{payGradeId}/currencies/{id}'),
    },
    nationalities: {
      list: route('GET', '/admin/nationalities'),
      create: route('POST', '/admin/nationalities'),
      delete: route('DELETE', '/admin/nationalities'),
      get: route('GET', '/admin/nationalities/{id}'),
      update: route('PUT', '/admin/nationalities/{id}'),
    },
    emailConfiguration: {
      get: route('GET', '/admin/email-configuration'),
      update: route('PUT', '/admin/email-configuration'),
    },
    workShifts: {
      list: route('GET', '/admin/work-shifts'),
      create: route('POST', '/admin/work-shifts'),
      delete: route('DELETE', '/admin/work-shifts'),
      get: route('GET', '/admin/work-shifts/{id}'),
      update: route('PUT', '/admin/work-shifts/{id}'),
      employees: route('GET', '/admin/work-shifts/employees'),
    },
    locations: {
      list: route('GET', '/admin/locations'),
      create: route('POST', '/admin/locations'),
      delete: route('DELETE', '/admin/locations'),
      get: route('GET', '/admin/locations/{id}'),
      update: route('PUT', '/admin/locations/{id}'),
    },
    modules: {
      get: route('GET', '/admin/modules'),
      update: route('PUT', '/admin/modules'),
    },
    emailSubscriptions: {
      list: route('GET', '/admin/email-subscriptions'),
      update: route('PUT', '/admin/email-subscriptions/{id}'),
    },
    emailSubscribers: {
      list: route('GET', '/admin/email-subscriptions/{emailSubscriptionId}/subscribers'),
      create: route('POST', '/admin/email-subscriptions/{emailSubscriptionId}/subscribers'),
      delete: route('DELETE', '/admin/email-subscriptions/{emailSubscriptionId}/subscribers'),
      get: route('GET', '/admin/email-subscriptions/{emailSubscriptionId}/subscribers/{id}'),
      update: route('PUT', '/admin/email-subscriptions/{emailSubscriptionId}/subscribers/{id}'),
    },
    validateUserName: { get: route('GET', '/admin/validation/user-name') },
    localization: {
      get: route('GET', '/admin/localization'),
      update: route('PUT', '/admin/localization'),
    },
    i18nLanguages: {
      list: route('GET', '/admin/i18n/languages'),
      delete: route('DELETE', '/admin/i18n/languages'),
      get: route('GET', '/admin/i18n/languages/{id}'),
      update: route('PUT', '/admin/i18n/languages/{id}'),
    },
    i18nTranslationImport: {
      create: route('POST', '/admin/i18n/languages/{languageId}/import'),
    },
    i18nTranslations: {
      list: route('GET', '/admin/i18n/languages/{languageId}/translations'),
    },
    i18nBulkTranslations: {
      update: route('PUT', '/admin/i18n/languages/{languageId}/translations/bulk'),
    },
    i18nGroups: { list: route('GET', '/admin/i18n/groups') },
    validateI18nTranslation: {
      get: route('GET', '/admin/i18n/translation/{langStringId}/validate'),
    },
    i18nImportErrors: {
      list: route('GET', '/admin/i18n/languages/{languageId}/translations/errors'),
    },
    oauthClients: {
      list: route('GET', '/admin/oauth-clients'),
      create: route('POST', '/admin/oauth-clients'),
      delete: route('DELETE', '/admin/oauth-clients'),
      get: route('GET', '/admin/oauth-clients/{id}'),
      update: route('PUT', '/admin/oauth-clients/{id}'),
    },
  });
}

module.exports = { createAdminApi };
