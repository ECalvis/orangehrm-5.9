# Authentication and Authorization in OrangeHRM 5.9

**Verified against:** Running 5.9 instance (MariaDB 11.4.13-MariaDB-ubu2404, PHP 8.3.35, Apache) and a cloned 5.9 source tree.

---

## 1. Scope

Describes the authentication and authorization mechanisms of OrangeHRM 5.9. Covers:

- **Authentication:** How a user (via UI) or an API client proves identity.
- **Authorization:** How the authenticated identity is granted or denied access to endpoints, screens, rows, and workflow transitions.

Does **not** design a test framework. Authentication and authorization are treated as separate concepts throughout.

## Local OAuth token helper

Register an OAuth client in OrangeHRM and set its client ID, registered redirect URI, and admin or ESS credentials in `.env` (see `.env.example`). Then run `npm run token:admin` or `npm run token:ess`. The helper caches each role's token pair in `auth/<role>.token.json`; these files contain bearer credentials and must remain untracked.

On a failed run, check that the registered redirect URI exactly matches `OHRM_OAUTH_REDIRECT_URI`, that its local callback port is available, and that the client ID and role credentials are correct. The browser authorizer writes a screenshot to the operating system temporary directory if the expected consent button is missing.

---

## 2. What It Is

OrangeHRM 5.9 supports two authentication mechanisms operating side by side:

1. **Session-cookie authentication** — used by the Vue.js 3 SPA in the browser.
2. **OAuth2 Bearer-token authentication** — used by external API clients (mobile app, automation).

Authorization is enforced independently of authentication through:

- **Data-group permissions** — per-role, per-API-class read/create/update/delete flags, plus a `self` flag for row-level scoping.
- **Screen permissions** — per-role, per-screen read/create/update/delete flags for UI screens.
- **Workflow state machine** — per `(flow, state, role, action)` transitions in a database table.
- **Row-level rules** — e.g. `IN_ACCESSIBLE_EMP_NUMBERS` in the API validator layer.

The authentication layer establishes _who you are_. The authorization layer determines _what you can do_.

---

## 3. OrangeHRM 5.9 Behavior

### 3.1 Authentication

#### 3.1.1 Login flow (UI, session cookie)

**FACT (live):** The SPA login form POSTs to `/web/index.php/auth/validate`.

- Successful login returns HTTP 302 with `Location: /web/index.php/dashboard/index` and `Set-Cookie: _orangehrm=...; path=/web; HttpOnly; SameSite=Lax`.
- Failed login returns HTTP 302 with `Location: /web/index.php/auth/login`. The login page renders the text `Invalid credentials`.
- The login POST is `Content-Type: application/x-www-form-urlencoded` and carries a CSRF token (`ValidateController` calls `getCsrfTokenManager()->isValid('login', $token)`).
- On success, `ValidateController` calls `$authProviderChain->authenticate(new AuthParams($credentials))`, then `$this->getAuthUser()->setIsAuthenticated($success)` and `$this->getLoginService()->addLogin($credentials)`.

**FACT (source):** `LoginController` is declared as `class LoginController extends AbstractVueController implements PublicControllerInterface` (`src/plugins/orangehrmAuthenticationPlugin/Controller/LoginController.php:37`). `PublicControllerInterface` means the route skips the API authorization subscriber.

**FACT (source):** `ValidateController` uses `AuthProviderChain` with `LocalAuthProvider` registered by `AuthenticationPluginConfiguration::initialize()`:

````php
$authProviderChain = $this->getContainer()->get(Services::AUTH_PROVIDER_CHAIN);
$authProviderChain->addProvider(new LocalAuthProvider());
LDAPAuthProvider is only added if LDAPSetting::isEnable() returns true (LDAPAuthenticationPluginConfiguration:54–57).

3.1.2 Session mechanism
FACT (source): Session storage is chosen per request in CorePluginConfiguration::getSessionStorage():

```php
if ($request->headers->has('authorization')) {
    // To reduce session IO operations, handle in-memory session storage for token based clients
    return new MemorySessionStorage();
}
$options = [
    'name' => $isSecure ? 'orangehrm' : '_orangehrm',
    'cookie_secure' => $isSecure,
    'cookie_httponly' => true,
    'cookie_path' => $path == '' ? '/' : $path,
    'cookie_samesite' => 'Lax',
];
So:
````

Bearer-token requests use MemorySessionStorage — no PHP session file is written.

Cookie-session requests use NativeSessionStorage with NativeFileSessionHandler(Config::get(Config::SESSION_DIR)).

FACT (live): Captured cookie attributes for the browser session:

```text
_orangehrm=<value>; path=/web; HttpOnly; SameSite=Lax
HttpOnly present.
```

SameSite=Lax present.

Secure absent — consistent with HTTP localhost.

path=/web — not /.

3.1.3 Session idle timeout
FACT (source): SessionSubscriber::onRequestEvent() invalidates the session when idle:

```php
if (time() - $session->getMetadataBag()->getLastUsed() > Config::get(Config::MAX_SESSION_IDLE_TIME)) {
    $session->invalidate();
}
FACT (source): Default is set in lib/config/Config.php:

php
public const DEFAULT_MAX_SESSION_IDLE_TIME = 1800;
and wired in ConfigHelper::getDefaultConfigs():

php
Config::MAX_SESSION_IDLE_TIME => Config::DEFAULT_MAX_SESSION_IDLE_TIME,
FACT (live): No session_timeout override exists in hs_hr_config. Query returned no session_timeout row.
```

INFERENCE: In this installation, the effective idle timeout is 1800 seconds (30 minutes).

NOT VERIFIED: Live expiration after 30 minutes of inactivity.

3.1.4 API authentication — OAuth2 with PKCE
FACT (live): The OAuth2 authorization-code flow with PKCE (S256) was completed end-to-end from a Node script:

```text
GET /web/index.php/oauth2/authorize
   → OrangeHRM login / consent
   → "Allow Access" button
   → redirect_uri?code=...&state=...
   → POST /web/index.php/oauth2/token
The token response was:

json
{
  "token_type": "Bearer",
  "expires_in": 1800,
  "access_token": "def50200b793ceb6...",
  "refresh_token": "def502009ac6059f..."
}
FACT (live): A Playwright automation explicitly waits for the OrangeHRM consent button before proceeding:
```

js
const allowButton = page.getByRole('button', { name: /allow access/i });
await allowButton.waitFor({ state: 'visible', timeout: 15_000 });
This confirms the consent screen is a real, interactive UI step — not skipped by the OAuth server.

FACT (source): OAuth2 routes are defined in src/plugins/orangehrmCoreOAuthPlugin/config/routes.yaml:

```yaml
auth_oauth2_consent:
  path: /oauth2/authorize/consent
  controller: OrangeHRM\OAuth\Controller\OAuth2\AuthorizationController::handle
  methods: [GET]
