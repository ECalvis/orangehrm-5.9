# OrangeHRM 5.9 — Application Architecture

**Status:** Source-verified and live-verified. Every claim is traceable to a specific source file, DB row, or HTTP response.
**Version:** OrangeHRM 5.9
**SUT:** http://localhost:8080/web/index.php
**DB:** MariaDB 11.4.13-MariaDB-ubu2404 (schema inspected live)
**PHP:** 8.3.35 (Apache/2.4.68 Debian)
**Evidence base:** 36 source files, 7 DB queries, 1 live HTTP trace.

---

## 1. Scope

Describes the runtime architecture of OrangeHRM 5.9 as a System Under Test:

- Architectural style and layers
- Browser/frontend ↔ backend communication
- REST API routing, dispatch, validation, authorization, serialization
- Controller/resource → Service → DAO → Entity → DB relationships
- Where business logic, validation, authorization, and persistence live
- Configuration, authentication, modules
- Observable layers vs implementation details
- Architectural quirks specific to 5.9

It does **not** design a Playwright framework.

---

## 2. What It Is

OrangeHRM 5.9 is a **PHP application with a Vue.js 3 SPA frontend**. The SPA communicates with the backend through versioned REST endpoints under `/api/v2/...`.

The backend is **plugin-modular**. Each HR domain — PIM, Leave, Admin, Claim, Time, Attendance, Recruitment, Performance, Buzz, Dashboard, Maintenance, Corporate Directory, Corporate Branding, LDAP, Workspace Notifications, OpenID, Mobile — is a plugin with its own:

- `config/routes.yaml`
- `Api/` endpoint classes
- `Service/` business logic
- `Dao/` data access
- `entity/` Doctrine ORM models

**Live confirmation of UI→API contract:**

````http
GET http://localhost:8080/web/index.php/api/v2/pim/employees?limit=50&offset=0&model=detailed&includeEmployees=onlyCurrent&sortField=employee.firstName&sortOrder=ASC
Accept: application/json
Cookie: _orangehrm=<session>

→ 200 OK, Content-Type: application/json
→ {"data":[...],"meta":{"total":2},"rels":[]}
This proves: SPA calls /api/v2/...; response envelope is {data, meta, rels}; session-cookie auth is used.

3. OrangeHRM 5.9 Behavior
3.1 API routes use GenericRestController
Every /api/v2/... route in PIM, Leave, Admin, Claim routes.yaml uses:

```yaml
controller: OrangeHRM\Core\Controller\Rest\V2\GenericRestController::handle
and declares _api under defaults.
````

3.2 Screen routes return SPA shell; API routes return JSON
Screen routes (/pim/..., /leave/..., /admin/..., /claim/...) use dedicated controller classes. API routes return JSON. The SPA is loaded by a screen route and then fetches data from API routes.

3.3 File routes are separate
/pim/viewPhoto/..., /pim/viewAttachment/..., /pim/sampleCsvDownload, /admin/viewJobSpecification/..., /admin/viewLanguagePackage/..., /claim/requests/{requestId}/attachId/{attachId} use dedicated Controller\File\* classes. They return binary/image content, not JSON.

3.4 Response envelope is always {data, meta, rels}
Response::formatData():

```php
json_encode([
    'data' => $this->data,
    'meta' => $this->meta,
    'rels' => $this->rels,
]);
Live example:

json
{
  "data": [
    {"empNumber": 1, "lastName": "Caummo", "firstName": "Admin", ...},
    {"empNumber": 2, "lastName": "Bunummu", "firstName": "ESS", ...}
  ],
  "meta": {"total": 2},
  "rels": []
}
meta contains total for collections. rels is [] when empty.
```

3.5 Validation strips framework-internal keys
ParamRuleCollection::DEFAULT_EXCLUDED_PARAM_KEYS:

```php
['_api', '_key', '_controller', '_route', '_route_params', '_i18nEnabled', '_dateFormattingEnabled']
Validator::validate() calls getOnlyNecessaryValues() to remove these before iterating. Symfony-injected routing attributes are therefore not treated as unexpected parameters.
```

3.6 Strict mode is on by default
ParamRuleCollection::$strict = true. Any parameter without a declared rule triggers InvalidParamException('Unexpected Parameter ('<key>') Received').

3.7 Validator uses Respect\Validation\Rules\Key
For each declared parameter, Validator::validate() builds a composite validator and wraps it in Respect\Validation\Rules\Key, then calls ->check([$paramKey => $value ?? $default]). Failures accumulate in $errorBag and throw InvalidParamException($errorBag).

If a caught exception is a ValidationEscapableException, it is rethrown immediately, bypassing the error bag.

3.8 Authorization is data-group driven
ApiAuthorizationSubscriber::onControllerEvent() calls getUserRoleManager()->getApiPermissions($apiClass). Chain:

```text
UserRoleManagerService
  → reads config key authorize_user_role_manager_class
  → instantiates manager, sets current User
BasicUserRoleManager::getApiPermissions($apiClass)
  → DataGroupService::getApiPermissions($apiClass, $userRoles)
     → DataGroupDao::getApiPermissions($apiClass, $roles)
        → Doctrine query on DataGroupPermission / DataGroup / UserRole / ApiPermission
     → reduce DataGroupPermission[] → ResourcePermission (OR of each flag)
Live data confirms the chain:
```

ohrm_api_permission maps OrangeHRM\Pim\Api\EmployeeAPI → data_group_id = 96.

ohrm_data_group id 96: apiv2_pim_employee (API-v2 PIM - Employees), read=1, create=1, update=0, delete=1.

ohrm_user_role_data_group for data_group_id = 96:

Admin (role 1): read=1, create=1, update=0, delete=1, self=0

ESS (role 2): read=1, create=0, update=0, delete=0, self=1

Supervisor (role 3): read=1, create=0, update=0, delete=0, self=0

Supervisor (role 3): read=1, create=0, update=0, delete=0, self=1

So PUT is not allowed for any role on EmployeeAPI — consistent with EmployeeAPI::update() throwing NotImplementedException.

3.9 Role model is 7 predefined roles
id name display_name is_assignable is_predefined
1 Admin Admin 1 1
2 ESS ESS 1 1
3 Supervisor Supervisor 0 1
4 ProjectAdmin ProjectAdmin 0 1
5 Interviewer Interviewer 0 1
6 HiringManager HiringManager 0 1
7 Reviewer Reviewer 0 1
Only Admin and ESS are assignable. The other five are derived roles added by BasicUserRoleManager::computeUserRoles().

3.10 Workflow state machine is a populated DB table
ohrm_workflow_state_machine has 152 rows across flows 0–7. The workflow column stores flow IDs as strings ('0'–'7'). The action column stores integer IDs as strings for most flows, and action names for Leave.

Verified Employee flow (workflow = '3'):

state role action resulting_state
NOT_EXIST ADMIN 1 ACTIVE
ACTIVE ADMIN 2 NOT_EXIST
ACTIVE ADMIN 3 TERMINATED
TERMINATED ADMIN 4 ACTIVE
TERMINATED ADMIN 5 NOT_EXIST
Verified Claim flow (workflow = '7'): 12 rows including INITIATED/ESS USER/1/SUBMITTED, SUBMITTED/ADMIN/2/PAID, APPROVED/ADMIN/3/PAID, etc.

Verified Leave flow (workflow = '4'): uses string actions: APPLY, ASSIGN, APPROVE, CANCEL, REJECT. States: INITIAL, PENDING APPROVAL, SCHEDULED, TAKEN, CANCELLED, REJECTED, LEAVE TYPE DELETED PENDING APPROVAL, etc.

3.11 Employee entity maps to hs_hr_employee (column-by-column verified)
All 48 columns in DESCRIBE hs_hr_employee match the @ORM\Column(name="...") annotations in Employee.php. Notable:

emp_number int(11) PK auto_increment ↔ empNumber int

emp_lastname, emp_firstname, emp_middle_name are NOT NULL

employee_id varchar(50) nullable ↔ employeeId ?string

purged_at datetime nullable ↔ purgedAt ?DateTime

sal_grd_code varchar(13) nullable ↔ salaryGradeCode ?string (marked @deprecated with @todo remove from schema)

3.12 EmpPicture allowed types and extensions are hard-coded
EmpPicture::ALLOWED_IMAGE_TYPES:

```text
image/gif, image/jpeg, image/jpg, image/pjpeg, image/png, image/x-png
EmpPicture::ALLOWED_IMAGE_EXTENSIONS:

text
gif, jpeg, jpg, jfif, png
Base64Attachment::validate() enforces:
```

Input has name, type, base64, size.

type is in $allowedTypes.

Extension from pathinfo($input['name'])['extension'] is in $allowedExtensions (case-insensitive).

If filename length bounds are set, filename length is within bounds.

If $checkSizeStrictly, decoded base64 length equals declared size.

size ≤ $maxFileSize (default from ConfigService::getMaxAttachmentSize()).

3.13 InAccessibleEmpNumbers is a row-level authorization rule
InAccessibleEmpNumbers::validate($input):

Rejects non-numeric or non-positive input.

If $includeLoggedInEmpNumber (default true) and $input == AuthUser::getEmpNumber(), returns true.

If !$includeLoggedInEmpNumber and $input == AuthUser::getEmpNumber(), returns false.

Otherwise checks in_array($input, UserRoleManager::getAccessibleEntityIds(Employee::class)).

EmployeeAPI::getValidationRuleForGetOne() uses this rule on empNumber, so unauthorized access is rejected at the validation stage, before getOne() runs.

3.14 EntityUniqueProperty is a DB-backed uniqueness rule
EntityUniqueProperty::validate($input):

Optionally trims input.

Builds a Doctrine query on $entityName filtered by entity.$property = :input.

If $option->hasMatchValues(), adds equality/null filters.

If option->hasIgnoreValues(), adds inequality filters.

Returns true if the result set is empty, false otherwise.

EmployeeAPI::getValidationRuleForCreate() uses:

```php
$uniqueOption->setMatchValues(['purgedAt' => null]);
new Rule(Rules::ENTITY_UNIQUE_PROPERTY, [Employee::class, 'employeeId', $uniqueOption])
So employeeId uniqueness only considers non-purged employees.
```

3.15 Result serialization differs by collection vs resource
EndpointResourceResult::normalize() → normalizeObject() (single object → array).

EndpointCollectionResult::normalize() → if the model class implements CollectionNormalizable, normalizeObject(); otherwise normalizeObjectsArray().

3.16 Traits resolve dependencies from the DI container
UserRoleManagerTrait::getUserRoleManager() → $container->get(Services::USER_ROLE_MANAGER).

AuthUserTrait::getAuthUser() → $container->get(Services::AUTH_USER) (returns OrangeHRM\Authentication\Auth\User).

3.17 ParamRuleCollection::addParamValidation() rejects duplicate keys
Throws ValidatorException if a rule is already registered for a given parameter key.

3.18 DataGroupPermission.self is a distinct flag
isSelf() returns the self boolean. Used by BasicUserRoleManager to scope access to the logged-in user's own records. Live data shows self=1 rows for ESS and Supervisor roles on many data groups.

3.19 ApiPermission.api_name is unique
Doctrine annotation: uniqueConstraints={@ORM\UniqueConstraint(name="api_name", columns={"api_name"})}. Each API class maps to exactly one data group.

3.20 Response::formatError() does not use the {data, meta, rels} envelope
Errors are emitted as {error: {status, message, data?}}, not wrapped in the success envelope.

4. Architecture
   4.1 Request lifecycle (fully verified)

```text
HTTP request
  ↓
Symfony kernel
  ↓
ControllerEvent (priority 80000)
  → ApiAuthorizationSubscriber::onControllerEvent
     - skip if PublicControllerInterface
     - skip if not AbstractRestController
     - read _api from request attributes; throw ForbiddenException if null
     - getUserRoleManager() → container Services::USER_ROLE_MANAGER
        - UserRoleManagerService::getUserRoleManager()
           - read config key authorize_user_role_manager_class
           - instantiate class, setUser(AuthUser::getUserId())
        - BasicUserRoleManager::getApiPermissions($apiClass)
           → DataGroupService::getApiPermissions($apiClass, $userRoles)
              → DataGroupDao::getApiPermissions($apiClass, $roles)
                 - Doctrine query on DataGroupPermission / DataGroup / UserRole / ApiPermission
              - reduce DataGroupPermission[] → ResourcePermission (OR of each flag)
     - map verb → canRead / canCreate / canUpdate / canDelete
     - throw ForbiddenException('Unauthorized') if not allowed
  ↓
GenericRestController::handle(HttpRequest)
  → AbstractRestController::handle(HttpRequest)
     - new Request($httpRequest)
     - $this->init($request)
        - GenericRestController::init reads _api, instantiates endpoint, validates interfaces
     - getValidationRule($request)
        - GET    → initGetValidationRule → getValidationRuleForGetOne or GetAll
        - POST   → initPostValidationRule → getValidationRuleForCreate
        - PUT    → initPutValidationRule → getValidationRuleForUpdate
        - DELETE → initDeleteValidationRule → getValidationRuleForDelete (CollectionEndpoint only)
     - Validator::validate($request->getAllParameters(), $validationRule)
        - strip DEFAULT_EXCLUDED_PARAM_KEYS
        - for each param key, if rule exists: Respect\Validation\Rules\Key check
        - else (strict mode): throw InvalidParamException('Unexpected Parameter ...')
        - collect errors in $errorBag; throw InvalidParamException($errorBag) if non-empty
        - rethrow ValidationEscapableException immediately
     - switch method → handleGetRequest / handlePostRequest / handlePutRequest / handleDeleteRequest
        - These call the endpoint's getOne / getAll / create / update / delete
     - result->normalize() → Response::formatData() → {data, meta, rels}
     - catch specific exceptions → set JSON body + status code
     - catch ForbiddenException → rethrow
  ↓
ExceptionEvent (priority 0)
  → ApiAuthorizationSubscriber::onExceptionEvent
     - if ForbiddenException → 403 JSON, stopPropagation
  ↓
ExceptionEvent (priority -65)
  → ExceptionSubscriber::onExceptionEvent
     - sets status code and headers, does not format body
