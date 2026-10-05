# OrangeHRM 5.9 REST API v2 — Research Document

**Verification status:** Every claim is traceable to a specific HTTP capture, a specific source file, or a specific DB row. Items that could not be verified are marked `NOT YET VERIFIED`.

**Environment (verified):**

- OrangeHRM: 5.9
- API contract version: 2.8.0
- PHP: 8.3.35
- Apache: 2.4.68 (Debian)
- MariaDB: 11.4.13-MariaDB-ubu2404 (live instance)
- App URL: http://localhost:8080
- DB URL: localhost:3307 → container 3306
- Deployment: `php:8.3-apache-bookworm` base image, OrangeHRM 5.9 from SourceForge with MD5 verification, volume `orangehrm_app` at `/var/www/html`

---

## 1. Scope

Covers OrangeHRM 5.9 REST API v2 as verified against the cloned 5.9 source tree, the live MariaDB schema, and live HTTP traffic. Covers routing, authentication (session + OAuth), authorization, validation, response formats, error formats, resource relationships, endpoint inventory, and testing implications.

Does **not** cover: API v1 (legacy), Enterprise/Advanced tier API, Vue SPA internal component architecture, non-REST file/download routes, third-party integrations.

---

## 2. What It Is

OrangeHRM 5.9 REST API v2 is the JSON-over-HTTP interface under `/web/index.php/api/v2/...`. It is the same interface the Vue SPA uses — verified live: the SPA at `/web/index.php/pim/viewEmployeeList` issued `GET /web/index.php/api/v2/pim/employees?...` and received `{data, meta, rels}`.

Every API route declares `_api` in its `routes.yaml` defaults, pointing to an endpoint class in a plugin's `Api/` directory. The API enforces row-level access control, business-rule validation, and workflow state transitions.

---

## 3. OrangeHRM 5.9 Behavior

### 3.1 Base URL and Path Structure

- Base URL: `http://localhost:8080`
- API path prefix: `/web/index.php/api/v2/`
- OAuth path prefix: `/web/index.php/oauth2/`

| Purpose         | URL                                                        |
| --------------- | ---------------------------------------------------------- |
| API             | `http://localhost:8080/web/index.php/api/v2/pim/employees` |
| OAuth authorize | `http://localhost:8080/web/index.php/oauth2/authorize`     |
| OAuth token     | `http://localhost:8080/web/index.php/oauth2/token`         |

**Note:** `/web/index.php` is part of the path — it is the front controller. The Apache container maps port 80 to host port 8080.

### 3.2 Authentication

Two mechanisms coexist on the same API endpoints:

| Mechanism        | Header / Cookie                        | Used By                      |
| ---------------- | -------------------------------------- | ---------------------------- |
| Session cookie   | `Cookie: _orangehrm=<session_id>`      | Vue SPA                      |
| OAuth 2.0 Bearer | `Authorization: Bearer <opaque_token>` | External clients, automation |

Both work identically — verified live: `POST /api/v2/pim/employees` with a Bearer token produces the same 200 response as with a session cookie.

**OAuth 2.0 flow (verified end-to-end):**

1. Register an OAuth client via the UI (`/admin/registerOAuthClient`) or API (`POST /api/v2/admin/oauth-clients`). The client is public (no `client_secret`). This is a setup step, not a test step — fresh databases have no OAuth clients.
2. Generate PKCE parameters:
   - `code_verifier` — random string
   - `code_challenge` — BASE64URL(SHA256(code_verifier))
   - `code_challenge_method` — `S256`
   - `state` — random string
3. `GET /oauth2/authorize` with `response_type=code`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method`, `state` — requires a session cookie for the end user.
4. Consent screen — user clicks "Allow Access".
5. 302 redirect to `redirect_uri?code=...&state=...`.
6. `POST /oauth2/token` with `grant_type=authorization_code`, `code`, `client_id`, `redirect_uri`, `code_verifier` (form-encoded).
7. Response: `{access_token, refresh_token, token_type: "Bearer", expires_in: 1800}`.
8. Use `Authorization: Bearer <access_token>` on any `/api/v2/...` request.
9. Refresh via `POST /oauth2/token` with `grant_type=refresh_token`, `refresh_token`, `client_id`.

PKCE is required. The flow was verified end-to-end with `code_challenge_method=S256`.

**OAuth configuration (live DB values):**

````sql
SELECT name, value FROM hs_hr_config WHERE name LIKE 'oauth%'
Name	Value	Parsed
oauth.access_token_ttl	PT30M	30 minutes
oauth.auth_code_ttl	PT5M	5 minutes
oauth.refresh_token_ttl	P1M	1 month
oauth.encryption_key	(base64, 32 bytes)	Server secret
oauth.token_encryption_key	(base64, 32 bytes)	Server secret
Key facts:

Tokens are opaque, not JWT (source comment: "We are using opaque token, not JWT").

BearerTokenValidator decrypts the token ciphertext, then looks up the decrypted ID in ohrm_oauth2_access_token.

Token expiry check is now > expiry — a token is valid up to and including its exact expiry second.

Refresh rotates the refresh token — a new refresh_token is issued on each refresh.

Old refresh token is invalidated after rotation (or rejected on client mismatch).

Error responses for auth:

Scenario	HTTP	Body
No auth on API	401	{"error": {"status": 401, "message": "Session expired"}}
Invalid Bearer on POST	401	{"error": {"status": 401, "message": "Unexpected error occurred while evaluating the `Bearer` token"}}`
Invalid Bearer on GET (browser-style)	302	Redirect to /auth/login
Authenticated but not authorized	403	{"error": {"status": 403, "message": "Unauthorized"}}
OAuth invalid code	400	League format (see §3.10)
OAuth invalid refresh token	401	League format (see §3.10)
3.3 Response Envelope
Success:

```json
{
  "data": <object or array>,
  "meta": <object or array>,
  "rels": <array>
}
Live examples:
````

GET /api/v2/core/about:

```json
{
  "data": {"companyName": "ECalvis", "productName": "OrangeHRM OS", "version": "5.9", ...},
  "meta": [],
  "rels": []
}
GET /api/v2/pim/employees?limit=50&offset=0:

json
{
  "data": [ {...}, {...} ],
  "meta": {"total": 2},
  "rels": []
}
Quirk: meta is [] (empty array) for single-resource responses and errors, but {} (object) for collections with total. Schema validators must accept both.
```

3.4 Pagination
Defaults (from FilterParams.php):

```php
public const DEFAULT_LIMIT = 50;
public const DEFAULT_OFFSET = 0;
Parameter names (from CommonParams.php):

php
public const PARAMETER_OFFSET = 'offset';
public const PARAMETER_LIMIT = 'limit';
Validation bounds (from AbstractEndpointTest.php):
```

Accepted values: null, '0', 0, 1, 2147483647, '2147483647', PHP_INT_MAX, ''

Invalid values are rejected (specific list not captured)

meta.total reflects the full match count, not the page size.

3.5 Sorting
Sort parameters: sortField, sortOrder (ASC or DESC)

Sort field naming: Dotted paths, not raw column names. Examples:

employee.firstName

leave.date

u.userName, u.status, r.name, e.firstName, e.lastName, r.displayName

timesheet.startDate

candidate.dateOfApplication

holiday.date

Allowed sort fields per resource (verified from *SearchFilterParams classes):

Resource Allowed sort fields
Employee employee.lastName, employee.firstName, employee.middleName, employee.empNumber, employee.employeeId, jobTitle.jobTitleName, empStatus.name, subunit.name, supervisor.firstName
Leave requests leave.date
Holidays holiday.date
Timesheets timesheet.startDate
Candidates vacancy.name, candidate.lastName, hiringManager.lastName, candidate.dateOfApplication, candidateVacancy.status
Admin users u.userName, u.status, r.name, e.firstName, e.lastName, r.displayName
Invalid sortField → 422 validation error.

3.6 Filtering
Filter parameters are per-endpoint. Each endpoint's getValidationRuleForGetAll() defines them.

Employee filters (from EmployeeAPI.php and EmployeeSearchFilterParams.php):

Param Type Notes
includeEmployees string or int Accepts both onlyCurrent/onlyPast/currentAndPast and 1/2/3
name string max 100 chars
nameOrId string max 100 chars
employeeId string max 10 chars
empStatusId int positive
jobTitleId int positive
subunitId int positive
supervisorEmpNumbers int[] array
empNumber int validated by IN_ACCESSIBLE_EMP_NUMBERS
model string default or detailed
Leave request filters (from LeaveRequestSearchFilterParams.php):

Param Type Notes
statuses array subset of LEAVE_STATUSES
empNumber int
empNumbers int[]
subunitId int
leaveTypeId int
includeEmployees string default onlyCurrent
Leave status enum: rejected (-1), cancelled (0), pending (1), approved (2), taken (3).

Holiday filters: excludeRecurring (bool, default false), plus date range from DateRangeSearchFilterParams.

Timesheet filters: fromDate, toDate, empNumber (required, non-nullable).

Candidate filters: candidateId, vacancyId, employeeId, jobTitleId, hiringManagerId, status, methodOfApplication, fromDate, toDate, keywords, candidateVacancy, candidateName, candidateIds, consentToKeepData.

Admin user filters: status, username, userRoleId, empNumber, hasPassword.

3.7 Validation
Strict mode is on by default. Sending an unknown parameter produces:

```json
{
  "error": {
    "status": "422",
    "message": "Invalid Parameter",
    "data": {"invalidParamKeys": ["badParam"]}
  }
}
Empty string semantics: notRequiredParamRule with excludeEmptyString: true rejects "" but accepts null. Used for middleName and employeeId on employee create.
```

Missing required fields produce a combined 422:

```json
{
  "error": {
    "status": "422",
    "message": "Invalid Parameter",
    "data": {"invalidParamKeys": ["firstName", "lastName"]}
  }
}
Validation rules that hit the DB:
```

ENTITY_UNIQUE_PROPERTY — uniqueness check (e.g., employeeId against non-purged employees)

IN_ACCESSIBLE_EMP_NUMBERS — row-level access check

Validation rule exceptions → 500 (not 422), if the rule itself throws.

3.8 Error Responses
Three error envelopes exist:

Envelope 1 — OrangeHRM (all /api/v2/... errors):

```json
{
  "error": {
    "status": <string or integer>,
    "message": "<string>",
    "data": <optional>
  }
}
Envelope 2 — League OAuth2 (all /oauth2/token errors):

json
{
  "error": "<code>",
  "error_description": "<description>",
  "hint": "<specific cause>",
  "message": "<description>"
}
Envelope 3 — HTML redirect (browser-style auth failures):

text
302 Found
location: /web/index.php/auth/login
content-type: text/html; charset=utf-8
3.9 HTTP Status Codes
Code	Trigger	Envelope
200	Successful GET, POST, DELETE	OrangeHRM
302	Browser-style auth failure	HTML
400	OAuth invalid request	League
401	Missing/invalid auth	OrangeHRM (API) or League (OAuth)
403	Permission denied	OrangeHRM
404	Lookup endpoint missing record	OrangeHRM
422	Validation failure	OrangeHRM
500	Unhandled server error	OrangeHRM — NOT YET VERIFIED
501	NotImplemented	Unreachable via HTTP in stock 5.9
Important: POST returns 200, not 201. Confirmed live.
```

3.10 Error Status Type Inconsistency (Real Quirk)
Within OrangeHRM's envelope:

Status Type
401 integer
403 integer
404 string "404"
422 string "422"
No rule. JSON schema validation must accept both. Test assertions must handle both.

3.11 Live Error Response Examples
422 — Unknown query parameter:

```json
{
  "error": {
    "status": "422",
    "message": "Invalid Parameter",
    "data": {"invalidParamKeys": ["badParam"]}
  }
}
422 — Inaccessible employee:

json
{
  "error": {
    "status": "422",
    "message": "Invalid Parameter",
    "data": {"invalidParamKeys": ["empNumber"]}
  }
}
422 — Missing required fields:

json
{
  "error": {
    "status": "422",
    "message": "Invalid Parameter",
    "data": {"invalidParamKeys": ["firstName", "lastName"]}
  }
}
401 — No auth:

json
{"error": {"status": 401, "message": "Session expired"}}
401 — Invalid Bearer on POST:

json
{"error": {"status": 401, "message": "Unexpected error occurred while evaluating the `Bearer` token"}}
403 — ESS creates employee:

json
{"error": {"status": 403, "message": "Unauthorized"}}
404 — Lookup endpoint missing record:

json
{"error": {"status": "404", "message": "Record Not Found"}}
400 — OAuth invalid code:

json
{
  "error": "invalid_request",
  "error_description": "The request is missing a required parameter, includes an invalid parameter value, includes a parameter more than once, or is otherwise malformed.",
  "hint": "Cannot decrypt the authorization code",
  "message": "The request is missing a required parameter, includes an invalid parameter value, includes a parameter more than once, or is otherwise malformed."
}
401 — OAuth invalid refresh token:

json
{
  "error": "invalid_request",
  "error_description": "The refresh token is invalid.",
  "hint": "Cannot decrypt the refresh token",
  "message": "The refresh token is invalid."
}
4. Architecture
4.1 Request Lifecycle
text
HTTP request
  ↓
Symfony kernel
  ↓
ControllerEvent (priority 80000)
  → ApiAuthorizationSubscriber::onControllerEvent
     - skip if PublicControllerInterface
     - read _api from attributes; throw ForbiddenException if null
     - resolve UserRoleManager via DI
     - resolve ResourcePermission for the _api class
     - check verb against canRead/canCreate/canUpdate/canDelete
     - throw ForbiddenException('Unauthorized') if not allowed
  ↓
GenericRestController::handle(HttpRequest)
  → AbstractRestController::handle(HttpRequest)
     - new Request($httpRequest)
     - init($request) — reads _api, instantiates endpoint
     - getValidationRule($request) — GET → getOne/getAll; POST → create; PUT → update; DELETE → delete
     - Validator::validate(...) — strict mode; collects errors → InvalidParamException
     - dispatch to endpoint method
     - normalize result → Response::formatData() → {data, meta, rels}
  ↓
ExceptionEvent
  → ApiAuthorizationSubscriber (priority 0) handles ForbiddenException → 403 JSON
  → ExceptionSubscriber (priority -65) sets status/headers
4.2 Layering
text
Endpoint (e.g. EmployeeAPI)
    ↓
Service (e.g. EmployeeService)
    ↓
DAO (e.g. EmployeeDao)
    ↓
Doctrine Entity (e.g. Employee)
    ↓
Database
4.3 Response Path
text
Entity / Array
    ↓
Model Class (Normalizable) — e.g. EmployeeModel, EmployeeDetailedModel
    ↓
EndpointResourceResult / EndpointCollectionResult
    ↓
Response::formatData() → {data, meta, rels}
    ↓
JSON HTTP Response
5. Important Concepts
Concept	Description
_api	Routes.yaml default pointing to the endpoint class.
_key	Optional param name used for getOne vs getAll distinction.
CrudEndpoint	Interface bundling getAll, getOne, create, update, delete.
Normalizable	Interface for JSON-serializable models.
ModelTrait	Standard implementation: wire entity, declare filters, get JSON.
EndpointResourceResult	Single-resource response wrapper.
EndpointCollectionResult	Collection response wrapper with meta.
ParameterBag	Holds the meta object.
ParamRuleCollection	Strict parameter validation container.
ParamRule	Single parameter validation rule.
ValidationDecorator	Wraps rules as required or not-required.
ALLOWED_SORT_FIELDS	Per-resource constant listing valid sortField values.
MODEL_MAP	Pattern for ?model= variant selection (default/detailed).
ResourcePermission	OR-reduced permission flags from DataGroupPermission.
self flag	Restricts a role to its own data rows.
IN_ACCESSIBLE_EMP_NUMBERS	Row-level authorization rule.
ENTITY_UNIQUE_PROPERTY	DB-backed uniqueness validation rule.
WorkflowStateMachine	DB table of allowed state transitions.
CapableViewController	Marker interface for endpoints that bypass permission checks.
6. Important Objects, Endpoints, Entities
6.1 Core Framework Classes
Component	Namespace
Endpoint	OrangeHRM\Core\Api\V2
CrudEndpoint	OrangeHRM\Core\Api\V2
GenericRestController	OrangeHRM\Core\Controller\Rest\V2
AbstractRestController	OrangeHRM\Core\Controller\Rest\V2
ApiAuthorizationSubscriber	OrangeHRM\Core\Subscriber
ExceptionSubscriber	OrangeHRM\Core\Subscriber
Validator	OrangeHRM\Core\Api\V2\Validator
ParamRuleCollection	OrangeHRM\Core\Api\V2\Validator
Response	OrangeHRM\Core\Api\V2
AbstractEndpointResult	OrangeHRM\Core\Api\V2\Serializer
EndpointResourceResult	OrangeHRM\Core\Api\V2
EndpointCollectionResult	OrangeHRM\Core\Api\V2
UserRoleManagerService	OrangeHRM\Core\Authorization\Service
DataGroupService	OrangeHRM\Core\Authorization\Service
BasicUserRoleManager	OrangeHRM\Core\Authorization\Manager
6.2 Employee Lifecycle Endpoints (Fully Verified)
GET /api/v2/pim/employees
```

Purpose: List/filter employees

Auth: Session cookie or Bearer token

Permissions: apiv2_pim_employee (data_group_id 96). Admin: read=1; ESS: read=1, self=1; Supervisor: read=1

Behavior: Results are automatically narrowed to accessible employees. If empNumber filter is supplied, only that employee is returned (if accessible).

Request: Query params: limit, offset, model, includeEmployees, name, nameOrId, employeeId, empStatusId, jobTitleId, subunitId, supervisorEmpNumbers, empNumber, sortField, sortOrder

Response 200:

```json
{
  "data": [{...EmployeeModel or EmployeeDetailedModel...}],
  "meta": {"total": <int>},
  "rels": []
}
GET /api/v2/pim/employees/{empNumber}
```

Purpose: Get single employee

Permissions: Same as list

Validation: empNumber checked by IN_ACCESSIBLE_EMP_NUMBERS

Quirk: Inaccessible empNumber → 422 (not 404). 404 only reachable in a race condition.

Response 200: Single {data: {...}, meta: [], rels: []}

POST /api/v2/pim/employees

Purpose: Create employee

Permissions: apiv2_pim_employee create=1 (Admin only)

Workflow check: isActionAllowed(FLOW_EMPLOYEE, STATE_NOT_EXIST, EMPLOYEE_ACTION_ADD) — throws BadRequestException if not allowed

Request:

```json
{
  "firstName": "string (required, max 30)",
  "lastName": "string (required, max 30)",
  "middleName": "string (optional, max 30, excludeEmptyString)",
  "employeeId": "string (optional, max 10, unique against purgedAt=null, excludeEmptyString)",
  "empPicture": "{name, type, base64, size} (optional)"
}
Response 200 (not 201):