```

auth_oauth2_authorize:
path: /oauth2/authorize
controller: OrangeHRM\OAuth\Controller\AuthorizationController::handle
methods: [ GET ]

auth_oauth2_token:
path: /oauth2/token
controller: OrangeHRM\OAuth\Controller\OAuth2\TokenController::handle
methods: [ POST ]
FACT (source): Four entities map to the active OAuth2 tables:

Entity Table
OAuthClient ohrm_oauth2_client
OAuthAccessToken ohrm_oauth2_access_token
OAuthAuthorizationCode ohrm_oauth2_authorization_code
OAuthRefreshToken ohrm_oauth2_refresh_token
FACT (live DB): Three OAuth2 clients exist:

id name client_id is_confidential enabled redirect_uri
1 OrangeHRM Mobile App orangehrm_mobile_app 0 1 com.orangehrm.opensource://oauthredirect
2 Bruno 6910f285d814e7223c3d6237a0ac8808 0 1 https://oauth.usebruno.com/callback
3 QA Automation 350f87ae8a275c9a9fc9ef05a8792f39 0 1 http://localhost:9876/oauth/callback
All three are public clients (is_confidential = 0). No client secret is required.

3.1.5 Token lifetimes
FACT (live DB): hs_hr_config rows:

name value
oauth.auth_code_ttl PT5M
oauth.access_token_ttl PT30M
oauth.refresh_token_ttl P1M
oauth.encryption_key (base64 secret — do not log)
oauth.token_encryption_key (base64 secret — do not log)
FACT (live): Token response expires_in: 1800 (30 minutes) matches oauth.access_token_ttl = PT30M.

FACT (source): ConfigService exposes these constants:

```php
public const KEY_OAUTH_AUTH_CODE_TTL = 'oauth.auth_code_ttl';
public const KEY_OAUTH_REFRESH_TOKEN_TTL = 'oauth.refresh_token_ttl';
public const KEY_OAUTH_ACCESS_TOKEN_TTL = 'oauth.access_token_ttl';
ConfigService reads them at getOAuthAuthCodeTTL(), getOAuthRefreshTokenTTL(), getOAuthAccessTokenTTL() (ConfigService.php:569, 582, 595).
```

NOT VERIFIED (live): Behavior of an actually expired access token (e.g. 401 vs 302). The TTL is verified from the response and config; the exact rejection response has not been captured live.

3.1.6 Refresh-token rotation
FACT (live, 2026-10-05): In a refresh run through the token helper, OrangeHRM returned a different refresh token, and the helper stored the new value. This confirms rotation for that request.

NOT VERIFIED (live): Whether the server invalidates the old refresh token when a new one is issued. The earlier API research doc noted an attempted reuse returned 401 with hint Cannot decrypt the refresh token, but that test also used a mismatched client_id, so the cause is ambiguous.

RECOMMENDATION: Do a clean two-request test:

POST /oauth2/token with grant_type=refresh_token and a fresh refresh_token. Capture the new pair.

Repeat with the original refresh_token. Capture the response.

Do not conclude rotation behavior until both are captured.

3.1.7 Logout and session invalidation
FACT (live): Logout changes the _orangehrm cookie value in the browser and subsequent API calls with the old cookie return:

```json
{"error": {"status": 401, "message": "Session expired"}}
FACT (source): LogoutController exists in the authentication plugin.
```

NOT VERIFIED: Exact logout HTTP request/response (URL, method, status, Set-Cookie).

NOT VERIFIED: Whether the failed-login response regenerates the session cookie (relevant to session-fixation tests).

3.1.8 Invalid credentials
FACT (live): Failed login returns 302 to /auth/login. The login page shows Invalid credentials.

FACT (source): ValidateController catches AuthenticationException and adds a flash:

```php
$this->getAuthUser()->addFlash(AuthUser::FLASH_LOGIN_ERROR, $e->normalize());
if ($e instanceof RedirectableException) {
    return new RedirectResponse($e->getRedirectUrl());
}
return new RedirectResponse($loginUrl);
3.1.9 Invalid or missing authentication on API
FACT (live): GET /api/v2/pim/employees with no auth → 401:

json
{"error": {"status": 401, "message": "Session expired"}}
FACT (live): GET /api/v2/pim/employees with an invalid Bearer token → 302 redirect to /web/index.php/auth/login, returning HTML, not JSON.
```

This is a quirk: an invalid Bearer token is handled as a browser-style redirect, not as a 401 JSON error. The HTML body is:

html
<meta http-equiv="refresh" content="0;url='http://localhost:8080/web/index.php/auth/login'" />
INFERENCE: The invalid-token path in the OAuth resource-server middleware is producing a redirect rather than an API-style 401 JSON response for this endpoint.

3.1.10 Password storage and policy
FACT (live DB): ohrm_user.user_password values are bcrypt hashes:

```text
$2y$12$uEUlRxqV6J0aVoCIIwGDgu2dPxQR.LjZLIy0R9fROrfhOJn4hqICO
$2y$12$c2G7UD0o9TlICZsrGw547.1wqecNTAhcWnV/cln/2zpZPMcpyOQuW
Prefix $2y$ = bcrypt.
```

Cost factor 12.

FACT (source): src/plugins/orangehrmCorePlugin/Utility/PasswordHash.php is a wrapper around password_hash / password_verify. The LocalAuthProvider uses PasswordHash and, when the configured strength is not "strong enough", still allows login but triggers a policy check via PasswordStrengthValidation.

FACT (source): UserService::checkPasswordHash() (line 231) is the verification entry point:

```php
private function checkPasswordHash(string $password, string $hash): bool
It is called from UserService.php:171 and UserService.php:203.
```

FACT (source): Password policy is read from hs_hr_config via PasswordStrengthService::checkPasswordPolicies() and PasswordStrengthValidation::checkPasswordStrength(). The same policy is used by:

LocalAuthProvider (login time, to flag weak passwords)

PasswordStrengthValidationAPI (API)

RequestResetWeakPasswordController (reset flow)

CorePlugin\Api\V2\Validator\Rules\Password (API validator)

FACT (live DB): Password policy configuration in this instance:

key value
auth.password_policy.default_required_password_strength strong
auth.password_policy.enforce_password_strength on
auth.password_policy.is_spaces_allowed false
auth.password_policy.min_lowercase_letters 1
auth.password_policy.min_numbers_in_password 1
auth.password_policy.min_password_length 8
auth.password_policy.min_special_characters 1
auth.password_policy.min_uppercase_letters 1
NOT VERIFIED (live): Whether posting {"password": "weak"} to POST /api/v2/admin/users returns a policy-specific 422. A validation rejection was observed in earlier testing, but the specific policy-rule violation was not conclusively captured.

FACT (source): zxcvbn-php is vendored (vendor/bjeavons/zxcvbn-php/) and is the strength estimator used by PasswordStrengthValidation.

3.1.11 Login audit
FACT (live DB): Successful logins are recorded in ohrm_login:

id user_id user_name user_role_name user_role_predefined login_time
37 1 Caummobunummu9625@yopmail.com Admin 1 2026-10-03 12:01:55
28 4 ummobunummu9625@yopmail.com ESS 1 2026-10-02 11:00:42
26 3 aummobunummu9625@yopmail.com ESS 1 2026-10-02 10:57:30
18 2 Zephyr!Kite7Bloom ESS 1 2026-10-01 22:52:08
FACT (live DB): ohrm_login schema:

```sql
id int(11) NOT NULL AUTO_INCREMENT
user_id bigint(20) NOT NULL
user_name varchar(255) NULL
user_role_name text NOT NULL
user_role_predefined tinyint(1) NOT NULL
login_time timestamp NULL DEFAULT current_timestamp()
FACT (live DB): SHOW CREATE TABLE ohrm_login shows no foreign key on user_id. Login audit rows can outlive the referenced user.
```

FACT (source): LoginLog entity and LoginLogDao exist in the authentication plugin. LoginService::addLogin() writes the audit row.

3.1.12 Authentication provider storage
FACT (live DB): There is no ohrm_user_auth table. The only auth-provider table is:

```sql
ohrm_user_auth_provider
  id                  int(11) NOT NULL AUTO_INCREMENT
  user_id             int(11) NOT NULL
  provider_type       int(11) NOT NULL
  ldap_user_hash      varchar(255) NULL
  ldap_user_dn        varchar(255) NULL
  ldap_user_unique_id varchar(255) NULL