4.2 Layer table
Layer	Class	File
Routing	GenericRestController::handle	orangehrmCorePlugin/Controller/Rest/V2/GenericRestController.php
Dispatch	GenericRestController	same
Request/response handling	AbstractRestController	orangehrmCorePlugin/Controller/Rest/V2/AbstractRestController.php
Authorization subscriber	ApiAuthorizationSubscriber	orangehrmCorePlugin/Subscriber/ApiAuthorizationSubscriber.php
Authorization service	UserRoleManagerService, BasicUserRoleManager, DataGroupService, DataGroupDao, ResourcePermission	orangehrmCorePlugin/Authorization/
Authorization entities	UserRole, DataGroup, DataGroupPermission, ApiPermission	orangehrmCorePlugin/entity/
Exception fallback	ExceptionSubscriber	orangehrmCorePlugin/Subscriber/ExceptionSubscriber.php
Endpoint	EmployeeAPI	orangehrmPimPlugin/Api/EmployeeAPI.php
Service	EmployeeService	orangehrmPimPlugin/Service/EmployeeService.php
DAO	EmployeeDao	orangehrmPimPlugin/Dao/EmployeeDao.php
Entity	Employee, EmpPicture, WorkflowStateMachine	orangehrmPimPlugin/entity/, orangehrmCorePlugin/entity/
DB	MariaDB/MySQL	hs_hr_employee, hs_hr_emp_picture, ohrm_workflow_state_machine, ohrm_data_group, ohrm_user_role, ohrm_user_role_data_group, ohrm_api_permission
Validation	Validator, ParamRuleCollection, Rules, InAccessibleEmpNumbers, EntityUniqueProperty, Base64Attachment	orangehrmCorePlugin/Api/V2/Validator/
Serialization	Response, AbstractEndpointResult, EndpointResourceResult, EndpointCollectionResult	orangehrmCorePlugin/Api/V2/
Traits	UserRoleManagerTrait, AuthUserTrait	orangehrmCorePlugin/Traits/
4.3 Concrete representative flow: "Get employee list"
Admin navigates to PIM → Employee List.
```

Live HTTP request:

http
GET /web/index.php/api/v2/pim/employees
?limit=50&offset=0&model=detailed&includeEmployees=onlyCurrent
&sortField=employee.firstName&sortOrder=ASC
Accept: application/json
Cookie: _orangehrm=<session>
Symfony router matches apiv2_pim_employees → GenericRestController::handle.

ApiAuthorizationSubscriber::onControllerEvent:

Reads _api = OrangeHRM\Pim\Api\EmployeeAPI.

getUserRoleManager()->getApiPermissions('OrangeHRM\Pim\Api\EmployeeAPI').

Resolves to ResourcePermission(canRead=true, ...) for Admin.

HTTP verb GET → canRead → allowed.

GenericRestController::init instantiates EmployeeAPI.

initGetValidationRule → getValidationRuleForGetAll() (because _key empNumber is absent).

Validator::validate() runs the getAll rule collection.

handleGetRequest → EmployeeAPI::getAll():

Builds EmployeeSearchFilterParams from query params.

setSortingAndPaginationParams() sets limit=50, offset=0.

model=detailed is validated against MODEL_MAP.

includeEmployees=onlyCurrent is validated against INCLUDE_EMPLOYEES_MAP.

sortField=employee.firstName, sortOrder=ASC.

Calls getUserRoleManager()->getAccessibleEntityIds(Employee::class) → Admin gets all employee IDs.

EmployeeService::getEmployeeList() → EmployeeDao::getEmployeeList():

Doctrine query joins jobTitle, subDivision, empStatus, locations.

Filters by accessible employee numbers, includeEmployees, purgedAt IS NULL.

EmployeeService::getEmployeeCount() → count for meta.total.

Returns EndpointCollectionResult(EmployeeDetailedModel::class, $employees, new ParameterBag(['total' => $count])).

Response::formatData() emits {data, meta, rels}.

Live response:

```json
{
  "data": [
    {"empNumber": 1, "lastName": "Caummo", "firstName": "Admin", "middleName": "", "employeeId": "0001", "terminationId": null, "jobTitle": {"id": null, "title": null, "isDeleted": null}, "subunit": {"id": null, "name": null}, "empStatus": {"id": null, "name": null}, "supervisors": []},
    {"empNumber": 2, "lastName": "Bunummu", "firstName": "ESS", "middleName": "", "employeeId": "0002", "terminationId": null, "jobTitle": {"id": null, "title": null, "isDeleted": null}, "subunit": {"id": null, "name": null}, "empStatus": {"id": null, "name": null}, "supervisors": []}
  ],
  "meta": {"total": 2},
  "rels": []
}
DB verification: SELECT * FROM hs_hr_employee WHERE purged_at IS NULL returns 2 rows with emp_number 1 and 2, matching the response.
```

5. Important Concepts
   Concept Description
   _api Mandatory route attribute pointing to the endpoint class.
   _key Optional param name used for getOne vs getAll distinction. Default: 'id'.
   CrudEndpoint Interface bundling getAll, getOne, create, update, delete.
   Normalizable Interface for JSON-serializable models.
   ModelTrait Standard implementation: wire entity, declare filters, get JSON.
   EndpointResourceResult Single-resource response wrapper.
   EndpointCollectionResult Collection response wrapper with meta.
   ParameterBag Holds the meta object.
   ParamRuleCollection Strict parameter validation container.
   ParamRule Single parameter validation rule.
   ValidationDecorator Wraps rules as required or not-required.
   ALLOWED_SORT_FIELDS Per-resource constant listing valid sortField values.
   MODEL_MAP Pattern for ?model= variant selection (default/detailed).
   ResourcePermission OR-reduced permission flags from DataGroupPermission.
   self flag Restricts a role to its own data rows.
   IN_ACCESSIBLE_EMP_NUMBERS Row-level authorization rule.
   ENTITY_UNIQUE_PROPERTY DB-backed uniqueness validation rule.
   WorkflowStateMachine DB table of allowed state transitions.
   CapableViewController Marker interface for endpoints that bypass permission checks.
   5.1 _api is mandatory
   GenericRestController::init() throws if _api is null. ApiAuthorizationSubscriber::onControllerEvent() also throws ForbiddenException if _api is null. Two independent layers enforce this.

5.2 _key determines getOne() vs getAll()
GenericRestController::isGetOneRequest():

```php
$idAttribute = $request->getAttributes()->get('_key', 'id');
return $request->getAttributes()->has($idAttribute) || $request->getQuery()->has($idAttribute);
Default _key is 'id'. Checks both attributes and query string.
```

5.3 Authorization is three-stage
Endpoint-level (controller event): ApiAuthorizationSubscriber checks ResourcePermission for the _api class.

Row-level (validation): Rules::IN_ACCESSIBLE_EMP_NUMBERS checks UserRoleManager::getAccessibleEntityIds(Employee::class).

Workflow-level (inside endpoint method): UserRoleManager::isActionAllowed(WorkflowStateMachine::FLOW_*, state, action).

5.4 Validation strips framework keys and is strict
DEFAULT_EXCLUDED_PARAM_KEYS are stripped. $strict = true by default, so unexpected parameters fail validation.

5.5 Validator uses Respect\Validation
Each parameter is validated independently via Respect\Validation\Rules\Key. Failures accumulate and are thrown as a single InvalidParamException($errorBag).

5.6 Rules::STRING_TYPE = NotBlankStringType
Rejects blank strings, not just non-strings.

5.7 Data-group permissions are the source of truth for API authorization
ohrm_api_permission.api_name → data_group_id → ohrm_data_group → ohrm_user_role_data_group per user_role_id. The four flags (can_read, can_create, can_update, can_delete) plus self are the actual permission model.

5.8 Workflow state machine is a DB table
ohrm_workflow_state_machine stores allowed transitions per (workflow, state, role, action). The workflow column stores flow IDs as strings. The action column stores integer IDs (as strings) for most flows and action names for Leave.

5.9 UserRoleManager is config-driven and container-resolved
UserRoleManagerService::getUserRoleManager() reads config key authorize_user_role_manager_class, instantiates it, and sets the current User. UserRoleManagerTrait::getUserRoleManager() retrieves it from Services::USER_ROLE_MANAGER.

5.10 AuthUser is container-resolved
AuthUserTrait::getAuthUser() returns Services::AUTH_USER (an OrangeHRM\Authentication\Auth\User).

5.11 Response envelope is {data, meta, rels}
Live-confirmed. meta contains total for collections. rels is [] when empty.

5.12 Error envelope is {error: {status, message, data?}}
Response::formatError() does not wrap in the success envelope.

5.13 EndpointCollectionResult and EndpointResourceResult differ in normalization
EndpointCollectionResult checks for CollectionNormalizable on the model class to decide between single-object and array normalization.

5.14 ParamRuleCollection rejects duplicate parameter rules
addParamValidation() throws ValidatorException on duplicate keys.

5.15 ValidationEscapableException bypasses the error bag
If a rule throws a ValidationEscapableException, Validator::validate() rethrows it immediately.

6. Important Objects, Components, Endpoints, Entities
   6.1 PIM routes (verified from routes.yaml)
   API routes:

GET, POST, DELETE /api/v2/pim/employees — EmployeeAPI

GET, PUT /api/v2/pim/employees/{empNumber} — EmployeeAPI, _key: empNumber, requirements: empNumber: '\d+'

GET /api/v2/pim/employees/count — EmployeeCountAPI

GET, PUT /api/v2/pim/employees/{empNumber}/picture — EmployeePictureAPI, _key: empNumber

GET, PUT /api/v2/pim/employees/{empNumber}/custom-fields — EmployeeCustomFieldAPI, _key: empNumber

GET, PUT /api/v2/pim/employees/{empNumber}/personal-details — EmployeePersonalDetailAPI, _key: empNumber

GET, PUT /api/v2/pim/employees/{empNumber}/job-details — EmployeeJobDetailAPI, _key: empNumber

GET, PUT /api/v2/pim/employees/{empNumber}/employment-contract — EmploymentContractAPI, _key: empNumber

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/terminations — EmployeeTerminationAPI

GET, PUT /api/v2/pim/employees/{empNumber}/terminations/{id} — EmployeeTerminationAPI

GET, PUT /api/v2/pim/employee/{empNumber}/contact-details — EmployeeContactDetailsAPI, _key: empNumber (singular employee)

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/dependents — EmployeeDependentAPI

GET, PUT /api/v2/pim/employees/{empNumber}/dependents/{id} — EmployeeDependentAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/salary-components — EmployeeSalaryComponentAPI

GET, PUT /api/v2/pim/employees/{empNumber}/salary-components/{id} — EmployeeSalaryComponentAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/screen/{screen}/attachments — EmployeeAttachmentAPI

GET, PUT /api/v2/pim/employees/{empNumber}/screen/{screen}/attachments/{id} — EmployeeAttachmentAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/emergency-contacts — EmpEmergencyContactAPI

GET, PUT /api/v2/pim/employees/{empNumber}/emergency-contacts/{id} — EmpEmergencyContactAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/skills — EmployeeSkillAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/skills/allowed — EmployeeAllowedSkillAPI

GET, PUT /api/v2/pim/employees/{empNumber}/skills/{id} — EmployeeSkillAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/educations — EmployeeEducationAPI

GET, PUT /api/v2/pim/employees/{empNumber}/educations/{id} — EmployeeEducationAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/languages — EmployeeLanguageAPI

GET, PUT /api/v2/pim/employees/{empNumber}/languages/{languageId}/fluencies/{fluencyId} — EmployeeLanguageAPI, _key: fluencyId

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/languages/allowed — EmployeeAllowedLanguageAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/work-experiences — EmployeeWorkExperienceAPI

GET, PUT /api/v2/pim/employees/{empNumber}/work-experiences/{id} — EmployeeWorkExperienceAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/licenses — EmployeeLicenseAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/licenses/allowed — EmployeeAllowedLicenseAPI

GET, PUT /api/v2/pim/employees/{empNumber}/licenses/{id} — EmployeeLicenseAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/memberships — EmployeeMembershipAPI

GET, PUT /api/v2/pim/employees/{empNumber}/memberships/{id} — EmployeeMembershipAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/immigrations — EmployeeImmigrationRecordAPI

GET, PUT /api/v2/pim/employees/{empNumber}/immigrations/{id} — EmployeeImmigrationRecordAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/supervisors — EmployeeSupervisorAPI

GET, PUT /api/v2/pim/employees/{empNumber}/supervisors/{id} — EmployeeSupervisorAPI

GET, POST, DELETE /api/v2/pim/employees/{empNumber}/subordinates — EmployeeSubordinateAPI

GET, PUT /api/v2/pim/employees/{empNumber}/subordinates/{id} — EmployeeSubordinateAPI

GET /api/v2/pim/employees/{empNumber}/report-to/allowed — EmployeeAllowedReportToEmployeeAPI

GET, PUT /api/v2/pim/employees/{empNumber}/tax-exemption — EmpUsTaxExemptionAPI

GET /api/v2/pim/employees/{empNumber}/work-shift — EmployeeWorkShiftAPI, _key: empNumber

POST /api/v2/pim/csv-import — EmployeeCSVImportAPI

GET /api/v2/pim/reports — PimReportAPI, _key: name

GET /api/v2/pim/reports/data — PimReportDataAPI

GET, POST, DELETE /api/v2/pim/reports/defined — PimDefinedReportAPI

GET, PUT /api/v2/pim/reports/defined/{id} — PimDefinedReportAPI

PUT /api/v2/pim/update-password — UpdatePasswordAPI, id: 0

GET /api/v2/pim/employees/{empNumber}/contact-details/validation/work-emails — ValidationEmployeeEmailAPI, _key: workEmail

GET /api/v2/pim/employees/{empNumber}/contact-details/validation/other-emails — ValidationEmployeeOtherEmailAPI, _key: otherEmail

GET /api/v2/pim/myself — MyInfoAPI, id: 0

GET, POST, DELETE /api/v2/pim/termination-reasons — TerminationReasonConfigurationAPI

GET, PUT /api/v2/pim/termination-reasons/{id} — TerminationReasonConfigurationAPI

GET, POST, DELETE /api/v2/pim/reporting-methods — ReportingMethodConfigurationAPI

GET, PUT /api/v2/pim/reporting-methods/{id} — ReportingMethodConfigurationAPI

GET, POST, DELETE /api/v2/pim/custom-fields — CustomFieldAPI

GET, PUT /api/v2/pim/custom-fields/{id} — CustomFieldAPI, requirements: id: '\d+'

GET, PUT /api/v2/pim/optional-field — OptionalFieldAPI, id: 0

File routes:

GET /pim/viewPhoto/empNumber/{empNumber} — File\EmployeePictureController

GET /pim/viewAttachment/empNumber/{empNumber}/attachId/{attachId} — File\EmployeeAttachmentController

GET /pim/sampleCsvDownload — File\EmployeeCsvImportSampleAttachmentController

Screen routes: /pim/viewPimModule, /pim/viewMyDetails, /pim/viewEmployeeList, /pim/addEmployee, /pim/viewPersonalDetails/empNumber/{empNumber}, /pim/contactDetails/empNumber/{empNumber}, /pim/viewEmergencyContacts/empNumber/{empNumber}, /pim/viewDependents/empNumber/{empNumber}, /pim/viewSalaryList/empNumber/{empNumber}, /pim/viewPhotograph/empNumber/{empNumber}, /pim/viewJobDetails/empNumber/{empNumber}, /pim/viewQualifications/empNumber/{empNumber}, /pim/viewReportToDetails/empNumber/{empNumber}, /pim/viewTerminationReasons, /pim/saveTerminationReasons, /pim/saveTerminationReasons/{id}, /pim/viewReportingMethods, /pim/saveReportingMethod, /pim/saveReportingMethod/{id}, /pim/listCustomFields, /pim/saveCustomFields, /pim/saveCustomFields/{id}, /pim/configurePim, /pim/viewImmigration/empNumber/{empNumber}, /pim/viewMemberships/empNumber/{empNumber}, /pim/viewUsTaxExemptions/empNumber/{empNumber}, /pim/pimCsvImport, /pim/viewDefinedPredefinedReports, /pim/definePredefinedReport, /pim/definePredefinedReport/{id}, /pim/displayPredefinedReport/{id}, /pim/updatePassword

6.2 Leave routes (verified)
API routes:

GET, POST, DELETE /api/v2/leave/holidays — HolidayAPI

GET, PUT /api/v2/leave/holidays/{id} — HolidayAPI

GET, PUT /api/v2/leave/workweek — WorkWeekAPI, id: 1

GET, PUT /api/v2/leave/leave-period — LeavePeriodAPI, id: 0

GET /api/v2/leave/leave-periods — LeavePeriodAPI

GET, POST, DELETE /api/v2/leave/leave-types — LeaveTypeAPI

GET, PUT /api/v2/leave/leave-types/{id} — LeaveTypeAPI, requirements: id: '\d+'

GET, POST, DELETE /api/v2/leave/leave-types/eligible — EligibleLeaveTypeAPI

GET, POST, DELETE /api/v2/leave/leave-requests — MyLeaveRequestAPI

GET, PUT /api/v2/leave/leave-requests/{leaveRequestId} — MyLeaveRequestAPI, _key: leaveRequestId

GET, POST, DELETE /api/v2/leave/employees/leave-requests — EmployeeLeaveRequestAPI

GET, PUT /api/v2/leave/employees/leave-requests/{leaveRequestId} — EmployeeLeaveRequestAPI, _key: leaveRequestId

PUT /api/v2/leave/employees/leave-requests/bulk — EmployeeBulkLeaveRequestAPI

GET, POST, DELETE /api/v2/leave/leave-entitlements — LeaveEntitlementAPI

GET, PUT /api/v2/leave/leave-entitlements/{id} — LeaveEntitlementAPI, requirements: id: '\d+'

GET /api/v2/leave/employees/{empNumber}/leave-entitlements — EmployeeLeaveEntitlementAPI, _key: empNumber

GET /api/v2/leave/employees/leave-entitlements — EmployeeLeaveEntitlementAPI

GET /api/v2/leave/leave-balance/leave-type/{leaveTypeId} — LeaveBalanceAPI, _key: leaveTypeId

GET /api/v2/leave/employees/leave-balances — EmployeeLeaveBalanceAPI

GET /api/v2/leave/leave-entitlements/{id}/validation/entitlements — ValidationLeaveEntitlementValueAPI

GET /api/v2/leave/overlap-leaves — LeaveOverlapAPI

GET, POST /api/v2/leave/leave-requests/{leaveRequestId}/leave-comments — LeaveRequestCommentAPI

GET, POST /api/v2/leave/leaves/{leaveId}/leave-comments — LeaveCommentAPI

GET /api/v2/leave/leave-requests/{leaveRequestId}/leaves — LeaveAPI

PUT /api/v2/leave/leaves/{leaveId} — LeaveAPI, _key: leaveId, requirements: leaveId: '\d+'

PUT /api/v2/leave/leaves/bulk — BulkLeaveAPI

GET /api/v2/leave/reports — LeaveReportAPI, _key: name

GET /api/v2/leave/reports/data — LeaveReportDataAPI

GET /api/v2/leave/employees/leaves — EmployeeLeaveAPI

Screen routes: /leave/viewLeaveModule, /leave/defineLeavePeriod, /leave/applyLeave, /leave/assignLeave, /leave/viewLeaveList, /leave/viewMyLeaveList, /leave/viewLeaveRequest/{id}, /leave/leaveTypeList, /leave/defineLeaveType, /leave/defineLeaveType/{id}, /leave/addLeaveEntitlement, /leave/editLeaveEntitlement/{id}, /leave/viewLeaveEntitlements, /leave/viewMyLeaveEntitlements, /leave/defineWorkWeek, /leave/viewHolidayList, /leave/saveHolidays, /leave/saveHolidays/{id}, /leave/viewLeaveBalanceReport, /leave/viewMyLeaveBalanceReport

6.3 Admin routes (verified)
API routes:

GET, POST, DELETE /api/v2/admin/job-titles — JobTitleAPI

GET, PUT /api/v2/admin/job-titles/{id} — JobTitleAPI

GET, PUT, DELETE /api/v2/admin/job-titles/{jobTitleId}/specification — JobSpecificationAPI, _key: jobTitleId

GET, POST, DELETE /api/v2/admin/job-categories — JobCategoryAPI

GET, PUT /api/v2/admin/job-categories/{id} — JobCategoryAPI

GET, POST, DELETE /api/v2/admin/users — UserAPI

GET, PUT /api/v2/admin/users/{id} — UserAPI

GET, POST /api/v2/admin/subunits — SubunitAPI

GET, PUT, DELETE /api/v2/admin/subunits/{id} — SubunitAPI

GET, POST, DELETE /api/v2/admin/employment-statuses — EmploymentStatusAPI

GET, PUT /api/v2/admin/employment-statuses/{id} — EmploymentStatusAPI

GET, POST, DELETE /api/v2/admin/educations — EducationAPI

GET, PUT /api/v2/admin/educations/{id} — EducationAPI

GET, POST, DELETE /api/v2/admin/skills — SkillAPI

GET, PUT /api/v2/admin/skills/{id} — SkillAPI

GET, POST, DELETE /api/v2/admin/licenses — LicenseAPI

GET, PUT /api/v2/admin/licenses/{id} — LicenseAPI

GET, POST, DELETE /api/v2/admin/languages — LanguageAPI

GET, PUT /api/v2/admin/languages/{id} — LanguageAPI

GET, POST, DELETE /api/v2/admin/memberships — MembershipAPI

GET, PUT /api/v2/admin/memberships/{id} — MembershipAPI

GET, PUT /api/v2/admin/organization — OrganizationAPI, id: 0

GET, POST, DELETE /api/v2/admin/pay-grades — PayGradeAPI

GET, PUT /api/v2/admin/pay-grades/{id} — PayGradeAPI

GET, POST, DELETE /api/v2/admin/pay-grades/{payGradeId}/currencies — PayGradeCurrencyAPI

GET, PUT /api/v2/admin/pay-grades/{payGradeId}/currencies/{id} — PayGradeCurrencyAPI

GET /api/v2/admin/pay-grades/{payGradeId}/currencies/allowed — PayGradeAllowedCurrencyAPI

GET, POST, DELETE /api/v2/admin/nationalities — NationalityAPI

GET, PUT /api/v2/admin/nationalities/{id} — NationalityAPI

GET, PUT /api/v2/admin/email-configuration — EmailConfigurationAPI, id: 0

GET, POST, DELETE /api/v2/admin/work-shifts — WorkShiftAPI

GET, PUT /api/v2/admin/work-shifts/{id} — WorkShiftAPI, requirements: id: '\d+'

GET /api/v2/admin/work-shifts/employees — WorkShiftEmployeeAPI

GET, POST, DELETE /api/v2/admin/locations — LocationAPI

GET, PUT /api/v2/admin/locations/{id} — LocationAPI

GET, PUT /api/v2/admin/modules — ModulesAPI

GET /api/v2/admin/email-subscriptions — EmailSubscriptionAPI

PUT /api/v2/admin/email-subscriptions/{id} — EmailSubscriptionAPI

GET, POST, DELETE /api/v2/admin/email-subscriptions/{emailSubscriptionId}/subscribers — EmailSubscriberAPI

GET, PUT /api/v2/admin/email-subscriptions/{emailSubscriptionId}/subscribers/{id} — EmailSubscriberAPI

GET /api/v2/admin/validation/user-name — ValidationUserNameAPI, _key: userName

GET, PUT /api/v2/admin/localization — LocalizationAPI, id: 0

GET, DELETE /api/v2/admin/i18n/languages — I18NLanguageAPI

POST /api/v2/admin/i18n/languages/{languageId}/import — I18NTranslationImportAPI

GET, PUT /api/v2/admin/i18n/languages/{id} — I18NLanguageAPI

GET /api/v2/admin/i18n/languages/{languageId}/translations — I18NTranslationAPI

PUT /api/v2/admin/i18n/languages/{languageId}/translations/bulk — I18NTranslationBulkAPI

GET /api/v2/admin/i18n/groups — I18NGroupAPI

GET /api/v2/admin/i18n/translation/{langStringId}/validate — I18NTranslationValidationAPI, _key: langStringId

GET /api/v2/admin/i18n/languages/{languageId}/translations/errors — I18NImportErrorAPI

File routes:

GET /admin/viewJobSpecification/attachId/{attachId} — File\JobSpecification

GET /admin/viewLanguagePackage/languageId/{languageId} — File\LanguagePackage

Screen routes: /admin/viewAdminModule, /admin/viewJobTitleList, /admin/saveJobTitle, /admin/saveJobTitle/{id}, /admin/jobCategory, /admin/saveJobCategory, /admin/saveJobCategory/{id}, /admin/employmentStatus, /admin/saveEmploymentStatus, /admin/saveEmploymentStatus/{id}, /admin/viewSystemUsers, /admin/saveSystemUser, /admin/saveSystemUser/{id}, /admin/viewCompanyStructure, /admin/viewEducation, /admin/saveEducation, /admin/saveEducation/{id}, /admin/viewSkills, /admin/saveSkills, /admin/saveSkills/{id}, /admin/viewLicenses, /admin/saveLicenses, /admin/saveLicenses/{id}, /admin/viewLanguages, /admin/saveLanguages, /admin/saveLanguages/{id}, /admin/membership, /admin/saveMemberships, /admin/saveMemberships/{id}, /admin/viewOrganizationGeneralInformation, /admin/nationality, /admin/saveNationality, /admin/saveNationality/{id}, /admin/viewLocations, /admin/saveLocation, /admin/saveLocation/{id}, /admin/listMailConfiguration, /admin/viewPayGrades, /admin/payGrade, /admin/payGrade/{id}, /admin/viewModules, /admin/workShift, /admin/saveWorkShifts, /admin/saveWorkShifts/{id}, /admin/viewEmailNotification, /admin/saveSubscriber/{id}, /admin/localization, /admin/openIdProvider, /admin/languagePackage, /admin/languageImport/{languageId}, /admin/fixLanguageStringErrors/{languageId}, /admin/languageCustomization/{languageId}, /admin/ldapConfiguration, /admin/workspaceNotificationConfiguration

6.4 Claim routes (verified)
API routes:

POST, GET, DELETE /api/v2/claim/events — ClaimEventAPI

GET, PUT /api/v2/claim/events/{id} — ClaimEventAPI

POST, GET, DELETE /api/v2/claim/expenses/types — ClaimExpenseTypeAPI

GET, PUT /api/v2/claim/expenses/types/{id} — ClaimExpenseTypeAPI

POST, GET, DELETE /api/v2/claim/requests/{requestId}/expenses — ClaimExpenseAPI

GET, PUT /api/v2/claim/requests/{requestId}/expenses/{id} — ClaimExpenseAPI

POST, GET, DELETE /api/v2/claim/requests/{requestId}/attachments — ClaimAttachmentAPI

GET, PUT /api/v2/claim/requests/{requestId}/attachments/{id} — ClaimAttachmentAPI

POST, GET /api/v2/claim/requests — MyClaimRequestAPI

GET /api/v2/claim/requests/{id} — MyClaimRequestAPI

POST /api/v2/claim/employees/{empNumber}/requests — EmployeeClaimRequestAPI

GET /api/v2/claim/employees/requests — EmployeeClaimRequestAPI

GET /api/v2/claim/employees/{empNumber}/requests/{id} — EmployeeClaimRequestAPI

PUT, GET /api/v2/claim/requests/{requestId}/action — ClaimRequestActionAPI

Screen routes: /claim/viewClaimModule, /claim/viewEvents, /claim/saveEvents, /claim/saveEvents/{id}, /claim/viewExpense, /claim/saveExpense, /claim/saveExpense/{id}, /claim/submitClaim, /claim/submitClaim/id/{id}, /claim/viewClaim, /claim/assignClaim, /claim/assignClaim/id/{id}, /claim/viewAssignClaim

File routes:

GET /claim/requests/{requestId}/attachId/{attachId} — ClaimAttachmentController

6.5 API permission table (live, 199 rows)
ohrm_api_permission maps each API class to a data_group_id. Key rows:

id module_id data_group_id api_name
32 3 96 OrangeHRM\Pim\Api\EmployeeAPI
181 3 261 OrangeHRM\Pim\Api\MyInfoAPI
66 4 130 OrangeHRM\Leave\Api\HolidayAPI
185 18 265 OrangeHRM\Claim\Api\ClaimEventAPI
17 2 81 OrangeHRM\Admin\Api\UserAPI
64 3 128 OrangeHRM\Pim\Api\UpdatePasswordAPI
118 13 187 OrangeHRM\Maintenance\Api\PurgeEmployeeAPI
199 2 280 OrangeHRM\WorkspaceNotifications\Api\WorkspaceNotificationTestWebhookAPI
6.6 Data group table (live, 280 rows)
Key rows:

id name description can_read can_create can_update can_delete
96 apiv2_pim_employee API-v2 PIM - Employees 1 1 0 1
261 apiv2_pim_my_info PIM - Logged In User Details 1 0 0 0
81 apiv2_admin_user API-v2 Admin - Users 1 1 1 1
128 apiv2_pim_update_password API-v2 PIM - Password Update 0 0 1 0
187 apiv2_maintenance_purge_employee API-v2 Maintenance - Purge Employee 1 0 0 1
280 apiv2_admin_workspace_notification_test API-v2 Admin - Workspace Notification Test Webhook 0 1 0 0
6.7 User role data group (live, 717 rows)
Key rows for data_group_id = 96 (apiv2_pim_employee):

id user_role_id data_group_id can_read can_create can_update can_delete self
272 1 (Admin) 96 1 1 0 1 0
273 2 (ESS) 96 1 0 0 0 1
274 3 (Supervisor) 96 1 0 0 0 0
275 3 (Supervisor) 96 1 0 0 0 1
6.8 User role table (live, 7 rows)
id name display_name is_assignable is_predefined
1 Admin Admin 1 1
2 ESS ESS 1 1
3 Supervisor Supervisor 0 1
4 ProjectAdmin ProjectAdmin 0 1
5 Interviewer Interviewer 0 1
6 HiringManager HiringManager 0 1
7 Reviewer Reviewer 0 1
6.9 Workflow state machine (live, 152 rows)
Employee flow (workflow = '3'):

id workflow state role action resulting_state roles_to_notify priority
81 3 NOT_EXIST ADMIN 1 ACTIVE 0
82 3 ACTIVE ADMIN 2 NOT_EXIST 0
83 3 ACTIVE ADMIN 3 TERMINATED 0
84 3 TERMINATED ADMIN 4 ACTIVE 0
85 3 TERMINATED ADMIN 5 NOT_EXIST 0
Claim flow (workflow = '7'):

id workflow state role action resulting_state roles_to_notify priority
127 7 INITIATED ESS USER 1 SUBMITTED 10
128 7 INITIATED ESS USER 4 CANCELLED 10
129 7 SUBMITTED ESS USER 4 CANCELLED 10
130 7 REJECTED ESS USER 1 SUBMITTED 10
131 7 INITIATED ADMIN 1 PAID 0
132 7 APPROVED ADMIN 5 REJECTED 0
133 7 SUBMITTED ADMIN 2 PAID 10
134 7 SUBMITTED ADMIN 5 REJECTED 0
135 7 APPROVED ADMIN 3 PAID 0
136 7 INITIATED SUPERVISOR 1 APPROVED 0
137 7 SUBMITTED SUPERVISOR 2 APPROVED 0
138 7 SUBMITTED SUPERVISOR 5 REJECTED 0
Leave flow (workflow = '4') uses string actions and states. Example rows:

id workflow state role action resulting_state roles_to_notify priority
86 4 INITIAL ESS APPLY PENDING APPROVAL supervisor,subscriber 0
87 4 INITIAL ADMIN ASSIGN SCHEDULED ess,supervisor,subscriber 0
88 4 INITIAL SUPERVISOR ASSIGN SCHEDULED ess,supervisor,subscriber 0
89 4 PENDING APPROVAL ADMIN APPROVE SCHEDULED ess,subscriber 0
90 4 PENDING APPROVAL SUPERVISOR APPROVE SCHEDULED ess,subscriber 0
91 4 PENDING APPROVAL ESS CANCEL CANCELLED supervisor,subscriber 0
92 4 PENDING APPROVAL ADMIN CANCEL CANCELLED ess,subscriber 0
93 4 PENDING APPROVAL SUPERVISOR CANCEL CANCELLED ess,subscriber 0
94 4 PENDING APPROVAL ADMIN REJECT REJECTED ess,subscriber 0
95 4 PENDING APPROVAL SUPERVISOR REJECT REJECTED ess,subscriber 0
6.10 Employee entity (verified against live schema)
Employee maps to hs_hr_employee. All 48 columns match. Key fields:

empNumber ↔ emp_number (int(11), PK, auto_increment)

employeeId ↔ employee_id (varchar(50), nullable)

firstName ↔ emp_firstname (varchar(100), NOT NULL)

middleName ↔ emp_middle_name (varchar(100), NOT NULL)

lastName ↔ emp_lastname (varchar(100), NOT NULL)

empStatus ↔ emp_status (int(13), MUL)

jobTitle ↔ job_title_code (int(7), MUL)

jobCategory ↔ eeo_cat_code (int(11), MUL)

subDivision ↔ work_station (int(6), MUL)

employeeTerminationRecord ↔ termination_id (int(4), MUL)

custom1–custom10 ↔ custom1–custom10 (varchar(250))

purgedAt ↔ purged_at (datetime, nullable)

salaryGradeCode ↔ sal_grd_code (varchar(13), nullable, @deprecated)

6.11 EmpPicture entity (verified)
EmpPicture maps to hs_hr_emp_picture. Allowed types/extensions are hard-coded:

ALLOWED_IMAGE_TYPES: image/gif, image/jpeg, image/jpg, image/pjpeg, image/png, image/x-png

ALLOWED_IMAGE_EXTENSIONS: gif, jpeg, jpg, jfif, png

6.12 WorkflowStateMachine entity (verified)
WorkflowStateMachine maps to ohrm_workflow_state_machine. Columns: id, workflow, state, role, action, resulting_state, roles_to_notify, priority.

Flow constants: FLOW_TIME_TIMESHEET = 0, FLOW_ATTENDANCE = 1, FLOW_RECRUITMENT = 2, FLOW_EMPLOYEE = 3, FLOW_LEAVE = 4, FLOW_REVIEW = 5, FLOW_SELF_REVIEW = 6, FLOW_CLAIM = 7.

Employee action constants: EMPLOYEE_ACTION_ADD = 1, EMPLOYEE_ACTION_DELETE_ACTIVE = 2, EMPLOYEE_ACTION_TERMINATE = 3, EMPLOYEE_ACTION_REACTIVE = 4, EMPLOYEE_ACTION_DELETE_TERMINATED = 5.

Claim action constants: CLAIM_ACTION_SUBMIT = 1, CLAIM_ACTION_APPROVE = 2, CLAIM_ACTION_PAY = 3, CLAIM_ACTION_CANCEL = 4, CLAIM_ACTION_REJECT = 5.

6.13 Authorization entities (verified)
UserRole → ohrm_user_role: id, name, display_name, is_assignable, is_predefined

DataGroup → ohrm_data_group: id, name, description, can_read, can_create, can_update, can_delete; one-to-many dataGroupPermissions and apiPermissions

DataGroupPermission → ohrm_user_role_data_group: id, can_read, can_create, can_update, can_delete, self, data_group_id, user_role_id

ApiPermission → ohrm_api_permission: id, api_name (unique), module_id, data_group_id

7. Relationships to Other OrangeHRM Layers
   7.1 UI → API (live-verified)
   The SPA at /web/index.php/pim/viewEmployeeList issued a GET to /web/index.php/api/v2/pim/employees with Accept: application/json and a session cookie, receiving {data, meta, rels}. This proves the SPA uses the REST API and session-cookie auth.

7.2 API → Service → DAO → Entity → DB (verified)
EmployeeAPI::getAll() → EmployeeService::getEmployeeList() / getEmployeeCount() → EmployeeDao::getEmployeeList() / getEmployeeCount() → Doctrine query on Employee entity → hs_hr_employee.

7.3 Authorization relationship (fully verified)
ApiAuthorizationSubscriber::onControllerEvent() → UserRoleManagerTrait::getUserRoleManager() → container Services::USER_ROLE_MANAGER → UserRoleManagerService::getUserRoleManager() (reads config key authorize_user_role_manager_class) → BasicUserRoleManager::getApiPermissions($apiClass) → DataGroupService::getApiPermissions($apiClass, $userRoles) → DataGroupDao::getApiPermissions($apiClass, $roles) → Doctrine query joining DataGroupPermission, DataGroup, UserRole, ApiPermission → reduce to ResourcePermission.

BasicUserRoleManager::computeUserRoles() expands a user's roles: primary + ESS (if not ESS) + ProjectAdmin + HiringManager + Interviewer + Supervisor + Reviewer, based on empNumber-scoped checks.

7.4 Validation relationship (fully verified)
AbstractRestController::handle() calls Validator::validate() before method dispatch.

Validator::validate() strips DEFAULT_EXCLUDED_PARAM_KEYS, iterates rule keys, uses Respect\Validation\Rules\Key, accumulates errors in $errorBag, throws InvalidParamException($errorBag) if non-empty.

ParamRuleCollection::$strict = true by default: unexpected params throw InvalidParamException('Unexpected Parameter ('<key>') Received').

Row-level rules (InAccessibleEmpNumbers) and DB-backed rules (EntityUniqueProperty) run inside Validator::validate().

ValidationEscapableException bypasses the error bag and is rethrown immediately.

7.5 Workflow state machine (live-verified)
ohrm_workflow_state_machine has 152 rows. EmployeeAPI::create() checks FLOW_EMPLOYEE / STATE_NOT_EXIST / EMPLOYEE_ACTION_ADD. getValidationRuleForDelete() checks FLOW_EMPLOYEE / STATE_ACTIVE or STATE_TERMINATED / EMPLOYEE_ACTION_DELETE_ACTIVE or EMPLOYEE_ACTION_DELETE_TERMINATED.

8. Testing Implications
   8.1 UI tests exercise the API indirectly
   The live trace proves the SPA calls /api/v2/... with Accept: application/json and a session cookie. Playwright UI tests therefore also exercise the API contract.

8.2 API tests are faster and more precise
Direct API calls are the right layer for testing request/response schemas, status codes, validation errors, and authorization.

8.3 Authorization has three layers to test
Endpoint-level: 403 for a user without the required canRead/canCreate/canUpdate/canDelete on the API class.

Row-level: filtered results for a user with limited getAccessibleEntityIds(Employee::class).

Workflow-level: BadRequestException when isActionAllowed() returns false.

8.4 Validation has two modes to test
Declared rules: 422 with {error: {status: "422", message, data}}.

Strict mode: 422 with message = "Unexpected Parameter ('<key>') Received".

8.5 Response envelope is stable
{data, meta, rels} for success. {error: {status, message, data?}} for errors.

8.6 Rules::STRING_TYPE rejects blank strings
Tests sending "" for a string field get 422.

8.7 Rules::ENTITY_UNIQUE_PROPERTY filters by purgedAt = null
Uniqueness for employeeId only considers non-purged employees.

8.8 Rules::IN_ACCESSIBLE_EMP_NUMBERS includes the logged-in user by default
InAccessibleEmpNumbers::__construct(bool $includeLoggedInEmpNumber = true). Tests must account for this.

8.9 Workflow state machine is directly queryable
SELECT * FROM ohrm_workflow_state_machine WHERE workflow = '3' returns all Employee transitions.

8.10 Data-group permissions are directly queryable
SELECT * FROM ohrm_user_role_data_group WHERE data_group_id = 96 returns all role permissions for apiv2_pim_employee.

8.11 Response model selection is query-param driven
model=default vs model=detailed selects EmployeeModel vs EmployeeDetailedModel. create() always returns EmployeeModel regardless.

8.12 DB assertions should be selective
Direct DB queries are appropriate for verifying persistence, setting up preconditions, and debugging. They are not appropriate for asserting every field.

8.13 Cross-module workflows span plugins
Terminating an employee affects PIM (employee record), Admin (user account), and potentially Leave (entitlements). Understanding cross-module service calls is necessary for correct test data setup and cleanup.

9. Known Quirks and Gotchas

# Quirk Evidence

9.1 Missing endpoint methods return 501, not 405 EmployeeAPI::update() throws NotImplementedException → AbstractRestController::handle() catches → 501 with {error: {status: "501", message: "Not Implemented"}}.
9.2 _api is mandatory GenericRestController::init() throws if _api is null. ApiAuthorizationSubscriber::onControllerEvent() throws ForbiddenException if _api is null.
9.3 Same endpoint class for collection and resource EmployeeAPI handles both /api/v2/pim/employees and /api/v2/pim/employees/{empNumber}. Same for HolidayAPI, etc.
9.4 Some routes have fixed id defaults apiv2_leave_workweek (id: 1), apiv2_leave_leave_period (id: 0), apiv2_pim_optional_field (id: 0), apiv2_pim_update_password (id: 0), apiv2_admin_organization (id: 0), apiv2_admin_email_configuration (id: 0), apiv2_admin_localization (id: 0), apiv2_pim_my_info (id: 0).
9.5 Some routes use non-ID _key apiv2_pim_reports / apiv2_leave_reports → _key: name. apiv2_pim_validate_employee_email → _key: workEmail. apiv2_pim_validate_employee_other_email → _key: otherEmail. apiv2_admin_validate_user_name → _key: userName. apiv2_admin_i18n_translation_validation → _key: langStringId.
9.6 apiv2_pim_employee_contact_details uses singular employee Path is /api/v2/pim/employee/{empNumber}/contact-details — singular, unlike all other PIM employee sub-resources.
9.7 initDeleteValidationRule() only handles CollectionEndpoint A pure ResourceEndpoint (not CollectionEndpoint) skips delete validation rule initialization, even though handleDeleteRequest() accepts either interface.
9.8 getEmployeeByEmpNumber() does not filter purgedAt EmployeeDao::getEmployeeByEmpNumber() uses find($empNumber) with no purgedAt check. List queries always filter isNull('employee.purgedAt').
9.9 deleteEmployees() is a hard delete EmployeeDao::deleteEmployees() uses $q->delete()->where(...). Does not set purgedAt.
9.10 AbstractRestController catch ordering matters ForbiddenException is caught after BadRequestException and rethrown.
9.11 ExceptionSubscriber only sets status/headers Does not format JSON. Uncaught exceptions may produce non-JSON bodies.
9.12 InvalidParamException has a TODO Source comment: // TODO:: should format to show multiple errors.
9.13 create() always returns EmployeeModel Does not respect the model query param, even though getOne() and getAll() do.
9.14 EmployeeService owns max-length constants FIRST_NAME_MAX_LENGTH = 30, MIDDLE_NAME_MAX_LENGTH = 30, LAST_NAME_MAX_LENGTH = 30, EMPLOYEE_ID_MAX_LENGTH = 10, WORK_EMAIL_MAX_LENGTH = 50.
9.15 Workflow state machine gates create and delete EmployeeAPI::create() and getValidationRuleForDelete().
9.16 Rules::STRING_TYPE is NotBlankStringType Rejects blank strings.
9.17 UserRoleManager class is config-driven Read from authorize_user_role_manager_class.
9.18 BasicUserRoleManager::computeUserRoles() expands roles Adds ESS, ProjectAdmin, HiringManager, Interviewer, Supervisor, Reviewer based on empNumber-scoped checks.
9.19 salaryGradeCode is deprecated but still in schema Employee::$salaryGradeCode has @deprecated and @todo remove from schema, but sal_grd_code exists.
9.20 purgedAt is a datetime, not a boolean purged_at datetime nullable.
9.21 EmpPicture has explicit allowed types/extensions ALLOWED_IMAGE_TYPES, ALLOWED_IMAGE_EXTENSIONS.
9.22 Response::formatData() always includes data, meta, rels Live-confirmed.
9.23 AbstractEndpointResult throws NormalizeException if model class does not exist class_exists($modelClass) check in constructor.
9.24 ParamRuleCollection::addParamValidation() rejects duplicate keys Throws ValidatorException if a rule is already registered for a param key.
9.25 Validator::validate() rethrows ValidationEscapableException Bypasses the error bag.
9.26 Base64Attachment size check can be strict If $checkSizeStrictly, decoded base64 length must equal declared size.
9.27 InAccessibleEmpNumbers includes the logged-in user by default Constructor default $includeLoggedInEmpNumber = true.
9.28 EntityUniqueProperty supports matchValues and ignoreValues matchValues adds equality/null filters; ignoreValues adds inequality filters.
9.29 DataGroupPermission.self is a separate flag isSelf() returns the self boolean. Used to scope access to the logged-in user's own records.
9.30 UserRole has is_assignable and is_predefined flags Only Admin and ESS are is_assignable = 1. Derived roles are is_assignable = 0, is_predefined = 1.
9.31 ApiPermission.api_name is unique Doctrine annotation: uniqueConstraints={@ORM\UniqueConstraint(name="api_name", columns={"api_name"})}.
9.32 ApiPermission is linked to both Module and DataGroup api_name → data_group_id → ohrm_data_group. module_id links to the module.
9.33 Response::formatError() does not wrap in data/meta/rels It emits the raw error structure.
9.34 EndpointCollectionResult handles CollectionNormalizable If the model class implements CollectionNormalizable, it normalizes as a single object; otherwise as an array.
9.35 ParamRuleCollection::$strict is true by default Strict mode is on unless explicitly disabled.
9.36 Validator::getOnlyNecessaryValues() removes excluded keys The excluded keys are framework-internal. 10. Version-Specific Notes
All facts above are from the 5.9 source files, the live 5.9 DB schema, and live HTTP traffic from a running 5.9 instance. No version drift was detected.

Key 5.9-era facts:

OXD UI / Vue 3 SPA is present in 5.9.

REST API v2 is present in 5.9.

Claim module is present in 5.9 (FLOW_CLAIM = 7).

Workspace Notifications are present in 5.9 (apiv2_admin_workspace_notification_* data groups).

LDAP configuration is present in 5.9 (apiv2_admin_ldap_config).

OpenID Connect is present in 5.9 (apiv2_auth_openid_provider).

Sources describing 5.7 or 5.8 architecture are likely accurate for 5.9 in broad strokes, but exact endpoint availability, validation rules, and response models should be verified against 5.9 source.

11. Facts vs Inferences vs Assumptions
    FACT (source- or live-verified)
    Everything in sections 3–9 that cites a pasted file, a DB row, or an HTTP response.

INFERENCE
The Vue SPA uses an Axios-based APIService wrapper — inferred from the live HTTP trace, not directly verified in a Vue file.

The default authorize_user_role_manager_class value is BasicUserRoleManager — inferred from UserRoleManagerService and the existence of BasicUserRoleManager.

DataGroupPermission.self scopes access to the logged-in user's own records — inferred from the flag name and BasicUserRoleManager usage.

ASSUMPTION
None remaining that affect the architectural claims above.

12. Sources
    All facts in this document are from the following, which you pasted from your cloned 5.9 source, your running DB, or your running HTTP instance.

Source files:

src/plugins/orangehrmLeavePlugin/config/routes.yaml

src/plugins/orangehrmAdminPlugin/config/routes.yaml

src/plugins/orangehrmClaimPlugin/config/routes.yaml

src/plugins/orangehrmPimPlugin/config/routes.yaml

src/plugins/orangehrmPimPlugin/Api/EmployeeAPI.php

src/plugins/orangehrmCorePlugin/Controller/Rest/V2/GenericRestController.php

src/plugins/orangehrmCorePlugin/Controller/Rest/V2/AbstractRestController.php

src/plugins/orangehrmCorePlugin/Subscriber/ApiAuthorizationSubscriber.php

src/plugins/orangehrmCorePlugin/Subscriber/ExceptionSubscriber.php

src/plugins/orangehrmPimPlugin/Service/EmployeeService.php

src/plugins/orangehrmPimPlugin/Dao/EmployeeDao.php

src/plugins/orangehrmCorePlugin/Api/V2/Exception/NotImplementedException.php

src/plugins/orangehrmCorePlugin/Api/V2/Validator/Validator.php

src/plugins/orangehrmCorePlugin/Api/V2/Validator/ParamRuleCollection.php

src/plugins/orangehrmCorePlugin/Api/V2/Validator/Rules.php

src/plugins/orangehrmCorePlugin/Api/V2/Validator/Rules/InAccessibleEmpNumbers.php

src/plugins/orangehrmCorePlugin/Api/V2/Validator/Rules/EntityUniqueProperty.php

src/plugins/orangehrmCorePlugin/Api/V2/Validator/Rules/Base64Attachment.php

src/plugins/orangehrmCorePlugin/Authorization/Service/UserRoleManagerService.php

src/plugins/orangehrmCorePlugin/Authorization/Service/DataGroupService.php (excerpt)

src/plugins/orangehrmCorePlugin/Authorization/Dao/DataGroupDao.php (excerpt)

src/plugins/orangehrmCorePlugin/Authorization/Dto/ResourcePermission.php

src/plugins/orangehrmCorePlugin/Authorization/Manager/BasicUserRoleManager.php (excerpt)

src/plugins/orangehrmCorePlugin/entity/WorkflowStateMachine.php

src/plugins/orangehrmCorePlugin/entity/DataGroupPermission.php

src/plugins/orangehrmCorePlugin/entity/DataGroup.php

src/plugins/orangehrmCorePlugin/entity/ApiPermission.php

src/plugins/orangehrmCorePlugin/entity/UserRole.php

src/plugins/orangehrmPimPlugin/entity/Employee.php

src/plugins/orangehrmPimPlugin/entity/EmpPicture.php

src/plugins/orangehrmCorePlugin/Api/V2/Serializer/AbstractEndpointResult.php

src/plugins/orangehrmCorePlugin/Api/V2/EndpointResourceResult.php

src/plugins/orangehrmCorePlugin/Api/V2/EndpointCollectionResult.php

src/plugins/orangehrmCorePlugin/Api/V2/Response.php

src/plugins/orangehrmCorePlugin/Traits/UserRoleManagerTrait.php

src/plugins/orangehrmCorePlugin/Traits/Auth/AuthUserTrait.php

Live DB queries:

DESCRIBE hs_hr_employee

DESCRIBE ohrm_workflow_state_machine

SELECT * FROM ohrm_workflow_state_machine (152 rows)

SELECT * FROM ohrm_data_group (280 rows)

SELECT * FROM ohrm_api_permission (199 rows)

SELECT * FROM ohrm_user_role_data_group (717 rows)

SELECT * FROM ohrm_user_role (7 rows)

Live HTTP trace:

GET /web/index.php/api/v2/pim/employees?limit=50&offset=0&model=detailed&includeEmployees=onlyCurrent&sortField=employee.firstName&sortOrder=ASC → 200 OK with {data, meta, rels} envelope.

End of document.
