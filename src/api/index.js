const { ApiClient } = require('./client');
const { ApiError } = require('./errors');
const { EmployeesApi } = require('./endpoints/employees');
const { UsersApi } = require('./endpoints/users');
const { createAdminApi } = require('./endpoints/admin');
const { createAttendanceApi } = require('./endpoints/attendance');
const { createAuthenticationApi } = require('./endpoints/authentication');
const { createBrandingApi } = require('./endpoints/branding');
const { createBuzzApi } = require('./endpoints/buzz');
const { createClaimApi } = require('./endpoints/claim');
const { createCoreApi } = require('./endpoints/core');
const { createDashboardApi } = require('./endpoints/dashboard');
const { createDirectoryApi } = require('./endpoints/directory');
const { createLdapApi } = require('./endpoints/ldap');
const { createLeaveApi } = require('./endpoints/leave');
const { createMaintenanceApi } = require('./endpoints/maintenance');
const { createMobileApi } = require('./endpoints/mobile');
const { createOpenIdApi } = require('./endpoints/openid');
const { createPimApi } = require('./endpoints/pim');
const { createPerformanceApi } = require('./endpoints/performance');
const { createRecruitmentApi } = require('./endpoints/recruitment');
const { createSystemApi } = require('./endpoints/system');
const { createTimeApi } = require('./endpoints/time');
const { createWorkspaceNotificationsApi } = require('./endpoints/workspace-notifications');

function createApi({ baseUrl, tokenManager, logger } = {}) {
  const client = new ApiClient({ baseUrl, tokenManager, logger });

  return {
    pim: createPimApi(client),
    leave: createLeaveApi(client),
    admin: createAdminApi(client),
    time: createTimeApi(client),
    attendance: createAttendanceApi(client),
    recruitment: createRecruitmentApi(client),
    claim: createClaimApi(client),
    dashboard: createDashboardApi(client),
    core: createCoreApi(client),
    authentication: createAuthenticationApi(client),
    buzz: createBuzzApi(client),
    branding: createBrandingApi(client),
    directory: createDirectoryApi(client),
    ldap: createLdapApi(client),
    maintenance: createMaintenanceApi(client),
    mobile: createMobileApi(client),
    openid: createOpenIdApi(client),
    performance: createPerformanceApi(client),
    system: createSystemApi(client),
    workspaceNotifications: createWorkspaceNotificationsApi(client),
    employees: new EmployeesApi(client),
    users: new UsersApi(client),
    _client: client,
  };
}

module.exports = { createApi, ApiError };