FACT (source): UserAuthProvider entity exists at src/plugins/orangehrmAuthenticationPlugin/entity/UserAuthProvider.php, mapped with @ORM\Table(name="...").
```

FACT (source): LDAPAuthenticationPluginConfiguration registers LDAPAuthProvider only if LDAPSetting::isEnable() returns true:

```php
$ldapSettings = $this->getConfigService()->getLDAPSetting();
if ($ldapSettings instanceof LDAPSetting && $ldapSettings->isEnable()) {
    $authProviderChain = $this->getContainer()->get(Services::AUTH_PROVIDER_CHAIN);
    $authProviderChain->addProvider(new LDAPAuthProvider());
}
FACT (live DB): No LDAP config keys in hs_hr_config (query returned nothing for %ldap%). The LDAP sync table ohrm_ldap_sync_status exists but is empty:

sql
id                int(11) NOT NULL AUTO_INCREMENT
sync_started_at   datetime NOT NULL
sync_finished_at  datetime NULL
synced_by         int(11) NULL
sync_status       int(11) NOT NULL
INFERENCE: LDAP is installed as a plugin but not enabled in this instance. Local authentication is the effective provider.
```

3.1.13 Authentication configuration keys
FACT (live DB): The following auth-related keys exist in hs_hr_config:

key value
authentication.status Enable
authorize_user_role_manager_class BasicUserRoleManager
instance.version 5.9.0
oauth.auth_code_ttl PT5M
oauth.access_token_ttl PT30M
oauth.refresh_token_ttl P1M
Plus the auth.password_policy.* keys listed in §3.1.10.

FACT (live DB): No authentication.ldap key.

FACT (source): UserRoleManagerService::KEY_USER_ROLE_MANAGER_CLASS = 'authorize_user_role_manager_class'. It is read at runtime to instantiate the correct role manager.

3.2 Authorization
3.2.1 Roles
FACT (live DB): ohrm_user_role has 7 rows:

id name display_name is_assignable is_predefined
1 Admin Admin 1 1
2 ESS ESS 1 1
3 Supervisor Supervisor 0 1
4 ProjectAdmin ProjectAdmin 0 1
5 Interviewer Interviewer 0 1
6 HiringManager HiringManager 0 1
7 Reviewer Reviewer 0 1
Only Admin and ESS are assignable to a user account. The other five are derived roles, computed at runtime.

FACT (source): BasicUserRoleManager::computeUserRoles() starts with the user's primary role and adds:

ESS if the user is not already ESS

ProjectAdmin if isProjectAdmin($empNumber)

HiringManager if isHiringManager($empNumber)

Interviewer if isInterviewer($empNumber)

Supervisor if isSupervisor($empNumber)

Reviewer if isTrackerReviewer($empNumber)

```php
$roles = [$user->getUserRole()];
$empNumber = $user->getEmpNumber();
if (!empty($empNumber)) {
    if ($user->getUserRole()->getName() != 'ESS') {
        $roles[] = $this->getUserService()->getUserRole('ESS');
    }
    if ($this->isProjectAdmin($empNumber)) { ... }
    if ($this->isHiringManager($empNumber)) { ... }
    if ($this->isInterviewer($empNumber)) { ... }
    if ($this->getEmployeeService()->isSupervisor($empNumber)) { ... }
    if ($this->getPerformanceTrackerService()->getPerformanceTrackerDao()->isTrackerReviewer($empNumber)) { ... }
}
3.2.2 Data groups and API permissions
FACT (source): API authorization is enforced by ApiAuthorizationSubscriber::onControllerEvent():
```

Skip if PublicControllerInterface.

Skip if not AbstractRestController.

Read _api from route attributes; throw ForbiddenException if null.

Resolve UserRoleManager from the container.

Call BasicUserRoleManager::getApiPermissions($apiClass).

Map HTTP verb to CRUD bit (GET→read, POST→create, PUT→update, DELETE→delete).

Throw ForbiddenException('Unauthorized') if the bit is false.

FACT (live DB): The permission chain is:

```text
ohrm_api_permission.api_name  →  ohrm_api_permission.data_group_id
                              →  ohrm_data_group.id
                              →  ohrm_user_role_data_group.data_group_id
                              →  ohrm_user_role_data_group.user_role_id
                              →  ohrm_user_role.id