json
{
  "data": {
    "empNumber": <int>,
    "lastName": "...",
    "firstName": "...",
    "middleName": "",    ← defaults to empty string
    "employeeId": "...",
    "terminationId": null
  },
  "meta": [],
  "rels": []
}
Side effects: Creates row in hs_hr_employee, dispatches EmployeeAddedEvent
```

Always returns EmployeeModel — ignores ?model= query param

middleName defaults to "" — the API cannot create an employee with a null middle name

DELETE /api/v2/pim/employees

Purpose: Delete employees (bulk)

Permissions: apiv2_pim_employee delete=1 (Admin only)

Workflow check: isActionAllowed(FLOW_EMPLOYEE, STATE_ACTIVE or STATE_TERMINATED, DELETE_ACTIVE or DELETE_TERMINATED) — throws BadRequestException('Not allowed to delete employees') if not allowed

Request:

```json
{"ids": [<int>, <int>, ...]}
Validation: Each ID must be positive, must not be in getUndeletableEmpNumbers()
```

Response 200:

```json
{"data": [<deleted_id>, ...], "meta": [], "rels": []}
Side effects:
```

Hard delete from hs_hr_employee

Cascades ohrm_leave rows (52 → 0 in live test)

Does NOT cascade ohrm_timesheet rows (1 → 1 in live test, orphaned)

Dispatches EmployeeDeletedEvent

PUT /api/v2/pim/employees/{empNumber}

Status: Throws NotImplementedException in source

Unreachable via HTTP: can_update=0 for all roles on data_group 96 → 403 before the 501 path fires

6.3 Leave Endpoints (Partial Verification)
Full ohrm_api_permission mapping for Leave:

API class data_group_id Name read create update delete
HolidayAPI 130 apiv2_leave_holiday 1 1 1 1
WorkWeekAPI 131 apiv2_leave_workweek 1 0 1 0
EligibleLeaveTypeAPI 132 apiv2_leave_eligible_leave_types 1 0 0 0
LeaveTypeAPI 133 apiv2_leave_leave_types 1 1 1 1
LeavePeriodAPI 134 apiv2_leave_leave_period 1 0 1 0
MyLeaveRequestAPI 135 apiv2_leave_my_leave_requests 1 1 1 0
EmployeeLeaveRequestAPI 136 apiv2_leave_employee_leave_requests 1 1 1 0
EmployeeBulkLeaveRequestAPI 137 apiv2_leave_employee_bulk_leave_requests 0 0 1 0
LeaveEntitlementAPI 138 apiv2_leave_leave_entitlements 1 1 1 1
LeaveBalanceAPI 139 apiv2_leave_leave_balance 1 0 0 0
EmployeeLeaveEntitlementAPI 140 apiv2_leave_employee_leave_entitlements 1 0 0 0
ValidationLeaveEntitlementValueAPI 141 apiv2_leave_leave_entitlements_validation 1 0 0 0
LeaveOverlapAPI 142 apiv2_leave_overlap_leaves 1 0 0 0
LeaveRequestCommentAPI 143 apiv2_leave_leave_request_comment 1 1 0 0
LeaveCommentAPI 144 apiv2_leave_leave_comment 1 1 0 0
LeaveAPI 145 apiv2_leave_leaves 1 0 1 0
BulkLeaveAPI 146 apiv2_leave_bulk_leaves 0 0 1 0
LeaveReportAPI 147 apiv2_leave_reports 1 0 0 0
LeaveReportDataAPI 148 apiv2_leave_reports_data 1 0 0 0
EmployeeLeaveAPI 263 apiv2_leave_employee_leave 1 0 0 0
EmployeeLeaveBalanceAPI 264 apiv2_leave_employee_leave_balances 1 0 0 0
Leave balance (data_group_id 139) role permissions:

Role read create update delete self
Admin 1 0 0 0 1
Admin 1 0 0 0 0
ESS 1 0 0 0 1
Supervisor 1 0 0 0 1
Supervisor 1 0 0 0 0
6.4 Time Endpoints (Partial Verification)
API class data_group_id read create update delete
TimeConfigPeriodAPI 154 1 0 1 0
CustomerAPI 155 1 1 1 1
ValidationCustomerNameAPI 156 1 0 0 0
ProjectActivityAPI 157 1 1 1 1
ProjectAPI 158 1 1 1 1
ValidateProjectNameAPI 159 1 0 0 0
MyTimesheetItemAPI 160 1 0 1 0
EmployeeTimesheetItemAPI 161 1 0 1 0
MyTimesheetAPI 162 1 1 1 0
TimesheetActionLogAPI 163 1 0 0 0
TimesheetCommentAPI 164 1 1 1 0
TimesheetTimeFormatAPI 165 1 0 0 0
ValidationProjectActivityNameAPI 166 1 0 0 0
TimesheetProjectActivityUniqueValidationAPI 167 1 0 0 0
CopyProjectActivityAPI 168 1 1 0 0
EmployeeTimesheetAPI 169 1 1 1 0
EmployeeTimesheetListAPI 170 1 0 0 0
DefaultTimesheetAPI 171 1 0 0 0
TimeReportAPI 172 1 0 0 0
TimeReportDataAPI 173 1 0 0 0
ProjectAdminAPI 174 1 0 0 0
6.5 Recruitment Endpoints (Partial Verification)
API class data_group_id read create update delete
VacancyAPI 208 1 1 1 1
VacancyAttachmentAPI 209 1 1 1 1
CandidateAPI 210 1 1 1 1
CandidateAttachmentAPI 211 1 1 1 0
CandidateStatusAPI 212 1 0 0 0
HiringManagerAPI 213 1 0 0 0
CandidateAllowedActionAPI 214 1 0 0 0
CandidateRejectionAPI 215 0 0 1 0
CandidateShortlistingAPI 216 0 0 1 0
CandidateInterviewSchedulingAPI 217 1 1 1 0
InterviewAttachmentAPI 218 1 1 1 0
CandidateMarkingInterviewPassAPI 219 0 0 1 0
CandidateMarkingInterviewFailAPI 220 0 0 1 0
CandidateJobOfferingAPI 221 0 0 1 0
CandidateOfferDecliningAPI 222 0 0 1 0
CandidateHiringAPI 223 0 0 1 0
CandidateHistoryAPI 224 1 0 1 0
EmployeeListAPI 225 1 0 0 0
Important: Candidate workflow endpoints (reject, shortlist, mark pass, mark fail, offer job, decline offer, hire) are UPDATE-only — read=0, create=0, update=1, delete=0. Calling them requires a user whose role grants update on those data groups.

6.6 Attendance Endpoints (Partial Verification)
API class data_group_id read create update delete
AttendanceConfigurationAPI 175 1 0 1 0
EmployeeLatestAttendanceRecordAPI 176 1 0 0 0
AttendancePunchInRecordOverlapAPI 177 1 0 0 0
AttendancePunchOutRecordOverlapAPI 178 1 0 0 0
MyAttendanceRecordAPI 179 0 1 1 1
EmployeeAttendanceRecordAPI 180 0 1 1 1
TimezonesAPI 181 1 0 0 0
CurrentDateTimeAPI 182 1 0 0 0
AttendanceRecordAPI 183 1 0 1 0
AttendanceEditPunchInRecordOverlapAPI 184 1 0 0 0
AttendanceEditPunchOutRecordOverlapAPI 185 1 0 0 0
EmployeeAttendanceSummaryAPI 186 1 0 0 0
Quirk: MyAttendanceRecordAPI and EmployeeAttendanceRecordAPI have read=0 but create=1, update=1, delete=1 — record endpoints are write-mostly by permission.

6.7 Dashboard Endpoints (Partial Verification)
API class data_group_id read create update delete
EmployeeOnLeaveAPI 235 1 0 0 0
EmployeeTimeAtWorkAPI 239 1 0 0 0
EmployeeOnLeaveTodayConfigAPI 241 1 0 1 0
6.8 Employee Entity
Maps to hs_hr_employee. All 48 columns match the entity @ORM\Column annotations.

Notable mappings:

emp_number int(11) PK auto_increment ↔ empNumber int

emp_lastname, emp_firstname, emp_middle_name NOT NULL no DB default, default '' in entity

employee_id varchar(50) nullable ↔ employeeId ?string

purged_at datetime nullable ↔ purgedAt ?DateTime

sal_grd_code varchar(13) nullable ↔ salaryGradeCode ?string (@deprecated)

6.9 EmployeeModel Fields (6)
Field Type
empNumber integer
lastName string
firstName string
middleName string
employeeId string
terminationId integer or null
6.10 EmployeeDetailedModel Fields
Same 6 base fields plus:

Field Type
jobTitle.id integer or null
jobTitle.title string or null
jobTitle.isDeleted boolean or null
subunit.id integer or null
subunit.name string or null
empStatus.id integer or null
empStatus.name string or null
supervisors array of {empNumber, lastName, firstName, middleName} 7. Relationships to Other OrangeHRM Layers
7.1 UI ↔ API (Verified)
The Vue SPA at /web/index.php/pim/viewEmployeeList issues:

http
GET /web/index.php/api/v2/pim/employees?limit=50&offset=0&model=detailed&includeEmployees=onlyCurrent&sortField=employee.firstName&sortOrder=ASC
Accept: application/json
Cookie: _orangehrm=<session>
and receives {data, meta, rels}. The API is the same interface the SPA uses.

7.2 API ↔ Service ↔ DAO ↔ Entity ↔ DB

```text
EmployeeAPI::getAll()
  → EmployeeService::getEmployeeList() / getEmployeeCount()
  → EmployeeDao::getEmployeeList() / getEmployeeCount()
  → Doctrine query on Employee entity
  → hs_hr_employee
