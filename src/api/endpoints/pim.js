const { createRouteGroup } = require('../resource');
const { employeeRoutes } = require('./employees');

const route = (method, path) => ({ method, path });

function createPimApi(client) {
  return createRouteGroup(client, {
    employees: employeeRoutes,
    employeePicture: {
      get: route('GET', '/pim/employees/{empNumber}/picture'),
      update: route('PUT', '/pim/employees/{empNumber}/picture'),
    },
    employeeCustomFields: {
      get: route('GET', '/pim/employees/{empNumber}/custom-fields'),
      update: route('PUT', '/pim/employees/{empNumber}/custom-fields'),
    },
    employeePersonalDetails: {
      get: route('GET', '/pim/employees/{empNumber}/personal-details'),
      update: route('PUT', '/pim/employees/{empNumber}/personal-details'),
    },
    employeeJobDetails: {
      get: route('GET', '/pim/employees/{empNumber}/job-details'),
      update: route('PUT', '/pim/employees/{empNumber}/job-details'),
    },
    employeeEmploymentContract: {
      get: route('GET', '/pim/employees/{empNumber}/employment-contract'),
      update: route('PUT', '/pim/employees/{empNumber}/employment-contract'),
    },
    employeeTerminations: {
      list: route('GET', '/pim/employees/{empNumber}/terminations'),
      get: route('GET', '/pim/employees/{empNumber}/terminations/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/terminations'),
      update: route('PUT', '/pim/employees/{empNumber}/terminations/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/terminations'),
    },
    employeeContactDetails: {
      get: route('GET', '/pim/employee/{empNumber}/contact-details'),
      update: route('PUT', '/pim/employee/{empNumber}/contact-details'),
    },
    employeeDependents: {
      list: route('GET', '/pim/employees/{empNumber}/dependents'),
      get: route('GET', '/pim/employees/{empNumber}/dependents/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/dependents'),
      update: route('PUT', '/pim/employees/{empNumber}/dependents/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/dependents'),
    },
    employeeSalaryComponents: {
      list: route('GET', '/pim/employees/{empNumber}/salary-components'),
      get: route('GET', '/pim/employees/{empNumber}/salary-components/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/salary-components'),
      update: route('PUT', '/pim/employees/{empNumber}/salary-components/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/salary-components'),
    },
    employeeAttachments: {
      list: route('GET', '/pim/employees/{empNumber}/screen/{screen}/attachments'),
      get: route('GET', '/pim/employees/{empNumber}/screen/{screen}/attachments/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/screen/{screen}/attachments'),
      update: route('PUT', '/pim/employees/{empNumber}/screen/{screen}/attachments/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/screen/{screen}/attachments'),
    },
    employeeEmergencyContacts: {
      list: route('GET', '/pim/employees/{empNumber}/emergency-contacts'),
      get: route('GET', '/pim/employees/{empNumber}/emergency-contacts/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/emergency-contacts'),
      update: route('PUT', '/pim/employees/{empNumber}/emergency-contacts/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/emergency-contacts'),
    },
    employeeSkills: {
      list: route('GET', '/pim/employees/{empNumber}/skills'),
      get: route('GET', '/pim/employees/{empNumber}/skills/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/skills'),
      update: route('PUT', '/pim/employees/{empNumber}/skills/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/skills'),
    },
    employeeAllowedSkills: {
      list: route('GET', '/pim/employees/{empNumber}/skills/allowed'),
      create: route('POST', '/pim/employees/{empNumber}/skills/allowed'),
      delete: route('DELETE', '/pim/employees/{empNumber}/skills/allowed'),
    },
    employeeEducations: {
      list: route('GET', '/pim/employees/{empNumber}/educations'),
      get: route('GET', '/pim/employees/{empNumber}/educations/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/educations'),
      update: route('PUT', '/pim/employees/{empNumber}/educations/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/educations'),
    },
    employeeLanguages: {
      list: route('GET', '/pim/employees/{empNumber}/languages'),
      create: route('POST', '/pim/employees/{empNumber}/languages'),
      delete: route('DELETE', '/pim/employees/{empNumber}/languages'),
      getFluency: route(
        'GET',
        '/pim/employees/{empNumber}/languages/{languageId}/fluencies/{fluencyId}',
      ),
      updateFluency: route(
        'PUT',
        '/pim/employees/{empNumber}/languages/{languageId}/fluencies/{fluencyId}',
      ),
    },
    employeeAllowedLanguages: {
      list: route('GET', '/pim/employees/{empNumber}/languages/allowed'),
      create: route('POST', '/pim/employees/{empNumber}/languages/allowed'),
      delete: route('DELETE', '/pim/employees/{empNumber}/languages/allowed'),
    },
    employeeWorkExperiences: {
      list: route('GET', '/pim/employees/{empNumber}/work-experiences'),
      get: route('GET', '/pim/employees/{empNumber}/work-experiences/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/work-experiences'),
      update: route('PUT', '/pim/employees/{empNumber}/work-experiences/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/work-experiences'),
    },
    employeeLicenses: {
      list: route('GET', '/pim/employees/{empNumber}/licenses'),
      get: route('GET', '/pim/employees/{empNumber}/licenses/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/licenses'),
      update: route('PUT', '/pim/employees/{empNumber}/licenses/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/licenses'),
    },
    employeeAllowedLicenses: {
      list: route('GET', '/pim/employees/{empNumber}/licenses/allowed'),
      create: route('POST', '/pim/employees/{empNumber}/licenses/allowed'),
      delete: route('DELETE', '/pim/employees/{empNumber}/licenses/allowed'),
    },
    employeeMemberships: {
      list: route('GET', '/pim/employees/{empNumber}/memberships'),
      get: route('GET', '/pim/employees/{empNumber}/memberships/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/memberships'),
      update: route('PUT', '/pim/employees/{empNumber}/memberships/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/memberships'),
    },
    employeeImmigrations: {
      list: route('GET', '/pim/employees/{empNumber}/immigrations'),
      get: route('GET', '/pim/employees/{empNumber}/immigrations/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/immigrations'),
      update: route('PUT', '/pim/employees/{empNumber}/immigrations/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/immigrations'),
    },
    employeeSupervisors: {
      list: route('GET', '/pim/employees/{empNumber}/supervisors'),
      get: route('GET', '/pim/employees/{empNumber}/supervisors/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/supervisors'),
      update: route('PUT', '/pim/employees/{empNumber}/supervisors/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/supervisors'),
    },
    employeeSubordinates: {
      list: route('GET', '/pim/employees/{empNumber}/subordinates'),
      get: route('GET', '/pim/employees/{empNumber}/subordinates/{id}'),
      create: route('POST', '/pim/employees/{empNumber}/subordinates'),
      update: route('PUT', '/pim/employees/{empNumber}/subordinates/{id}'),
      delete: route('DELETE', '/pim/employees/{empNumber}/subordinates'),
    },
    employeeAllowedReportTo: {
      list: route('GET', '/pim/employees/{empNumber}/report-to/allowed'),
    },
    employeeTaxExemption: {
      get: route('GET', '/pim/employees/{empNumber}/tax-exemption'),
      update: route('PUT', '/pim/employees/{empNumber}/tax-exemption'),
    },
    employeeWorkShift: {
      get: route('GET', '/pim/employees/{empNumber}/work-shift'),
    },
    csvImport: { create: route('POST', '/pim/csv-import') },
    reports: { list: route('GET', '/pim/reports') },
    reportsData: { get: route('GET', '/pim/reports/data') },
    definedReports: {
      list: route('GET', '/pim/reports/defined'),
      create: route('POST', '/pim/reports/defined'),
      delete: route('DELETE', '/pim/reports/defined'),
      get: route('GET', '/pim/reports/defined/{id}'),
      update: route('PUT', '/pim/reports/defined/{id}'),
    },
    updatePassword: { update: route('PUT', '/pim/update-password') },
    validateWorkEmail: {
      get: route('GET', '/pim/employees/{empNumber}/contact-details/validation/work-emails'),
    },
    validateOtherEmail: {
      get: route('GET', '/pim/employees/{empNumber}/contact-details/validation/other-emails'),
    },
    myself: { get: route('GET', '/pim/myself') },
    terminationReasons: {
      list: route('GET', '/pim/termination-reasons'),
      create: route('POST', '/pim/termination-reasons'),
      delete: route('DELETE', '/pim/termination-reasons'),
      get: route('GET', '/pim/termination-reasons/{id}'),
      update: route('PUT', '/pim/termination-reasons/{id}'),
    },
    reportingMethods: {
      list: route('GET', '/pim/reporting-methods'),
      create: route('POST', '/pim/reporting-methods'),
      delete: route('DELETE', '/pim/reporting-methods'),
      get: route('GET', '/pim/reporting-methods/{id}'),
      update: route('PUT', '/pim/reporting-methods/{id}'),
    },
    customFields: {
      list: route('GET', '/pim/custom-fields'),
      create: route('POST', '/pim/custom-fields'),
      delete: route('DELETE', '/pim/custom-fields'),
      get: route('GET', '/pim/custom-fields/{id}'),
      update: route('PUT', '/pim/custom-fields/{id}'),
    },
    optionalField: {
      get: route('GET', '/pim/optional-field'),
      update: route('PUT', '/pim/optional-field'),
    },
  });
}

module.exports = { createPimApi };