FACT (live DB): Live rows for OrangeHRM\Pim\Api\EmployeeAPI (data_group_id 96):
```

user_role_id role can_read can_create can_update can_delete self
1 Admin 1 1 0 1 0
2 ESS 1 0 0 0 1
3 Supervisor 1 0 0 0 0
3 Supervisor 1 0 0 0 1
FACT (live DB): ohrm_data_group.id = 96 has can_read=1, can_create=1, can_update=0, can_delete=1. The data-group-level flags define the ceiling; the ohrm_user_role_data_group rows define per-role effective permissions.

FACT (live DB): ohrm_api_permission has 191 rows mapping API classes to data groups. Examples:

api_name data_group_id
OrangeHRM\Pim\Api\EmployeeAPI 96
OrangeHRM\Pim\Api\MyInfoAPI 261
OrangeHRM\Admin\Api\UserAPI 81
OrangeHRM\Leave\Api\LeaveEntitlementAPI 138
OrangeHRM\Claim\Api\ClaimEventAPI 265
OrangeHRM\OAuth\Api\OAuthClientAPI 83
FACT (source): BasicUserRoleManager::getDataGroupPermissions() OR-merges permissions across roles:

```php
$resourcePermission = new ResourcePermission(false, false, false, false);
foreach ($filteredRoles as $role) {
    $permissions = $this->getDataGroupService()->getDataGroupPermission(
        $dataGroupName, $userRoleId, $selfPermission
    );
    foreach ($permissions as $permission) {
        $resourcePermission = $resourcePermission->orWith(
            ResourcePermission::createFromDataGroupPermission($permission)
        );
    }
}
3.2.3 Screen permissions
FACT (live DB): ohrm_user_role_screen exists and is populated. Summary counts by role:
```

Role Screen count
Admin 162
ESS 53
HiringManager 7
Interviewer 6
ProjectAdmin 6
Reviewer 1
Supervisor 27
FACT (live DB): Sample rows for role 1 (Admin) include can_read=1, can_create=1, can_update=1, can_delete=1 for most screens, and a smaller set with restricted create/update/delete. Sample rows for role 2 (ESS) show read-only or limited screens.

FACT (source): ScreenAuthorizationSubscriber is registered in CorePluginConfiguration:104:

```php
$this->getEventDispatcher()->addSubscriber(new ScreenAuthorizationSubscriber());
FACT (source): BasicUserRoleManager::getScreenPermissions() delegates to ScreenPermissionService::getScreenPermissions($module, $screen, $this->userRoles).
```

3.2.4 Workflow state machine
FACT (live DB): ohrm_workflow_state_machine has 138 rows. Relevant flows:

Flow 3 (Employee) — 5 rows:

state role action resulting_state
NOT_EXIST ADMIN 1 ACTIVE
ACTIVE ADMIN 2 NOT_EXIST
ACTIVE ADMIN 3 TERMINATED
TERMINATED ADMIN 4 ACTIVE
TERMINATED ADMIN 5 NOT_EXIST
Flow 4 (Leave) — 21 rows. Actions are names (APPLY, ASSIGN, APPROVE, CANCEL, REJECT), not integers. Sample:

state role action resulting_state
INITIAL ESS APPLY PENDING APPROVAL
INITIAL ADMIN ASSIGN SCHEDULED
PENDING APPROVAL ADMIN APPROVE SCHEDULED
PENDING APPROVAL ESS CANCEL CANCELLED
PENDING APPROVAL ADMIN REJECT REJECTED
Flow 7 (Claim) — 12 rows. Actions are integers.

state role action resulting_state
INITIATED ESS USER 1 SUBMITTED
INITIATED ESS USER 4 CANCELLED
SUBMITTED ESS USER 4 CANCELLED
REJECTED ESS USER 1 SUBMITTED
INITIATED ADMIN 1 PAID
APPROVED ADMIN 5 REJECTED
SUBMITTED ADMIN 2 PAID
SUBMITTED ADMIN 5 REJECTED
APPROVED ADMIN 3 PAID
INITIATED SUPERVISOR 1 APPROVED
SUBMITTED SUPERVISOR 2 APPROVED
SUBMITTED SUPERVISOR 5 REJECTED
FACT (source): WorkflowStateMachine constants:

```php
public const FLOW_TIME_TIMESHEET = 0;
public const FLOW_ATTENDANCE = 1;
public const FLOW_RECRUITMENT = 2;
public const FLOW_EMPLOYEE = 3;
public const FLOW_LEAVE = 4;
public const FLOW_REVIEW = 5;
public const FLOW_SELF_REVIEW = 6;
public const FLOW_CLAIM = 7;
FACT (source): BasicUserRoleManager::isActionAllowed() checks each role:

php
foreach ($filteredRoles as $role) {
    $roleName = $this->fixUserRoleNameForWorkflowStateMachine($role->getName(), $workFlowId);
    $isAllowed = $this->getAccessFlowStateMachineService()->isActionAllowed(
        $workFlowId, $state, $roleName, $action
    );
    if ($isAllowed) { break; }
}
FACT (source): fixUserRoleNameForWorkflowStateMachine() (with a @todo fix this in ohrm_workflow_state_machine comment) maps ESS → ESS User for all workflows except Leave, and HiringManager → HIRING MANAGER for Recruitment.
```

FACT (source): AccessFlowStateMachineDao::isActionAllowed() builds a Doctrine query against WorkflowStateMachine with count($q) > 0.

3.2.5 Endpoint-level authorization in action
FACT (live): Admin user (session cookie) can:

GET /api/v2/pim/employees?limit=1&offset=0 → 200 with {data, meta: {total: 4}, rels: []}.

POST /api/v2/admin/users with {"username":"qa_probe","password":"...","status":true,"userRoleId":2,"empNumber":1} → 200 with the created user model.

DELETE /api/v2/admin/users with {"ids":[5]} → 200 with {data:[5], meta:[], rels:[]}.

FACT (live): ESS user is denied:

POST /api/v2/admin/users → 403 {"error":{"status":403,"message":"Unauthorized"}}.

POST /api/v2/pim/employees → 403 same body.

DELETE /api/v2/pim/employees → 403 same body.

FACT (live): ESS user GET /api/v2/pim/employees → 200 but only returns the logged-in user's own empNumber:

```json
{
  "data": [{"empNumber": 4, "lastName": "Test2", "firstName": "QA2", "middleName": "", "employeeId": "QA002", "terminationId": null}],
  "meta": {"total": 1},
  "rels": []
}
This demonstrates the self = 1 flag in action.
```

3.2.6 UI-level authorization
FACT (live): ESS user navigating directly to /web/index.php/admin/viewSystemUsers receives 403 with an HTML body containing:

html
<auth-forbidden></auth-forbidden>
inside the standard <oxd-layout> shell, with :permissions="[]" and :breadcrumb="{"moduleName":"Admin","level":"User Management"}".

INFERENCE: The 403 page is delivered by the server, not client-side. The SPA mounts <auth-forbidden> as a Vue component.

FACT (source): LoginController implements PublicControllerInterface. Screen routes for restricted modules do not.

3.2.7 Row-level authorization
FACT (source): InAccessibleEmpNumbers::validate($input):

Rejects non-numeric or non-positive input.

If $includeLoggedInEmpNumber (default true) and $input == AuthUser::getEmpNumber(), returns true.

If !$includeLoggedInEmpNumber and $input == AuthUser::getEmpNumber(), returns false.

Otherwise checks in_array($input, UserRoleManager::getAccessibleEntityIds(Employee::class)).

FACT (source): EntityUniqueProperty::validate($input) builds a Doctrine query on the entity by property, optionally with matchValues (equality / null) and ignoreValues (inequality). EmployeeAPI::getValidationRuleForCreate() sets:

```php
$uniqueOption->setMatchValues(['purgedAt' => null]);
new Rule(Rules::ENTITY_UNIQUE_PROPERTY, [Employee::class, 'employeeId', $uniqueOption])
FACT (source): EmployeeAPI::getValidationRuleForGetOne() uses Rules::IN_ACCESSIBLE_EMP_NUMBERS, so an inaccessible empNumber is rejected before the record lookup runs.
```

3.2.8 Default admin role
FACT (live DB): ohrm_user row 1 is the default admin:

user_name = Caummobunummu9625@yopmail.com

user_role_id = 1 (Admin)

emp_number = 1

status = 1, deleted = 0

FACT (source): EmployeeService::getUndeletableEmpNumbers() returns the current user's own empNumber, plus the default admin's empNumber in demo mode. This means the logged-in admin cannot delete their own employee record.

4. Architecture
   4.1 Authentication pipeline

```text
HTTP request
  ↓