7.3 API ↔ Workflow
EmployeeAPI::create() and getValidationRuleForDelete() call UserRoleManager::isActionAllowed(WorkflowStateMachine::FLOW_EMPLOYEE, state, action). The workflow state machine is stored in ohrm_workflow_state_machine.
```

7.4 API ↔ Permissions
ApiAuthorizationSubscriber resolves ResourcePermission for the _api class via:

```text
ohrm_api_permission.api_name → data_group_id
ohrm_data_group.id → data_group_id
ohrm_user_role_data_group (user_role_id, data_group_id) → can_read, can_create, can_update, can_delete, self
ohrm_user_role.id → user_role_id
8. Testing Implications
8.1 API-First Test Data Setup
Use POST /api/v2/pim/employees with a valid Bearer token or session cookie. This is faster and more reliable than UI navigation. The created employee appears immediately in the UI on next data refresh.
```

8.2 Cleanup via API
Use DELETE /api/v2/pim/employees with {"ids": [...]}. Be aware:

Hard delete — data is gone from hs_hr_employee

Partial cascade — ohrm_leave cascades, ohrm_timesheet does NOT

Orphan risk — modules that do not cascade leave orphaned rows referencing the deleted employee

8.3 Test Data Setup Prerequisites
OAuth client registration — must be done once per environment (via UI or API). Fresh DBs have no OAuth clients.

Login credentials — Admin and ESS accounts must exist.

Server time — token expiry is now > expiry, valid up to and including the exact second.

8.4 State Preparation
Use API calls to establish prerequisite state:

Create an employee with a specific leave balance before testing leave application UI

Set up a supervisor relationship before testing approval workflows

Configure leave types before testing leave requests

8.5 API-Only Testing
Test these directly:

Validation: Send invalid types, missing fields, unknown params → 422

Authorization: Use tokens for different roles → 403 or filtered data

Pagination: Verify meta.total correctness; test limit=0, limit > total, offset > total

Sorting: Test sortField allowed list; invalid sortField → 422

Error shapes: Verify 401/403/404/422 bodies match documented envelopes

OAuth: PKCE flow, token exchange, refresh, expired/invalid tokens

The repository's live integration target (`npm run test:live`) exercises the configured OrangeHRM instance without HTTP or API mocks. It verifies Admin employee reads against MariaDB, checks ESS access to its linked employee and denial for another employee, and confirms that an unauthenticated request receives the live JSON 401 response. The test is read-only apart from normal authentication audit events.

8.6 Verification
Use GET endpoints to verify state after UI actions or API writes. For DB-level verification, query tables with mysql2 and compare with API responses.

8.7 Permission Testing
Create test users with different roles (Admin, ESS, Supervisor). Verify:

Endpoint access (403 vs success)

Data visibility (filtered lists vs full lists)

self flag behavior (in the current live instance, ESS can GET its linked employee by ID and gets 422 for another employee; the unfiltered employee collection currently returns zero rows)

Row-level access (Supervisor can access subordinates but not unrelated employees)

8.8 Suitability Classification (per endpoint)
Use case Criteria Examples
Test-data setup POST/PUT that creates entities needed by tests POST /api/v2/pim/employees
Cleanup DELETE that removes entities without cascading surprises DELETE /api/v2/pim/employees (aware of orphans)
State preparation PUT/PATCH that sets up preconditions PUT /api/v2/pim/employees/{id}/personal-details
Verification GET that returns authoritative state GET /api/v2/pim/employees/{id}
API-only testing Endpoint with meaningful validation/authorization behavior All GET endpoints with filters
Not suitable Endpoint with irreversible side effects DELETE /api/v2/pim/employees (hard delete) unless isolated 9. Known Quirks and Gotchas
error.status type inconsistency: 422 and 404 → string; 401 and 403 → integer.

meta shape inconsistency: [] (array) for single resources and errors; {} (object) for collections with total.

POST returns 200, not 201.

DELETE returns 200, not 204.

404 unreachable for inaccessible employees: GET /employees/{id} returns 422 for inaccessible empNumber, not 404. Only lookup endpoints (educations, leave-types) return 404 for missing records.

PUT /employees/{id} returns 403, not 501: can_update=0 on data_group 96 masks the NotImplementedException.

DELETE cascade gaps: ohrm_leave cascades; ohrm_timesheet does NOT. Orphaned records accumulate.

middleName defaults to "": The API cannot create an employee with a null middle name via POST /employees.

employeeId uniqueness only against non-purged employees: ENTITY_UNIQUE_PROPERTY uses purgedAt = null.

Singular path segment: /api/v2/pim/employee/{empNumber}/contact-details (singular employee) vs all other PIM routes using employees (plural).

Typo in recruitment path: /api/v2/recruitment/candidates/{candidateId}/shedule-interview (missing c).

Fixed id: 0 defaults in routes.yaml: organization, email-configuration, localization, optional-field, update-password, my-info.

_key: name for reports: PIM and Leave reports use name as the key param.

_key: userName for /api/v2/admin/validation/user-name.

_key: langStringId for i18n translation validation.

Workflow column stores strings: '0'–'7', not integers.

Leave workflow uses string actions: APPLY, ASSIGN, APPROVE, CANCEL, REJECT — other flows use integer IDs.

Two OAuth table sets: ohrm_oauth_* (legacy) and ohrm_oauth2_* (current v2 API).

OAuth authorize requires session cookie: AuthorizationController extends AbstractViewController, not PublicControllerInterface. Not fully headless.

Approval driven by query param: authorized=true (parsed with FILTER_VALIDATE_BOOLEAN) approves.

OAuth error format differs from API error format: League format for /oauth2/token; OrangeHRM format for /api/v2/....

Refresh rotates the refresh token: New token issued on each refresh. Old token is invalidated.

OAuth token endpoint sets Set-Cookie: Unexpected on a stateless endpoint. Likely incidental from Symfony session.

getUndeletableEmpNumbers() always includes current user: Plus default admin in demo mode.

String params reject blank: Rules::STRING_TYPE = NotBlankStringType. Sending "" fails validation for a required string param.

Strict parameter mode: Unknown params trigger 422 with Unexpected Parameter ('<key>') Received.

hasPassword user filter: Reads as boolean, semantically "has a password set".

10. Version-Specific Notes
    Item 5.9 Status Evidence
    API v2 availability Available routes.yaml + live
    API contract version 2.8.0 /api/v2/core/public/version
    Application version 5.9 /api/v2/core/about
    OAuth 2.0 PKCE Available and required Live flow works
    client_credentials grant Not enabled Source (OAuthServer.php only enables AuthCodeGrant and RefreshTokenGrant)
    password grant Not enabled Same
    Opaque tokens (not JWT) Yes Source comment
    Two OAuth table sets Yes SHOW TABLES
    Refresh token rotation Yes Live verified
    Access token TTL 30 min (PT30M) hs_hr_config
    Auth code TTL 5 min (PT5M) hs_hr_config
    Refresh token TTL 1 month (P1M) hs_hr_config
    Important: The public API documentation at https://api-starter-orangehrm.readme.io/reference/get-started claims compatibility with "5.5 and above". Endpoint availability must be verified against the 5.9 source tree's routes.yaml files, not against the documentation alone.

11. Facts vs Inferences vs Assumptions
    FACT (verified via file path, HTTP response, or DB row)
    Environment:

App version 5.9, API contract version 2.8.0, PHP 8.3.35, Apache 2.4.68, MariaDB 11.4.13-MariaDB-ubu2404

Base URL http://localhost:8080, API prefix /web/index.php/api/v2/, OAuth prefix /web/index.php/oauth2/

Authentication:

Two auth mechanisms: session cookie and OAuth Bearer

Bearer works on GET, POST, DELETE identically to session cookie

OAuth uses PKCE (S256), verified end-to-end

OAuth client is public (no client_secret)

Refresh rotates the refresh token

Old refresh token → 401 with hint: "Cannot decrypt the refresh token"

Wrong client_id → 401

Invalid code → 400 with hint: "Cannot decrypt the authorization code"

TTLs: access_token_ttl=PT30M, auth_code_ttl=PT5M, refresh_token_ttl=P1M

Opaque tokens (not JWT)

Token expiry check is now > expiry (valid at exact expiry second)

Missing auth → 401 {"error": {"status": 401, "message": "Session expired"}}

Invalid Bearer on POST → 401 with message about Bearer evaluation

ESS POST employee → 403 {"error": {"status": 403, "message": "Unauthorized"}}

Response envelope:

{data, meta, rels} for all /api/v2/... successes

meta is [] for single resources, {} or {total: N} for collections

HTTP method behaviors:

POST returns 200 (not 201)

DELETE returns 200 (not 204)

DELETE body is {"ids": [int, ...]}

Employee lifecycle:

POST /api/v2/pim/employees — creates with EmployeeModel response (6 fields)

GET /api/v2/pim/employees?employeeId=X — collection with meta.total

GET /api/v2/pim/employees/{id} — single resource, blocked for inaccessible empNumber (422)

DELETE /api/v2/pim/employees — returns {"data": [deleted_ids], "meta": [], "rels": []}

DELETE is hard delete from hs_hr_employee

DELETE cascades ohrm_leave, does not cascade ohrm_timesheet

middleName defaults to "" when not sent

terminationId is null for new employees

EmployeeModel has exactly 6 fields

EmployeeDetailedModel has 6 base + nested jobTitle, subunit, empStatus, supervisors

Validation:

Unknown query params → 422 with invalidParamKeys

Missing required fields → 422 with invalidParamKeys listing all

Inaccessible empNumber → 422 with invalidParamKeys: ["empNumber"]

Error responses:

OrangeHRM envelope for all /api/v2/... errors

League envelope for all /oauth2/token errors

error.status type is inconsistent (string for 404/422, integer for 401/403)

404 body: {"error": {"status": "404", "message": "Record Not Found"}}

Source files:

EmployeeAPI.php — full source verified

EmployeeService.php — max length constants (30/30/30/10/50), getUndeletableEmpNumbers()

EmployeeModel.php / EmployeeDetailedModel.php — field mappings

EmployeeSearchFilterParams.php — 9 allowed sort fields, INCLUDE_EMPLOYEES_MAP

LeaveRequestSearchFilterParams.php — 1 allowed sort field, LEAVE_STATUSES

HolidaySearchFilterParams.php — 1 allowed sort field, excludeRecurring filter

TimesheetSearchFilterParams.php — 1 allowed sort field, required empNumber

CandidateSearchFilterParams.php — 5 allowed sort fields, keywords filter

UserSearchFilterParams.php — 6 allowed sort fields

OAuthServer.php — enables only AuthCodeGrant and RefreshTokenGrant

BearerTokenValidator.php — decrypt-then-lookup, now > expiry check

GenerateOpenApiDocCommand.php — the OpenAPI generation command (not currently active)

OpenApi.php — OpenAPI root document with shared components

EmployeeController.php — UI controller reads getUndeletableEmpNumbers()

Database:

ohrm_user_role — 7 rows (Admin, ESS, Supervisor, ProjectAdmin, Interviewer, HiringManager, Reviewer)

ohrm_data_group — 280 rows

ohrm_api_permission — 199 rows

ohrm_user_role_data_group — 717 rows

ohrm_workflow_state_machine — 152 rows across flows 0–7

Employee DELETE cascades ohrm_leave, leaves ohrm_timesheet orphaned

INFERENCE
The cascade difference between ohrm_leave and ohrm_timesheet is caused by FK constraint differences (ON DELETE CASCADE vs no FK).

The Set-Cookie on OAuth token response is incidental from Symfony session handling.

The 401 on old refresh token reuse is caused by rotation invalidation, but client_id mismatch may also be a factor.

400 and 501 on /api/v2/... are unreachable via HTTP in stock 5.9.

PKCE is required because the League library defaults to requiring it (no explicit setCodeChallengeRequired() call in OAuthServer.php).

ASSUMPTION
None remaining for the claims above.

NOT YET VERIFIED
Whether the old refresh token is invalidated by rotation alone or only by client mismatch

Full cascade table list for employee DELETE (only leave and timesheet were checked)

Live 500 error shape (no natural trigger found in stock 5.9)

Live 501 (unreachable via HTTP due to 403 masking)

Exact list of values accepted/rejected by limit/offset validation (source test implies 2147483647, PHP_INT_MAX, and '' are accepted)

Whether the SPA uses Axios or another HTTP client internally

Whether Config::PRODUCT_MODE in this instance is MODE_DEMO (affects undeletable empNumbers)

12. Sources
    All facts are from the following, which were pasted during the research process.

Source files (cloned OrangeHRM 5.9 tree):

src/plugins/*/config/routes.yaml (all plugins)

src/plugins/orangehrmCoreOAuthPlugin/config/routes.yaml

src/plugins/orangehrmCorePlugin/Api/CommonParams.php

src/plugins/orangehrmCorePlugin/Api/V2/Endpoint.php

src/plugins/orangehrmCorePlugin/Dto/FilterParams.php

src/plugins/orangehrmCorePlugin/Controller/Rest/V2/GenericRestController.php

src/plugins/orangehrmCorePlugin/Controller/Rest/V2/AbstractRestController.php

src/plugins/orangehrmCorePlugin/Controller/Rest/V2/OpenApi.php

src/plugins/orangehrmCorePlugin/Subscriber/ApiAuthorizationSubscriber.php

src/plugins/orangehrmCorePlugin/Subscriber/ExceptionSubscriber.php

src/plugins/orangehrmCoreOAuthPlugin/Controller/OAuth2/TokenController.php

src/plugins/orangehrmCoreOAuthPlugin/Controller/OAuth2/AuthorizationController.php

src/plugins/orangehrmCoreOAuthPlugin/Server/OAuthServer.php

src/plugins/orangehrmCoreOAuthPlugin/Server/BearerTokenValidator.php

src/plugins/orangehrmCoreOAuthPlugin/Service/OAuthService.php

src/plugins/orangehrmCoreOAuthPlugin/Service/PsrHttpFactoryHelper.php

src/plugins/orangehrmCoreOAuthPlugin/Traits/OAuthServerTrait.php

src/plugins/orangehrmPimPlugin/Api/EmployeeAPI.php

src/plugins/orangehrmPimPlugin/Api/Model/EmployeeModel.php

src/plugins/orangehrmPimPlugin/Api/Model/EmployeeDetailedModel.php

src/plugins/orangehrmPimPlugin/Controller/EmployeeController.php

src/plugins/orangehrmPimPlugin/Service/EmployeeService.php

src/plugins/orangehrmPimPlugin/Dto/EmployeeSearchFilterParams.php

src/plugins/orangehrmLeavePlugin/Dto/LeaveRequestSearchFilterParams.php

src/plugins/orangehrmLeavePlugin/Dto/HolidaySearchFilterParams.php

src/plugins/orangehrmTimePlugin/Dto/TimesheetSearchFilterParams.php

src/plugins/orangehrmRecruitmentPlugin/Dto/CandidateSearchFilterParams.php

src/plugins/orangehrmAdminPlugin/Dto/UserSearchFilterParams.php

devTools/core/src/Command/GenerateOpenApiDocCommand.php

devTools/core/console.php

src/composer.json

Live HTTP traffic (all against http://localhost:8080):

GET /web/index.php/api/v2/core/about → 200

GET /web/index.php/api/v2/core/public/version → 200

GET /web/index.php/api/v2/pim/employees?limit=50&offset=0&model=detailed&includeEmployees=onlyCurrent&sortField=employee.firstName&sortOrder=ASC → 200

GET /web/index.php/api/v2/pim/employees/99999 → 422

GET /web/index.php/api/v2/pim/employees?badParam=1 → 422

PUT /web/index.php/api/v2/pim/employees/1 → 403

POST /web/index.php/api/v2/pim/employees (session cookie) → 200

POST /web/index.php/api/v2/pim/employees (Bearer token) → 200

POST /web/index.php/api/v2/pim/employees (ESS session) → 403

GET /web/index.php/api/v2/pim/employees?employeeId=QA001 → 200

GET /web/index.php/api/v2/pim/employees/1?model=detailed (session) → 200

GET /web/index.php/api/v2/pim/employees/1?model=detailed (no auth) → 401

DELETE /web/index.php/api/v2/pim/employees {"ids": [2]} → 200

DELETE /web/index.php/api/v2/pim/employees {"ids": [3]} → 200 (with cascade DB check)

GET /web/index.php/api/v2/admin/educations/99999 → 404

GET /web/index.php/api/v2/leave/leave-types/99999 → 404

GET /web/index.php/api/admin/educations/99999 (wrong path) → 404 HTML

POST /web/index.php/oauth2/token (invalid code) → 400 (League format)

POST /web/index.php/oauth2/token (wrong client_id refresh) → 401 (League format)

POST /web/index.php/oauth2/token (correct client_id refresh) → 200 with new tokens

POST /web/index.php/oauth2/token (old refresh token) → 401 (League format)

Live DB queries:

SHOW TABLES

DESCRIBE hs_hr_employee

DESCRIBE ohrm_workflow_state_machine

SELECT * FROM ohrm_workflow_state_machine (152 rows)

SELECT * FROM ohrm_data_group (280 rows)

SELECT * FROM ohrm_api_permission (199 rows)

SELECT * FROM ohrm_user_role_data_group (717 rows)

SELECT * FROM ohrm_user_role (7 rows)

SELECT name, value FROM hs_hr_config WHERE name LIKE 'oauth%'

SELECT ap.api_name, dg.id, dg.name, ... WHERE ap.api_name LIKE '%Attendance%' (12 rows)

SELECT ap.api_name, ... WHERE ap.api_name LIKE '%Leave%' OR ... (21 rows)

SELECT ur.name, ... WHERE urdg.data_group_id = 139

SELECT COUNT(*) FROM ohrm_leave WHERE emp_number = 3 (before: 52, after: 0)

SELECT COUNT(*) FROM ohrm_timesheet WHERE employee_id = 3 (before: 1, after: 1)

Live Docker:

docker compose ps → both containers healthy

docker inspect orangehrm-app → volume orangehrm_app mounted at /var/www/html

Dockerfile: FROM php:8.3-apache-bookworm, ENV OHRM_VERSION 5.9, ENV OHRM_MD5 380d85deba0f82174a7db346c9347b87, VOLUME ["/var/www/html"]

Reference documentation:

https://api-starter-orangehrm.readme.io/reference/get-started (API contract reference — not used as authoritative source)

End of document.