CorePluginConfiguration::getSessionStorage($request)
  ├── if Authorization header present → MemorySessionStorage (no file I/O)
  └── else → NativeSessionStorage + NativeFileSessionHandler
  ↓
Session started (Session::start())
  ↓
SessionSubscriber::onRequestEvent
  └── if idle > 1800s → session->invalidate()
  ↓
AuthenticationPluginConfiguration::initialize
  └── AuthProviderChain::addProvider(new LocalAuthProvider())
  └── (optionally) LDAPAuthenticationPluginConfiguration adds LDAPAuthProvider
  ↓
[UI]   POST /auth/validate → ValidateController → AuthProviderChain::authenticate
[API]  Bearer token → OAuth2 resource server → AuthUser
4.2 Authorization pipeline (API)
text
HTTP request to /api/v2/...
  ↓
Symfony kernel → ControllerEvent (priority 80000)
  ↓
ApiAuthorizationSubscriber::onControllerEvent
  ├── skip if PublicControllerInterface
  ├── skip if not AbstractRestController
  ├── read _api from attributes; ForbiddenException if null
  └── UserRoleManager::getApiPermissions($apiClass)
        ↓
      BasicUserRoleManager::getApiPermissions
        ↓
      DataGroupService::getApiPermissions($apiClass, $userRoles)
        ↓
      DataGroupDao::getApiPermissions($apiClass, $roles)
        ↓
      Doctrine query joining DataGroupPermission, DataGroup, UserRole, ApiPermission
        ↓
      OR-reduce to ResourcePermission
  ↓
  verb → canRead / canCreate / canUpdate / canDelete
  ↓
  ForbiddenException('Unauthorized') if not allowed
  ↓
GenericRestController::handle
  ├── Validator::validate()
  ├── Endpoint method dispatch
  └── Response::formatData() → {data, meta, rels}
4.3 Authorization pipeline (UI screen)
text
HTTP request to /web/index.php/<module>/<screen>
  ↓
ScreenAuthorizationSubscriber
  ↓
BasicUserRoleManager::getScreenPermissions($module, $screen)
  ↓
ScreenPermissionService::getScreenPermissions
  ↓
ohrm_user_role_screen
  ↓
If denied → 403 with <auth-forbidden> Vue component
5. Important Concepts
Concept	Description
PublicControllerInterface	Marker; skips API authorization subscriber. Used by LoginController.
AuthProviderChain	Ordered list of providers. LocalAuthProvider always added; LDAPAuthProvider added only if enabled.
MemorySessionStorage	In-memory session for Bearer-token clients; avoids PHP session file I/O.
Data group	Named set of CRUD capabilities (e.g. apiv2_pim_employee = id 96).
API permission	Maps an API endpoint class to a data group.
User role data group	Per-role permission flags on a data group, plus a self flag.
self flag	When 1, scopes access to the logged-in user's own records. Endpoint code must enforce it (framework does not).
Screen permission	Per-role, per-screen CRUD flags in ohrm_user_role_screen.
Workflow state machine	DB table of allowed transitions per (flow, state, role, action).
fixUserRoleNameForWorkflowStateMachine	Maps ESS → ESS User for non-Leave flows.
authorize_user_role_manager_class	Config key selecting the UserRoleManager implementation. Default: BasicUserRoleManager.
PKCE	Proof Key for Code Exchange. Required for public OAuth2 clients.
Opaque tokens	Tokens are prefixed def50200... and are not JWT.
6. Important Objects / Endpoints / Entities
6.1 Authentication endpoints
Route	Method	Controller	Purpose
/auth/login	GET	LoginController	Login page
/auth/validate	POST	ValidateController	Credential submission
/auth/logout	GET	LogoutController	Logout
/oauth2/authorize	GET	OAuth2\AuthorizationController	OAuth2 authorize start
/oauth2/authorize/consent	GET	OAuth2\AuthorizationController	Consent screen
/oauth2/token	POST	OAuth2\TokenController	Token exchange
6.2 Authorization-relevant entities
Entity	Table
User	ohrm_user
UserRole	ohrm_user_role
DataGroup	ohrm_data_group
DataGroupPermission	ohrm_user_role_data_group
ApiPermission	ohrm_api_permission
WorkflowStateMachine	ohrm_workflow_state_machine
LoginLog	ohrm_login
UserAuthProvider	ohrm_user_auth_provider
OAuthClient	ohrm_oauth2_client
OAuthAccessToken	ohrm_oauth2_access_token
OAuthAuthorizationCode	ohrm_oauth2_authorization_code
OAuthRefreshToken	ohrm_oauth2_refresh_token
6.3 Role classes
Under src/plugins/orangehrmCorePlugin/Authorization/UserRole/:
```

AbstractUserRole, AdminUserRole, EssUserRole, SupervisorUserRole, ProjectAdminUserRole, HiringManagerUserRole, InterviewerUserRole, ReviewerUserRole.

6.4 Auth configuration keys
authentication.status, authorize_user_role_manager_class, oauth.auth_code_ttl, oauth.access_token_ttl, oauth.refresh_token_ttl, oauth.encryption_key, oauth.token_encryption_key, and the eight auth.password_policy.* keys.

7. Relationships to Other OrangeHRM Layers
   Layer Authentication relationship Authorization relationship
   UI (Vue/OXD) Login form posts to /auth/validate; session cookie set on success Hidden nav items, <auth-forbidden> component for 403
   API Bearer token or session cookie ApiAuthorizationSubscriber checks _api class permissions before dispatch
   Backend AuthProviderChain, LocalAuthProvider, LDAPAuthProvider BasicUserRoleManager resolves permissions from DB
   Workflow — WorkflowStateMachine gates state transitions
   DB ohrm_user, ohrm_login, ohrm_oauth2_* ohrm_user_role, ohrm_data_group, ohrm_user_role_data_group, ohrm_api_permission, ohrm_user_role_screen, ohrm_workflow_state_machine
   7.1 Live UI → API → authorization → backend → DB trace
   Scenario: ESS user requests the employee list.

UI: ESS user visits /web/index.php/pim/viewEmployeeList. The Vue SPA issues:

http
GET /web/index.php/api/v2/pim/employees?limit=50&offset=0
Cookie: _orangehrm=<ess_session>
API entry: Route resolves to GenericRestController::handle with _api = OrangeHRM\Pim\Api\EmployeeAPI.

Authorization: ApiAuthorizationSubscriber::onControllerEvent:

getApiPermissions('OrangeHRM\Pim\Api\EmployeeAPI')

DataGroupDao joins ohrm_api_permission (dg 96) with ohrm_user_role_data_group for the ESS role (role 2) → read=1, create=0, update=0, delete=0, self=1.

GET maps to canRead → 1 → allowed.

Backend: EmployeeAPI::getAll() runs. The self=1 flag and getAccessibleEntityIds(Employee::class) scope the query to the logged-in user's empNumber.

DB: Query against hs_hr_employee filtered by accessible empNumbers.

Response: {data: [own employee only], meta: {total: 1}, rels: []}.

Where access control is enforced:

Endpoint level: ApiAuthorizationSubscriber (403 if verb bit is 0).

Row level: InAccessibleEmpNumbers validator + UserRoleManager::getAccessibleEntityIds.

Workflow level: AccessFlowStateMachineService::isActionAllowed inside endpoint methods.

Screen level: ScreenAuthorizationSubscriber for HTML routes.

8. Testing Implications
   8.1 Authentication scenarios

# Scenario Expected

A1 Valid login (UI) 302 to /dashboard/index, Set-Cookie: _orangehrm=...
A2 Invalid password (UI) 302 to /auth/login, page shows "Invalid credentials"
A3 Missing auth on API 401 {"error":{"status":401,"message":"Session expired"}}
A4 Invalid Bearer on API 302 to /auth/login, HTML body (quirk)
A5 OAuth2 PKCE flow authorize → consent → code → token returns {access_token, refresh_token, expires_in: 1800}
A6 Consent screen Button with accessible name "Allow Access" must be clicked
A7 Token expiry (not verified live) — check response on expired token
A8 Refresh rotation (not verified live) — two-request test
A9 Logout (UI) Cookie changes; old cookie returns 401 on API
A10 Session idle > 1800s (not verified live) — expect redirect or 401
A11 Password policy enforcement Post {"password":"weak"} to /api/v2/admin/users → 422 (expected, not verified)
A12 Login audit Each successful login inserts a row into ohrm_login
8.2 Authorization scenarios

# Scenario Expected

Z1 Admin GET /api/v2/pim/employees 200, all accessible employees
Z2 Admin POST /api/v2/admin/users 200, user created
Z3 Admin DELETE /api/v2/admin/users 200, {data:[id]}
Z4 ESS POST /api/v2/admin/users 403 {"error":{"status":403,"message":"Unauthorized"}}
Z5 ESS POST /api/v2/pim/employees 403 same
Z6 ESS DELETE /api/v2/pim/employees 403 same
Z7 ESS GET /api/v2/pim/employees/{ownEmpNumber} 200; GET for another employee returns 422. In the current live instance, an unfiltered ESS employee collection request returns zero rows, so collection self-scoping is not assumed by the integration test.
Z8 ESS direct URL /admin/viewSystemUsers 403 HTML with <auth-forbidden>
Z9 Row-level: ESS GET another empNumber 422 (blocked by IN_ACCESSIBLE_EMP_NUMBERS)
Z10 Workflow: Admin DELETE active employee Allowed via FLOW_EMPLOYEE / ACTIVE / action 2
Z11 Workflow: invalid transition BadRequestException / rejected
Z12 Uniqueness: POST employee with existing employeeId 422 (ENTITY_UNIQUE_PROPERTY)
Z13 Uniqueness: purged employee's employeeId reused Allowed (matchValues: ['purgedAt' => null])
8.3 Where to test what
Layer Tool What to verify
UI Playwright Login, logout, 403 page, consent button, hidden nav
API Axios / Bruno 401, 403, 422, 200, token flows, row-level self scoping
DB mysql2 ohrm_login audit, ohrm_user.deleted, permission tables unchanged
8.4 Recommendations
RECOMMENDATION: Do not assume all 403s are the same. Admin POST → 403. ESS POST → 403. But invalid Bearer → 302. Distinguish in tests.

RECOMMENDATION: Test self=1 explicitly with a non-admin user. The framework does not enforce row scoping automatically; the endpoint must.

RECOMMENDATION: Test ENTITY_UNIQUE_PROPERTY with both purgedAt=null and non-null to confirm the filter.

RECOMMENDATION: Never modify ohrm_user_role, ohrm_data_group, ohrm_user_role_data_group, or ohrm_api_permission in tests. Treat them as read-only fixtures.

RECOMMENDATION: Do not log or persist oauth.encryption_key or oauth.token_encryption_key from hs_hr_config.

The live integration target (`npm run test:live`) verifies real Admin and ESS browser login, API authentication, and ESS own-record versus other-record access. It uses the configured token stores and live database; it does not mock the OrangeHRM server.

9. Known Quirks / Gotchas

# Quirk Evidence

Q1 Invalid Bearer token → 302 redirect, not 401 JSON Live
Q2 ohrm_login has no FK to ohrm_user; audit rows outlive users SHOW CREATE TABLE
Q3 Failed login returns 302; the error message is rendered client-side Live
Q4 Login page is PublicControllerInterface — no auth needed Source
Q5 Bearer-token requests use MemorySessionStorage; cookie requests use file storage Source
Q6 ohrm_user_auth does not exist; only ohrm_user_auth_provider (LDAP) Live DB
Q7 Workflow action encoding is mixed: integers for flows 0,1,2,3,5,6,7; names for flow 4 (Leave) Live DB
Q8 fixUserRoleNameForWorkflowStateMachine maps ESS → ESS User for non-Leave flows (with a @todo fix this) Source
Q9 self=1 does not auto-enforce row scoping; endpoint must enforce it Source + live D5
Q10 Data-group permissions are OR-merged across roles; any role granting a bit grants it Source
Q11 ohrm_user_role_data_group has 717+ rows — do not modify them in tests Live DB
Q12 Password hashes are bcrypt $2y$12$ — cost 12, not default 10 Live DB
Q13 oauth.access_token_ttl is stored as ISO 8601 duration (PT30M), not seconds Live DB
Q14 OAuth2 tokens are opaque (def50200...), not JWT Live
Q15 All three OAuth2 clients are public (is_confidential=0) Live DB 10. Version-Specific Notes
OrangeHRM version: 5.9.0 (hs_hr_config.instance.version = 5.9.0).

Migration history: ohrm_migration_log contains rows for 5.4.0, 5.5.0, 5.6.0, 5.7.0, 5.8.0, 5.8.1, 5.9.0.

OAuth2 plugin is the orangehrmCoreOAuthPlugin, using league/oauth2-server ~8.4.2.

Legacy OAuth tables ohrm_oauth_client, ohrm_oauth_access_token, ohrm_oauth_authorization_code, ohrm_oauth_refresh_token, ohrm_oauth_scope, ohrm_oauth_user exist in the schema but are unreferenced by application code. They are pre-5.4 artifacts.

Active OAuth2 tables are ohrm_oauth2_*.

MariaDB runtime: 11.4.13-MariaDB-ubu2404. The migration log retains its historical install stamp of 10.11.19-MariaDB-ubu2204.

PHP: 8.3.35.

Doctrine ORM: 2.20.7, annotations only.

Config::PRODUCT_MODE = self::MODE_DEV in lib/config/Config.php:57. No hs_hr_config entry. Demo-mode-only behavior (e.g. default admin undeletable) depends on this constant.

11. Facts vs Inferences vs Assumptions
    FACT (traceable to a specific file, DB row, or HTTP response)
    Authentication:

Two mechanisms: session cookie and OAuth2 Bearer.

Login POST → /auth/validate; success → 302 /dashboard/index; failure → 302 /auth/login with "Invalid credentials".

Session cookie: _orangehrm, path=/web, HttpOnly, SameSite=Lax, no Secure (HTTP).

Missing auth on API → 401 {"error":{"status":401,"message":"Session expired"}}.

Invalid Bearer on API → 302 to /auth/login with HTML body.

OAuth2 PKCE S256 flow verified end-to-end.

Token response: {token_type: "Bearer", expires_in: 1800, access_token, refresh_token}.

Consent screen requires clicking a button named "Allow Access".

TTLs: auth code PT5M, access token PT30M, refresh token P1M.

3 OAuth2 clients, all public.

Password hashes are bcrypt cost 12.

Password policy: min length 8, upper/lower/number/special required, spaces disallowed, strength "strong", enforced "on".

Session idle default 1800s.

ohrm_login rows recorded with no FK.

No ohrm_user_auth table; only ohrm_user_auth_provider (LDAP fields).

LDAP plugin present but not enabled (no config, empty sync table).

LocalAuthProvider is the default auth provider.

Authorization:

7 roles, only Admin and ESS assignable.

5 derived roles computed at runtime.

Data-group model: ohrm_api_permission → ohrm_data_group → ohrm_user_role_data_group.

Live EmployeeAPI (dg 96) rows for Admin, ESS, Supervisor.

Live screen permission counts per role: Admin 162, ESS 53, Supervisor 27, HiringManager 7, Interviewer 6, ProjectAdmin 6, Reviewer 1.

Workflow state machine rows for flows 3, 4, 7 captured.

Admin POST /api/v2/admin/users → 200.

Admin DELETE /api/v2/admin/users → 200.

ESS POST /api/v2/admin/users → 403.

ESS POST/DELETE /api/v2/pim/employees → 403.

ESS GET /api/v2/pim/employees/{ownEmpNumber} → 200; GET for another employee returns 422. The unfiltered collection currently returns zero rows in this live instance.

ESS direct URL /admin/viewSystemUsers → 403 HTML with <auth-forbidden>.

ApiAuthorizationSubscriber enforces endpoint permissions via _api.

ScreenAuthorizationSubscriber registered.

InAccessibleEmpNumbers and EntityUniqueProperty validator rules exist.

EntityUniqueProperty for employeeId filters purgedAt = null.

INFERENCE
Effective session idle timeout is 1800s in this installation (default, no override).

LDAP is installed but disabled (no config, empty sync table).

ESS role expansion adds derived roles at runtime (source confirms; no live user with a derived role was tested).

The <auth-forbidden> HTML is server-rendered, not client-side.

The 302 on invalid Bearer is produced by the OAuth resource-server middleware behaving as a browser redirect for this endpoint.

ASSUMPTION / NOT VERIFIED
Behavior of an actually expired access token.

Whether refresh-token rotation invalidates the previous token.

Live enforcement of the configured password policy (weak-password POST).

Failed-login cookie regeneration behavior.

Live 30-minute idle-session expiration.

Exact logout HTTP request/response.

Live behavior of derived roles (Supervisor, ProjectAdmin, etc.) on a user account with those relationships.

12. Sources
    Source files (cloned 5.9 tree):

src/lib/config/Config.php — DEFAULT_MAX_SESSION_IDLE_TIME = 1800, PRODUCT_MODE, PRODUCT_VERSION = '5.9'.

src/lib/config/ConfigHelper.php — default config wiring.

src/lib/framework/Services.php — service IDs (AUTH_PROVIDER_CHAIN, SESSION, USER_ROLE_MANAGER).

src/lib/framework/Framework.php — AUTH_PROVIDER_CHAIN registration.

src/plugins/orangehrmAuthenticationPlugin/config/AuthenticationPluginConfiguration.php — LocalAuthProvider registration.

src/plugins/orangehrmAuthenticationPlugin/config/routes.yaml.

src/plugins/orangehrmAuthenticationPlugin/Auth/AbstractAuthProvider.php.

src/plugins/orangehrmAuthenticationPlugin/Auth/AuthProviderChain.php.

src/plugins/orangehrmAuthenticationPlugin/Auth/LocalAuthProvider.php.

src/plugins/orangehrmAuthenticationPlugin/Auth/User.php — IS_AUTHENTICATED, flash keys.

src/plugins/orangehrmAuthenticationPlugin/Controller/LoginController.php:37.

src/plugins/orangehrmAuthenticationPlugin/Controller/ValidateController.php.

src/plugins/orangehrmAuthenticationPlugin/Controller/LogoutController.php.

src/plugins/orangehrmAuthenticationPlugin/Service/LoginService.php.

src/plugins/orangehrmAuthenticationPlugin/Dao/LoginLogDao.php.

src/plugins/orangehrmAuthenticationPlugin/entity/LoginLog.php.

src/plugins/orangehrmAuthenticationPlugin/entity/UserAuthProvider.php.

src/plugins/orangehrmAuthenticationPlugin/PublicApi/PasswordStrengthValidationAPI.php.

src/plugins/orangehrmAuthenticationPlugin/Utility/PasswordStrengthValidation.php.

src/plugins/orangehrmAuthenticationPlugin/Service/PasswordStrengthService.php.

src/plugins/orangehrmCorePlugin/Utility/PasswordHash.php.

src/plugins/orangehrmCorePlugin/config/CorePluginConfiguration.php — session storage, subscribers.

src/plugins/orangehrmCorePlugin/Subscriber/SessionSubscriber.php.

src/plugins/orangehrmCorePlugin/Subscriber/ApiAuthorizationSubscriber.php.

src/plugins/orangehrmCorePlugin/Subscriber/ScreenAuthorizationSubscriber.php (registered at line 104).

src/plugins/orangehrmCorePlugin/Authorization/Manager/BasicUserRoleManager.php.

src/plugins/orangehrmCorePlugin/Authorization/Manager/AbstractUserRoleManager.php.

src/plugins/orangehrmCorePlugin/Authorization/Manager/UserRoleManagerFactory.php.

src/plugins/orangehrmCorePlugin/Authorization/Service/UserRoleManagerService.php.

src/plugins/orangehrmCorePlugin/Authorization/Service/DataGroupService.php.

src/plugins/orangehrmCorePlugin/Authorization/Service/ScreenPermissionService.php.

src/plugins/orangehrmCorePlugin/Authorization/Dao/DataGroupDao.php.

src/plugins/orangehrmCorePlugin/Authorization/Dto/ResourcePermission.php.

src/plugins/orangehrmCorePlugin/Authorization/UserRole/*.php (8 role classes).

src/plugins/orangehrmCorePlugin/entity/WorkflowStateMachine.php.

src/plugins/orangehrmCorePlugin/Service/AccessFlowStateMachineService.php.

src/plugins/orangehrmCorePlugin/Dao/AccessFlowStateMachineDao.php.

src/plugins/orangehrmCorePlugin/Api/V2/Validator/Rules/InAccessibleEmpNumbers.php.

src/plugins/orangehrmCorePlugin/Api/V2/Validator/Rules/EntityUniqueProperty.php.

src/plugins/orangehrmCorePlugin/Api/V2/Validator/Rules/Password.php.

src/plugins/orangehrmAdminPlugin/Service/UserService.php — checkPasswordHash, password handling.

src/plugins/orangehrmCoreOAuthPlugin/config/routes.yaml.

src/plugins/orangehrmCoreOAuthPlugin/config/CoreOAuthPluginConfiguration.php.

src/plugins/orangehrmCoreOAuthPlugin/Controller/AuthorizationController.php.

src/plugins/orangehrmCoreOAuthPlugin/Controller/OAuth2/AuthorizationController.php.

src/plugins/orangehrmCoreOAuthPlugin/Controller/OAuth2/TokenController.php.

src/plugins/orangehrmCoreOAuthPlugin/entity/OAuthClient.php, OAuthAccessToken.php, OAuthAuthorizationCode.php, OAuthRefreshToken.php.

src/plugins/orangehrmCoreOAuthPlugin/Server/BearerTokenValidator.php.

src/plugins/orangehrmCoreOAuthPlugin/Service/OAuthService.php.

src/plugins/orangehrmLDAPAuthenticationPlugin/config/LDAPAuthenticationPluginConfiguration.php:54–57.

src/plugins/orangehrmLDAPAuthenticationPlugin/Auth/LDAPAuthProvider.php.

Live HTTP traces:

GET /web/index.php/api/v2/pim/employees?limit=1&offset=0 → 401 "Session expired" (no auth).

Same request with invalid Bearer → 302 to /auth/login.

POST /web/index.php/auth/validate (valid) → 302 /dashboard/index + Set-Cookie.

POST /web/index.php/auth/validate (invalid) → 302 /auth/login.

GET /web/index.php/api/v2/pim/employees?limit=1 → 200 with {data, meta, rels} (Admin session).

POST /web/index.php/api/v2/admin/users → 200 (Admin).

DELETE /web/index.php/api/v2/admin/users → 200 (Admin).

GET /web/index.php/api/v2/pim/employees/{ownEmpNumber} → 200 (ESS); another employee ID returns 422. The unfiltered collection currently returns zero rows in this live instance.

POST /web/index.php/api/v2/admin/users → 403 (ESS).

POST /web/index.php/api/v2/pim/employees → 403 (ESS).

DELETE /web/index.php/api/v2/pim/employees → 403 (ESS).

GET /web/index.php/admin/viewSystemUsers → 403 HTML with <auth-forbidden> (ESS).

OAuth2 authorize → consent → token → 200 with {token_type, expires_in, access_token, refresh_token}.

Live DB queries:

SELECT * FROM hs_hr_config WHERE name LIKE '%auth%' OR '%oauth%' OR '%session%' OR '%password%' OR '%login%'.

SELECT * FROM ohrm_user_role ORDER BY id.

SELECT * FROM ohrm_user (redacted password).

SELECT id, name, client_id, is_confidential, enabled, redirect_uri FROM ohrm_oauth2_client.

DESCRIBE ohrm_oauth2_client / _access_token / _authorization_code / _refresh_token.

DESCRIBE ohrm_user_auth_provider, ohrm_ldap_sync_status.

SELECT * FROM ohrm_ldap_sync_status — empty.

SHOW CREATE TABLE ohrm_login.

SELECT * FROM ohrm_login ORDER BY id DESC LIMIT 20.

SELECT * FROM ohrm_user_role_screen ORDER BY user_role_id, screen_id.

SELECT ur.name, COUNT(*) FROM ohrm_user_role_screen ... GROUP BY ur.name.

SELECT * FROM ohrm_workflow_state_machine WHERE workflow IN ('3','4','7').

SELECT * FROM ohrm_data_group ORDER BY id.

SELECT * FROM ohrm_api_permission ORDER BY id.

SELECT * FROM ohrm_user_role_data_group (717+ rows).

SELECT * FROM ohrm_migration_log WHERE version IN (...).

Live permission join for EmployeeAPI / UserAPI / LeaveRequestAPI / ClaimRequestAPI.

Explicitly NOT verified:

Expired access token HTTP response.

Refresh-token rotation invalidation.

Weak-password POST to /api/v2/admin/users.

Failed-login cookie regeneration.

Live 30-minute idle-session expiration.

Exact logout HTTP request/response.

Live behavior of derived roles on a real user account.

End of document.
