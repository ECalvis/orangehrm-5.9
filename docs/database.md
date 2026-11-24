# OrangeHRM 5.9 Database Architecture and Data Model

**Verified against:** Running 5.9 instance (MariaDB 11.4.13-MariaDB-ubu2404, PHP 8.3.35) and a cloned 5.9 source tree.

---

## Contents

- [1. Scope](#1-scope)
- [2. What It Is](#2-what-it-is)
- [3. OrangeHRM 5.9 Behavior](#3-orangehrm-59-behavior)
- [4. Architecture](#4-architecture)
- [5. Important Concepts](#5-important-concepts)
- [6. Important Entities, Tables, and Endpoints](#6-important-entities-tables-and-endpoints)
- [7. Relationships to Other Layers](#7-relationships-to-other-layers)
- [8. Testing Implications](#8-testing-implications)
- [9. Known Quirks / Gotchas](#9-known-quirks-gotchas)
- [10. Version-Specific Notes](#10-version-specific-notes)
- [11. Facts vs Inferences vs Assumptions](#11-facts-vs-inferences-vs-assumptions)
- [12. Sources](#12-sources)

## 1. Scope

Covers the database layer of OrangeHRM 5.9 as deployed with MariaDB 11.4. Focuses on:

- Architecture, ORM, migration system
- Key entities and relationships
- Cascade behavior
- The subset of the data model relevant for QA test verification, controlled test setup, and understanding data flow from UI → API → DB

Does **not** attempt to enumerate the entire schema. Prioritizes entities and tables relevant to realistic HR workflows (employees, users, leave, time/attendance, recruitment, organization).

Every claim is traceable to a SQL query, a `SHOW CREATE TABLE` output, a file path in the cloned 5.9 source, or an `information_schema` query against the running instance.

---

## 2. What It Is

OrangeHRM 5.9 is a PHP application with a Vue.js 3 SPA frontend that stores all application state in a MySQL/MariaDB relational database. The database is the persistence layer beneath a layered application:
UI (Vue/OXD) → REST API v2 (PHP) → Service → DAO → Doctrine ORM → MariaDB

```text

```

The database is not merely a storage target; it encodes business rules, workflow states, permissions, and soft-deletion semantics that the application relies on. For QA, it is both a verification oracle and a source of controlled test data.

---

## 3. OrangeHRM 5.9 Behavior

### 3.1 ORM: Doctrine

- **Doctrine ORM version:** 2.20.7 (from `composer show doctrine/orm`)
- **Doctrine DBAL version:** 3.8.1 (from `composer show doctrine/dbal`)
- **Doctrine Annotations version:** 1.14.4 (abandoned upstream, pinned in `composer.json` line 28)
- **Metadata driver:** Docblock annotations only. `ORMSetup::createAnnotationMetadataConfiguration(...)` is called in `lib/orm/Doctrine.php:59`. A search for `#[ORM\Column]` (PHP 8 attributes) across the non-vendor codebase returned zero results.
- **No repository classes:** A search for `repositoryClass` across `src/plugins/*/entity/*.php` returned zero results.
- **No lifecycle callbacks:** Searches for `HasLifecycleCallbacks`, `@ORM\PrePersist`, `@ORM\PreUpdate` returned zero results.
- **ENUM handling:** The bootstrap registers `registerDoctrineTypeMapping('enum', 'string')`. Some columns are true ENUMs (e.g., `hs_hr_emp_dependents.ed_relationship_type = enum('child','other')`); others are varchar with application-level constants (e.g., `hs_hr_employee.emp_marital_status = varchar(20)`).
- **Custom DQL function:** `TIME_DIFF` is registered at `lib/orm/Doctrine.php:77` → `addCustomStringFunction('TIME_DIFF', TimeDiff::class)`. Implementation at `lib/orm/Functions/TimeDiff.php:27` (`class TimeDiff extends FunctionNode`).
- **Caching:**
  - Dev mode: `Symfony\Component\Cache\Adapter\ArrayAdapter`
  - Production: `OrangeHRM\Framework\Cache\FilesystemAdapter('doctrine_metadata', ...)` and `FilesystemAdapter('doctrine_queries', ...)`
- **Proxy generation:**
  - Dev mode: `AUTOGENERATE_ALWAYS`
  - Production: `AUTOGENERATE_NEVER` (proxies must be regenerated via `bin/console orm:generate-proxies`, which is wired into `composer.json` `post-autoload-dump`)
- **Connection:** PDO MySQL, `charset=utf8mb4`

### 3.2 Migration System

- **Runner location:** `installer/Util/AppSetupUtility.php` (not `src/`)
- **Registry:** `MIGRATIONS_MAP` is a public constant in `installer/Util/AppSetupUtility.php:39`, referenced at lines 479, 512, 519, 520, 526, 546, 582, 590
- **Base class:** `installer/Util/V1/AbstractMigration.php:27` → `abstract class AbstractMigration`
- **Migration classes:** One per version directory under `installer/Migration/`, from `V3_3_3` through `V5_9_0` (34 directories). Each contains `class Migration extends AbstractMigration`.
- **Baseline:** The map's first key is `'3.3.3'`, which loads raw SQL dumps from `installer/Migration/V3_3_3/dbscript-1.sql` and `dbscript-2.sql`.
- **Upgrade path:** `installer/Command/UpgradeCommand.php` iterates `array_keys(MIGRATIONS_MAP)`.
- **Migration log table:** `ohrm_migration_log` — columns: `id` (int PK AUTO_INCREMENT), `version` (varchar 10), `db_version` (varchar 255), `php_version` (varchar 255), `started_at` (datetime), `finished_at` (datetime NULL).
- **Live migration history:** 36 rows from 3.3.3 to 5.9.0, all recorded with `db_version = 10.11.19-MariaDB-ubu2204` and `php_version = 8.3.35`.

### 3.3 Version Storage

- `hs_hr_config` → key `instance.version` → value `5.9.0`
- `hs_hr_config` → key `authorize_user_role_manager_class` → value `BasicUserRoleManager`
- `hs_hr_config` → key `admin.product_type` → value `os`
- `hs_hr_config` → key `authentication.status` → value `Enable`

### 3.4 Product Mode

- `Config::PRODUCT_MODE` is a PHP constant defined in `src/lib/config/Config.php:57`
- It is **not** stored in `hs_hr_config`
- It is compared against `Config::MODE_PROD` and `Config::MODE_DEMO` throughout the codebase
- Consumers: `DataRegistrationService`, `UserService`, `VueControllerHelper`, `EmployeeService`, `CorePluginConfiguration`, `EnableTOTPCommand`, functional test `prepare.php`/`teardown.php`
- **Not verified in this round:** the actual runtime value of `PRODUCT_MODE` in this instance. The build workflow (`.github/workflows/build.yml`) sets it via `sed` during packaging; the default source value was not inspected.

### 3.5 Transaction Isolation

- `@@transaction_isolation = REPEATABLE-READ` (MariaDB default)
- All 150+ tables are InnoDB — FK enforcement is active and transactions are ACID-compliant.

---

## 4. Architecture

### 4.1 Doctrine Bootstrap

`lib/orm/Doctrine.php` is the single entry point:

- Singleton `Doctrine` class with static `$instance` and `$entityManager`
- `Doctrine::getEntityManager()` returns the shared `EntityManager`
- Entity paths are collected from `Config::get('ohrm_plugin_paths')` — each plugin contributes its `/entity` subdirectory
- Cache, proxy, and DQL-function configuration as described in §3.1
- Connection parameters come from `Config::getConf()` (DB name, user, password, host, port)

### 4.2 Entity Autoloading

`composer.json` maps `OrangeHRM\Entity\` PSR-4 to the union of 18 plugin `entity/` directories. Entities are not namespaced per-plugin at the PHP level — they all live under `OrangeHRM\Entity\`.

### 4.3 The UI → API → Service → ORM → DB Boundary

| Layer              | Responsibility                                            | Example                                       |
| ------------------ | --------------------------------------------------------- | --------------------------------------------- |
| UI (Vue/OXD 2.0.3) | Renders and sends HTTP                                    | `GET /web/index.php/api/v2/pim/employees?...` |
| API Endpoint       | Validates params, applies permissions, calls service      | `OrangeHRM\Pim\Api\EmployeeAPI`               |
| Service            | Orchestrates business logic, may coordinate multiple DAOs | `EmployeeService`                             |
| DAO                | Uses `EntityManager` for queries/persists                 | `EmployeeDao`                                 |
| Entity             | Doctrine-mapped PHP class                                 | `Employee.php`                                |
| DB                 | InnoDB tables                                             | `hs_hr_employee`                              |

**Direct DB testing is appropriate when:**

- Confirming that an API operation persisted the expected state
- Checking audit/history or workflow tables not exposed via API
- Preparing controlled fixtures that are tedious to create via UI/API
- Debugging unexpected application behavior

**Direct DB testing creates unnecessary coupling when:**

- Asserting on internal column values already exposed via API
- Bypassing business logic to create states the application would not naturally produce
- Testing every UI action by querying the DB for its side effect instead of verifying user-visible behavior

---

## 5. Important Concepts

### 5.1 Nested Set (MPTT) for Organization Structure

`ohrm_subunit` uses the NestedSet pattern:
id, name, unit_id, description, lft, rgt, level

```text

```

Live data confirms the pattern:

| id  | name        | lft | rgt | level |
| --- | ----------- | --- | --- | ----- |
| 1   | ECalvis     | 1   | 4   | 0     |
| 2   | United Orgy | 2   | 3   | 1     |

`level` is used instead of the `depth` column name referenced in earlier secondary sources. QA should **not** manually manipulate `lft`/`rgt`/`level` — use the application's NestedSet helper (`lib/orm/NestedSet/`) or the Admin UI.

### 5.2 Workflow State Machine

`ohrm_workflow_state_machine` is a DB table that gates every stateful transition:
id, workflow, state, role, action, resulting_state, roles_to_notify, priority

```text

```

- `workflow` stores the flow ID as a string (`'0'`–`'7'`)
- `action` stores integer IDs as strings for most flows, but action names for Leave (`workflow 4`)
- `roles_to_notify` is a comma-separated role list (used by Leave and Claim)
- `priority` is an integer (all observed rows are 0)

**Live row count:** 138 rows.

### 5.3 Soft-Deletion Patterns

Three inconsistent patterns coexist:

1. **`deleted` (tinyint)** — `ohrm_leave_type`, `ohrm_leave_entitlement`, `ohrm_user`
2. **`is_deleted` (tinyint or smallint)** — `ohrm_job_title`, `ohrm_project`, `ohrm_project_activity`, `ohrm_customer`, `ohrm_claim_event`, `ohrm_claim_request`, `ohrm_expense`, `ohrm_expense_type`
3. **`purged_at` / `deleted_at` (datetime)** — `hs_hr_employee.purged_at`, `ohrm_kpi.deleted_at`

There is no single convention. QA must inspect each table individually.

### 5.4 Legacy ID Generator

`hs_hr_unique_id` tracks the last-used ID per `(table, field)`:

| id  | last_id | table_name       | field_name   |
| --- | ------- | ---------------- | ------------ |
| 1   | 4       | `hs_hr_employee` | `emp_number` |

This means the next employee created will receive `emp_number = 5`, **not** `max(emp_number) + 1`. Do not assume auto-increment continuity for `hs_hr_employee` even though the column has `AUTO_INCREMENT`.

### 5.5 Legacy vs Modern Table Prefixes

- `hs_hr_*` — legacy 4.x tables (`hs_hr_employee`, `hs_hr_config`, `hs_hr_emp_*`, `hs_hr_country`, `hs_hr_currency_type`, `hs_hr_payperiod`, `hs_hr_province`, `hs_hr_unique_id`, etc.)
- `ohrm_*` — newer tables introduced in 5.x (`ohrm_leave*`, `ohrm_user`, `ohrm_oauth2_*`, `ohrm_workflow_state_machine`, `ohrm_data_group`, etc.)

### 5.6 Two OAuth Table Sets

- **Active:** `ohrm_oauth2_client`, `ohrm_oauth2_access_token`, `ohrm_oauth2_authorization_code`, `ohrm_oauth2_refresh_token` — used by `league/oauth2-server ~8.4.2` via `plugins/orangehrmCoreOAuthPlugin`
- **Legacy (dead):** `ohrm_oauth_client`, `ohrm_oauth_access_token`, `ohrm_oauth_authorization_code`, `ohrm_oauth_refresh_token`, `ohrm_oauth_scope`, `ohrm_oauth_user` — a search for these table names across the entire non-vendor codebase returned zero matches. They are orphaned in the schema.

---

## 6. Important Entities, Tables, and Endpoints

### 6.1 Employee

| Property | Value                                                                              |
| -------- | ---------------------------------------------------------------------------------- |
| Table    | `hs_hr_employee`                                                                   |
| Entity   | `OrangeHRM\Pim\entity\Employee` (`plugins/orangehrmPimPlugin/entity/Employee.php`) |
| PK       | `emp_number int(11) AUTO_INCREMENT`                                                |
| Columns  | 47 (verified via `DESCRIBE`)                                                       |
| Engine   | InnoDB                                                                             |
| Purpose  | Core employee record                                                               |

**Key fields:**

- `emp_number`, `employee_id varchar(50) NULL`, `emp_lastname varchar(100) NOT NULL DEFAULT ''`, `emp_firstname varchar(100) NOT NULL DEFAULT ''`, `emp_middle_name varchar(100) NOT NULL DEFAULT ''`, `emp_work_email varchar(50) NULL`, `emp_marital_status varchar(20) NULL`, `emp_birthday date NULL`, `joined_date date NULL`, `termination_id int(4) NULL`, `purged_at datetime NULL`, `custom1`–`custom10 varchar(250) NULL`, `sal_grd_code varchar(13) NULL` (deprecated)

**Foreign keys (all `ON DELETE SET NULL`, `ON UPDATE RESTRICT`):**

| Column           | References                  |
| ---------------- | --------------------------- |
| `work_station`   | `ohrm_subunit.id`           |
| `nation_code`    | `ohrm_nationality.id`       |
| `job_title_code` | `ohrm_job_title.id`         |
| `emp_status`     | `ohrm_employment_status.id` |
| `eeo_cat_code`   | `ohrm_job_category.id`      |
| `termination_id` | `ohrm_emp_termination.id`   |

- **API resource:** `/api/v2/pim/employees` (class `OrangeHRM\Pim\Api\EmployeeAPI`, data_group_id 96)
- **UI feature:** PIM → Employee List / Add Employee / My Info
- **QA relevance:** Primary fixture for most workflows. `purged_at` is the GDPR purge marker (`NULL` = not purged).

### 6.2 User

| Property | Value                       |
| -------- | --------------------------- |
| Table    | `ohrm_user`                 |
| PK       | `id int(10) AUTO_INCREMENT` |
| Purpose  | System user account         |

**Key fields:** `id`, `user_role_id int(10) NOT NULL`, `emp_number int(13) NULL`, `user_name varchar(40) NULL`, `user_password varchar(255) NULL`, `deleted tinyint(1) NOT NULL DEFAULT 0`, `status tinyint(1) NOT NULL DEFAULT 1`, `date_entered`, `date_modified`, `modified_user_id`, `created_by`

**Foreign keys:**

- `emp_number` → `hs_hr_employee.emp_number` `ON DELETE CASCADE`
- `user_role_id` → `ohrm_user_role.id` `ON DELETE RESTRICT`

**Semantics:**

- `status`: 1 = Enabled, 0 = Disabled
- `deleted`: 1 = soft-deleted
- `user_password`: varchar(255) — bcrypt/argon2 hash (not plaintext)
- `emp_number` is nullable — a user can exist without an employee link
- `user_role_id` is NOT NULL — every user must have a role

- **Live row count:** 2 (enabled Admin and ESS accounts, linked to employee numbers 1 and 2)
- **API resource:** `/api/v2/admin/users` (class `OrangeHRM\Admin\Api\UserAPI`, data_group_id 81)
- **UI feature:** Admin → User Management
- **QA relevance:** Login credentials; role assignment; tied to employee deletion.

### 6.3 UserRole

| Property   | Value                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Table      | `ohrm_user_role`                                                                                                                          |
| PK         | `id int(10) AUTO_INCREMENT`                                                                                                               |
| Key fields | `id`, `name varchar(255) UNIQUE`, `display_name varchar(255)`, `is_assignable tinyint(1) DEFAULT 0`, `is_predefined tinyint(1) DEFAULT 0` |

**Live rows (7):**

| id  | name          | display_name  | is_assignable | is_predefined |
| --- | ------------- | ------------- | ------------- | ------------- |
| 1   | Admin         | Admin         | 1             | 1             |
| 2   | ESS           | ESS           | 1             | 1             |
| 3   | Supervisor    | Supervisor    | 0             | 1             |
| 4   | ProjectAdmin  | ProjectAdmin  | 0             | 1             |
| 5   | Interviewer   | Interviewer   | 0             | 1             |
| 6   | HiringManager | HiringManager | 0             | 1             |
| 7   | Reviewer      | Reviewer      | 0             | 1             |

Only Admin and ESS are assignable. The other five are derived roles computed at runtime.

**QA relevance:** Determines the permission matrix; must not be modified by tests.

### 6.4 DataGroup and UserRoleDataGroup

| Property       | Value                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------- |
| Table          | `ohrm_data_group`                                                                        |
| Live row count | 280                                                                                      |
| Key fields     | `id`, `name UNIQUE`, `description`, `can_read`, `can_create`, `can_update`, `can_delete` |

**Key rows:**

| id  | name                        | can_read | can_create | can_update | can_delete |
| --- | --------------------------- | -------- | ---------- | ---------- | ---------- |
| 96  | `apiv2_pim_employee`        | 1        | 1          | 0          | 1          |
| 81  | `apiv2_admin_user`          | 1        | 1          | 1          | 1          |
| 128 | `apiv2_pim_update_password` | 0        | 0          | 1          | 0          |
| 130 | `apiv2_leave_holiday`       | 1        | 1          | 1          | 1          |
| 139 | `apiv2_leave_leave_balance` | 1        | 0          | 0          | 0          |

| Property       | Value                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Table          | `ohrm_user_role_data_group`                                                                         |
| Live row count | 673 (earlier Architecture doc said 717 — actual count is 673)                                       |
| Key fields     | `id`, `user_role_id`, `data_group_id`, `can_read`, `can_create`, `can_update`, `can_delete`, `self` |

**Semantics:** For a given `(user_role_id, data_group_id)`, the four flags plus `self` determine effective permissions. The `self` flag scopes access to the logged-in user's own records.

**Example for `data_group_id = 96` (`apiv2_pim_employee`):**

- Admin (role 1): read=1, create=1, update=0, delete=1, self=0
- ESS (role 2): read=1, create=0, update=0, delete=0, self=1
- Supervisor (role 3): two rows — one with self=0, one with self=1

**QA relevance:** The source of truth for API authorization. Never modify directly in tests.

### 6.5 ApiPermission

| Property       | Value                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Table          | `ohrm_api_permission`                                                                                        |
| Live row count | 191                                                                                                          |
| Key fields     | `id`, `module_id` → `ohrm_module.id`, `data_group_id` → `ohrm_data_group.id`, `api_name varchar(255) UNIQUE` |

**Maps each API endpoint class to a data group. Examples:**

| api_name                                         | data_group_id |
| ------------------------------------------------ | ------------- |
| `OrangeHRM\Pim\Api\EmployeeAPI`                  | 96            |
| `OrangeHRM\Admin\Api\UserAPI`                    | 81            |
| `OrangeHRM\Leave\Api\LeaveEntitlementAPI`        | 138           |
| `OrangeHRM\Time\Api\MyTimesheetAPI`              | 162           |
| `OrangeHRM\Attendance\Api\MyAttendanceRecordAPI` | 179           |
| `OrangeHRM\Recruitment\Api\CandidateAPI`         | 210           |
| `OrangeHRM\Claim\Api\ClaimEventAPI`              | 265           |
| `OrangeHRM\OAuth\Api\OAuthClientAPI`             | 83            |

### 6.6 WorkflowStateMachine

| Property       | Value                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table          | `ohrm_workflow_state_machine`                                                                                                                                                                             |
| Live row count | 138                                                                                                                                                                                                       |
| Key fields     | `id bigint PK`, `workflow varchar(255)`, `state varchar(255)`, `role varchar(255)`, `action varchar(255)`, `resulting_state varchar(255)`, `roles_to_notify text NULL`, `priority int NOT NULL DEFAULT 0` |

**Distribution by workflow:**

| Workflow    | ID  | Rows | Action encoding      |
| ----------- | --- | ---- | -------------------- |
| Timesheet   | 0   | 32   | Integer ID as string |
| Attendance  | 1   | 15   | Integer ID as string |
| Recruitment | 2   | 33   | Integer ID as string |
| Employee    | 3   | 5    | Integer ID as string |
| Leave       | 4   | 21   | Action names         |
| Review      | 5   | 12   | Integer ID as string |
| Self Review | 6   | 8    | Integer ID as string |
| Claim       | 7   | 12   | Integer ID as string |

**Employee flow (workflow 3) — complete:**

| state      | role  | action | resulting_state |
| ---------- | ----- | ------ | --------------- |
| NOT_EXIST  | ADMIN | 1      | ACTIVE          |
| ACTIVE     | ADMIN | 2      | NOT_EXIST       |
| ACTIVE     | ADMIN | 3      | TERMINATED      |
| TERMINATED | ADMIN | 4      | ACTIVE          |
| TERMINATED | ADMIN | 5      | NOT_EXIST       |

**Leave flow (workflow 4) — state names:**

INITIAL, PENDING APPROVAL, SCHEDULED, TAKEN, CANCELLED, REJECTED, LEAVE TYPE DELETED PENDING APPROVAL, LEAVE TYPE DELETED SCHEDULED, LEAVE TYPE DELETED TAKEN

**Actions:** APPLY, ASSIGN, APPROVE, CANCEL, REJECT

**Recruitment flow (workflow 2) — states:**

INITIAL, APPLICATION INITIATED, SHORTLISTED, INTERVIEW SCHEDULED, INTERVIEW PASSED, INTERVIEW FAILED, JOB OFFERED, OFFER DECLINED, HIRED, REJECTED

**Claim flow (workflow 7) — states:**

INITIATED, SUBMITTED, APPROVED, REJECTED, CANCELLED, PAID

**Timesheet flow (workflow 0) — states:**

INITIAL, NOT SUBMITTED, SUBMITTED, APPROVED, REJECTED

**Attendance flow (workflow 1) — states:**

INITIAL, PUNCHED IN, PUNCHED OUT, N/A

**Review (workflow 5):** INITIAL, SAVED, ACTIVATED, IN PROGRESS, COMPLETED

**Self Review (workflow 6):** INITIAL, SELF IN PROGRESS, SELF COMPLETED, SUPERVISOR UPDATED

**Role naming inconsistency:** Leave uses `ESS` while other workflows use `ESS USER`.

### 6.7 Leave

| Property | Value                       |
| -------- | --------------------------- |
| Table    | `ohrm_leave`                |
| PK       | `id int(11) AUTO_INCREMENT` |
| Purpose  | Individual leave day        |

**Key fields:** `id`, `date date NULL`, `length_hours decimal(6,2) unsigned NULL`, `length_days decimal(6,4) unsigned NULL`, `status smallint NULL`, `leave_request_id int(10) unsigned NOT NULL`, `leave_type_id int(10) unsigned NOT NULL`, `emp_number int(7) NOT NULL`, `start_time time NULL`, `end_time time NULL`, `duration_type tinyint NOT NULL DEFAULT 0`

**Foreign keys:**

- `leave_request_id` → `ohrm_leave_request.id` `ON DELETE CASCADE`
- `leave_type_id` → `ohrm_leave_type.id` `ON DELETE CASCADE`

**Status codes (from `ohrm_leave_status`):**

| status | name             |
| ------ | ---------------- |
| -1     | REJECTED         |
| 0      | CANCELLED        |
| 1      | PENDING APPROVAL |
| 2      | SCHEDULED        |
| 3      | TAKEN            |
| 4      | WEEKEND          |
| 5      | HOLIDAY          |

**Live data (6 rows):** All `emp_number = 1` or `4` or `5`, all `leave_type_id = 1`, statuses 1 (PENDING APPROVAL) and 2 (SCHEDULED). Weekend days have `length_hours = 0.00`, `length_days = 0.0000`, `status = 4`.

| Property   | Value                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Table      | `ohrm_leave_request`                                                                                                       |
| PK         | `id int(10) unsigned AUTO_INCREMENT`                                                                                       |
| Key fields | `id`, `leave_type_id`, `date_applied date NOT NULL`, `emp_number int(7) NOT NULL`                                          |
| FKs        | `emp_number` → `hs_hr_employee.emp_number` `ON DELETE CASCADE`; `leave_type_id` → `ohrm_leave_type.id` `ON DELETE CASCADE` |
| Live rows  | 3 (ids 3, 4, 5)                                                                                                            |

| Property   | Value                                                                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table      | `ohrm_leave_entitlement`                                                                                                                                                                                                                                   |
| PK         | `id int(10) unsigned AUTO_INCREMENT`                                                                                                                                                                                                                       |
| Key fields | `id`, `emp_number`, `no_of_days decimal(19,15) NOT NULL`, `days_used decimal(8,4) NOT NULL DEFAULT 0.0000`, `leave_type_id`, `from_date`, `to_date`, `credited_date`, `note`, `entitlement_type`, `deleted tinyint(1) NOT NULL DEFAULT 0`, `created_by_id` |
| FKs        | `leave_type_id`, `emp_number`, `entitlement_type`, `created_by_id` — all `ON DELETE CASCADE` (except `created_by_id` → `SET NULL`)                                                                                                                         |

| Property    | Value                                                                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table       | `ohrm_leave_type`                                                                                                                                                                       |
| PK          | `id int(10) unsigned AUTO_INCREMENT`                                                                                                                                                    |
| Key fields  | `id`, `name varchar(50)`, `deleted tinyint(1) NOT NULL DEFAULT 0`, `exclude_in_reports_if_no_entitlement tinyint(1) NOT NULL DEFAULT 0`, `operational_country_id int(10) unsigned NULL` |
| Soft delete | `deleted` flag                                                                                                                                                                          |

| Property   | Value                                                          |
| ---------- | -------------------------------------------------------------- |
| Table      | `ohrm_leave_status`                                            |
| PK         | `id int(11) AUTO_INCREMENT`                                    |
| Key fields | `id`, `status smallint NOT NULL`, `name varchar(100) NOT NULL` |
| Live rows  | 7 (see status codes above)                                     |

**API resources:** `/api/v2/leave/leave-requests`, `/api/v2/leave/leave-types`, `/api/v2/leave/leave-entitlements`, `/api/v2/leave/leave-balance`

**UI feature:** Leave module

**QA relevance:** Balance arithmetic (`ohrm_leave_entitlement.no_of_days` vs `days_used`), status transitions gated by workflow 4, weekend rows with status 4.

### 6.8 Timesheet

| Property               | Value                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Table                  | `ohrm_timesheet`                                                                                                          |
| PK                     | `timesheet_id bigint AUTO_INCREMENT`                                                                                      |
| Key fields             | `timesheet_id`, `state varchar(255)`, `start_date date NOT NULL`, `end_date date NOT NULL`, `employee_id bigint NOT NULL` |
| No FK on `employee_id` | Timesheet rows are orphaned when an employee is deleted.                                                                  |

| Property   | Value                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Table      | `ohrm_timesheet_item`                                                                                                 |
| PK         | `timesheet_item_id bigint AUTO_INCREMENT`                                                                             |
| Key fields | `timesheet_item_id`, `timesheet_id`, `date`, `duration bigint`, `comment`, `project_id`, `employee_id`, `activity_id` |
| FK         | `activity_id` → `ohrm_project_activity.activity_id`; no FK on `employee_id`                                           |

| Property   | Value                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------- |
| Table      | `ohrm_timesheet_action_log`                                                                 |
| PK         | `timesheet_action_log_id bigint AUTO_INCREMENT`                                             |
| Key fields | `timesheet_action_log_id`, `comment`, `action`, `date_time`, `performed_by`, `timesheet_id` |
| FKs        | `performed_by` → `ohrm_user.id` `SET NULL`; `timesheet_id` → `ohrm_timesheet.timesheet_id`  |

**Live data:** 2 rows — employee 1 `NOT SUBMITTED`, employee 3 `SUBMITTED` (both 2026-09-28 to 2026-10-04).

**API resources:** `/api/v2/time/my-timesheets`, `/api/v2/time/employees/timesheets`

**UI feature:** Time → Timesheets

**QA relevance:** No cascade — cleanup must be explicit. State strings come from `ohrm_workflow_state_machine` workflow 0.

### 6.9 Attendance

| Property               | Value                                                                                                                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table                  | `ohrm_attendance_record`                                                                                                                                                                                                                                                                            |
| PK                     | `id bigint AUTO_INCREMENT`                                                                                                                                                                                                                                                                          |
| Key fields             | `id`, `employee_id bigint NOT NULL`, `punch_in_utc_time`, `punch_in_note`, `punch_in_time_offset`, `punch_in_user_time`, `punch_out_utc_time`, `punch_out_note`, `punch_out_time_offset`, `punch_out_user_time`, `state varchar(255) NOT NULL`, `punch_in_timezone_name`, `punch_out_timezone_name` |
| No FK on `employee_id` | Attendance rows are orphaned on employee delete.                                                                                                                                                                                                                                                    |

**State values:** `PUNCHED IN`, `PUNCHED OUT`

**Live data:** 2 rows (employee 1 `PUNCHED IN`, employee 3 `PUNCHED OUT`, both timezone `Asia/Manila`).

**API resources:** `/api/v2/attendance/records`, `/api/v2/attendance/employees/{empNumber}/records`

**UI feature:** Time → Attendance

**QA relevance:** Timezone-aware UTC vs user times; no cascade.

### 6.10 Recruitment

| Property   | Value                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table      | `ohrm_job_candidate`                                                                                                                                                                                                                                                                                                                                                   |
| PK         | `id int(11) AUTO_INCREMENT`                                                                                                                                                                                                                                                                                                                                            |
| Key fields | `id`, `first_name varchar(30)`, `middle_name varchar(30) NULL`, `last_name varchar(30)`, `email varchar(100)`, `contact_number varchar(30) NULL`, `status int(4)`, `comment`, `mode_of_application int(4)`, `date_of_application date`, `cv_file_id`, `cv_text_version`, `keywords`, `added_person int(13) NULL`, `consent_to_keep_data tinyint(1) NOT NULL DEFAULT 0` |
| FK         | `added_person` → `hs_hr_employee.emp_number` `ON DELETE SET NULL`                                                                                                                                                                                                                                                                                                      |
| Live rows  | 7 (ids 1–7)                                                                                                                                                                                                                                                                                                                                                            |

| Property   | Value                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Table      | `ohrm_job_candidate_vacancy`                                                                   |
| PK         | Composite `(candidate_id, vacancy_id)` with a separate UNIQUE `id`                             |
| Key fields | `id`, `candidate_id`, `vacancy_id`, `status varchar(100)`, `applied_date date`                 |
| FKs        | `candidate_id` → `ohrm_job_candidate.id` CASCADE; `vacancy_id` → `ohrm_job_vacancy.id` CASCADE |
| Live rows  | 0 at time of first check; not re-queried after candidate creation                              |

| Property   | Value                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table      | `ohrm_job_vacancy`                                                                                                                                                                                                                                |
| PK         | `id int(11) AUTO_INCREMENT`                                                                                                                                                                                                                       |
| Key fields | `id`, `job_title_code int(4)`, `hiring_manager_id int(13) NULL`, `name varchar(100)`, `description`, `no_of_positions`, `status tinyint(1) NOT NULL DEFAULT 1`, `published_in_feed tinyint(1) NOT NULL DEFAULT 0`, `defined_time`, `updated_time` |
| FKs        | `job_title_code` → `ohrm_job_title.id` CASCADE; `hiring_manager_id` → `hs_hr_employee.emp_number` SET NULL                                                                                                                                        |

| Property   | Value                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table      | `ohrm_job_candidate_history`                                                                                                                                                    |
| PK         | `id int(13) AUTO_INCREMENT`                                                                                                                                                     |
| Key fields | `id`, `candidate_id`, `vacancy_id NULL`, `candidate_vacancy_name`, `interview_id NULL`, `action int(4)`, `performed_by NULL`, `performed_date datetime`, `note`, `interviewers` |
| FKs        | `candidate_id` CASCADE; `vacancy_id` SET NULL; `interview_id` SET NULL; `performed_by` SET NULL                                                                                 |

| Property   | Value                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table      | `ohrm_job_interview`                                                                                                                                  |
| PK         | `id int(13) AUTO_INCREMENT`                                                                                                                           |
| Key fields | `id`, `candidate_vacancy_id NULL`, `candidate_id NULL`, `interview_name varchar(100)`, `interview_date date NULL`, `interview_time time NULL`, `note` |
| FKs        | `candidate_vacancy_id` → `ohrm_job_candidate_vacancy.id` SET NULL; `candidate_id` → `ohrm_job_candidate.id` CASCADE                                   |

| Property | Value                                                                          |
| -------- | ------------------------------------------------------------------------------ |
| Table    | `ohrm_job_interview_interviewer`                                               |
| PK       | Composite `(interview_id, interviewer_id)`                                     |
| FKs      | `interview_id` CASCADE; `interviewer_id` → `hs_hr_employee.emp_number` CASCADE |

**API resources:** `/api/v2/recruitment/vacancies`, `/api/v2/recruitment/candidates`, `/api/v2/recruitment/candidates/{id}/history`, etc.

**UI feature:** Recruitment module

**QA relevance:** Candidate status is workflow-driven (workflow 2). Note that `ohrm_job_candidate.status` (int) and `ohrm_job_candidate_vacancy.status` (varchar) are different fields with different semantics.

### 6.11 Organization / Configuration

| Table                        | PK                       | Purpose             | Live state                                |
| ---------------------------- | ------------------------ | ------------------- | ----------------------------------------- |
| `ohrm_subunit`               | `id int(6)`              | NestedSet org tree  | 2 rows (`ECalvis` 1–4, `United Orgy` 2–3) |
| `ohrm_job_title`             | `id int(13)`             | Job titles          | 1 row; `is_deleted` soft delete           |
| `ohrm_location`              | `id int(11)`             | Office locations    | 1 row; FK to `hs_hr_country.cou_code`     |
| `ohrm_nationality`           | `id int(6)`              | Nationalities       | 193 rows (seeded)                         |
| `hs_hr_country`              | `cou_code char(2)`       | ISO countries       | 81 rows                                   |
| `hs_hr_currency_type`        | `currency_id varchar(3)` | Currencies          | 159 rows                                  |
| `ohrm_employment_status`     | `id int(11)`             | Employment statuses | 2 rows                                    |
| `hs_hr_config`               | `name varchar(100)`      | Key/value settings  | 46 rows                                   |
| `ohrm_organization_gen_info` | `id int(4)`              | Company info        | 1 row (`name=ECalvis`, `country=PH`)      |
| `ohrm_work_week`             | `id int(10) unsigned`    | Weekly hours config | 1 row (Sat=8, Sun=8, weekdays=0)          |
| `ohrm_theme`                 | `theme_id int(11)`       | Branding            | 1 row (default theme)                     |

**`hs_hr_config` notable keys:**

- `instance.version = 5.9.0`
- `authorize_user_role_manager_class = BasicUserRoleManager`
- `admin.product_type = os`
- `authentication.status = Enable`
- `oauth.access_token_ttl = PT30M`
- `oauth.auth_code_ttl = PT5M`
- `oauth.refresh_token_ttl = P1M`
- `oauth.encryption_key` and `oauth.token_encryption_key` (base64 secrets)
- `leave.entitlement_consumption_algorithm = FIFOEntitlementConsumptionStrategy`
- `leave.include_pending_leave_in_balance = 1`
- `pim_show_deprecated_fields = 1`
- `workspace.notifications.enabled = 0`

**Note:** `ohrm_work_week` has only one row (`id=1`, no `operational_country_id`). Sat/Sun = 8 hours, weekdays = 0. This is the default configured during installation; it can be changed via Leave → Configure → Work Week.

### 6.12 OAuth2

| Table                            | PK          | Key fields                                                                                                           | FKs                                                              |
| -------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ohrm_oauth2_client`             | `id bigint` | `name`, `client_id UNIQUE`, `client_secret NULL`, `redirect_uri`, `is_confidential tinyint(1)`, `enabled tinyint(1)` | —                                                                |
| `ohrm_oauth2_access_token`       | `id bigint` | `access_token UNIQUE`, `client_id bigint`, `user_id int`, `expiry_date_time_utc datetime`, `revoked tinyint(1)`      | `client_id` → `ohrm_oauth2_client.id` CASCADE                    |
| `ohrm_oauth2_authorization_code` | `id bigint` | `authorization_code UNIQUE`, `client_id`, `user_id`, `redirect_uri`, `expiry_date_time_utc`, `revoked`               | `client_id` → CASCADE                                            |
| `ohrm_oauth2_refresh_token`      | `id bigint` | `refresh_token UNIQUE`, `access_token`, `expiry_date_time_utc`, `revoked`                                            | `access_token` → `ohrm_oauth2_access_token.access_token` CASCADE |

**Live counts:** client=2, access_token=9, authorization_code=8, refresh_token=9.

**API resource:** `/api/v2/admin/oauth-clients` (class `OrangeHRM\OAuth\Api\OAuthClientAPI`, data_group_id 83)

**UI feature:** Admin → Register OAuth Client

**Server:** `league/oauth2-server ~8.4.2`

**TTLs:** access=30 min, auth code=5 min, refresh=1 month (from `hs_hr_config`)

### 6.13 Legacy OAuth (Dead)

Six tables exist but are unreferenced by application code:

`ohrm_oauth_client`, `ohrm_oauth_access_token`, `ohrm_oauth_authorization_code`, `ohrm_oauth_refresh_token`, `ohrm_oauth_scope`, `ohrm_oauth_user`

A `Select-String` for `ohrm_oauth_client|ohrm_oauth_access_token|...` across all non-vendor files returned zero matches. QA should not touch these tables.

### 6.14 Login Audit

| Table        | PK           | Key fields                                                                                                                                                                          |
| ------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ohrm_login` | `id int(11)` | `id`, `user_id bigint`, `user_name varchar(255) NULL`, `user_role_name text NOT NULL`, `user_role_predefined tinyint(1) NOT NULL`, `login_time timestamp DEFAULT CURRENT_TIMESTAMP` |

**Live rows:** 21. No FK to `ohrm_user` — `user_id` is a loose reference.

### 6.15 Soft-Delete Inventory (Complete)

| Table                    | Column       | Type                 | Default |
| ------------------------ | ------------ | -------------------- | ------- |
| `hs_hr_employee`         | `purged_at`  | datetime NULL        | NULL    |
| `ohrm_claim_event`       | `is_deleted` | tinyint(1) NOT NULL  | 0       |
| `ohrm_claim_request`     | `is_deleted` | smallint(6) NOT NULL | (none)  |
| `ohrm_customer`          | `is_deleted` | tinyint(1) NULL      | 0       |
| `ohrm_expense`           | `is_deleted` | tinyint(1) NOT NULL  | 0       |
| `ohrm_expense_type`      | `is_deleted` | tinyint(1) NOT NULL  | 0       |
| `ohrm_job_title`         | `is_deleted` | tinyint(1) NULL      | 0       |
| `ohrm_kpi`               | `deleted_at` | datetime NULL        | NULL    |
| `ohrm_leave_entitlement` | `deleted`    | tinyint(1) NOT NULL  | 0       |
| `ohrm_leave_type`        | `deleted`    | tinyint(1) NOT NULL  | 0       |
| `ohrm_project`           | `is_deleted` | tinyint(1) NULL      | 0       |
| `ohrm_project_activity`  | `is_deleted` | tinyint(1) NULL      | 0       |
| `ohrm_user`              | `deleted`    | tinyint(1) NOT NULL  | 0       |

Three naming conventions, no consistency. Tests must inspect each table individually.

---

## 7. Relationships to Other Layers

### 7.1 Full Cascade Map on Employee Delete

All FKs referencing `hs_hr_employee.emp_number`, with `DELETE_RULE`:

**ON DELETE CASCADE (rows are removed with the employee):**

`hs_hr_emp_attachment`, `hs_hr_emp_basicsalary`, `hs_hr_emp_children`, `hs_hr_emp_contract_extend`, `hs_hr_emp_dependents`, `hs_hr_emp_directdebit` (via basicsalary), `hs_hr_emp_emergency_contacts`, `hs_hr_emp_history_of_ealier_pos`, `hs_hr_emp_language`, `hs_hr_emp_locations`, `hs_hr_emp_passport`, `hs_hr_emp_picture`, `hs_hr_emp_reportto` (both sup and sub), `hs_hr_emp_skill`, `hs_hr_emp_us_tax`, `hs_hr_emp_work_experience`, `ohrm_emp_termination`, `ohrm_user`, `ohrm_leave_request`, `ohrm_leave_entitlement`, `ohrm_leave_comment`, `ohrm_leave_request_comment`, `ohrm_emp_education`, `ohrm_emp_license`, `ohrm_employee_work_shift`, `ohrm_project_admin`, `ohrm_performance_review`, `ohrm_performance_track` (both `emp_number` and `added_by`), `ohrm_performance_tracker_log` (via track), `ohrm_performance_tracker_reviewer` (via track), `ohrm_job_interview_interviewer`, `ohrm_buzz_post`, `ohrm_buzz_share`, `ohrm_buzz_comment`, `ohrm_buzz_like_on_share`, `ohrm_buzz_like_on_comment`, `ohrm_buzz_notification_metadata`, `ohrm_claim_attachment`, `ohrm_i18n_import_error`

**Chained cascades:** deleting `ohrm_leave_request` cascades to `ohrm_leave` (via `leave_request_id`), which cascades to `ohrm_leave_comment` and `ohrm_leave_leave_entitlement`. Deleting `hs_hr_emp_basicsalary` cascades to `hs_hr_emp_directdebit`.

**ON DELETE SET NULL (rows survive, FK is nulled):**

`ohrm_job_candidate.added_person`, `ohrm_job_candidate_history.performed_by`, `ohrm_job_vacancy.hiring_manager_id`, `ohrm_claim_request.emp_number`, `ohrm_claim_request.added_by` (→ `ohrm_user`)

**NO FOREIGN KEY (rows orphaned):**

- `ohrm_timesheet.employee_id bigint NOT NULL` — orphaned
- `ohrm_timesheet_item.employee_id bigint NOT NULL` — orphaned
- `ohrm_attendance_record.employee_id bigint NOT NULL` — orphaned
- `ohrm_rest_api_usage.user_id varchar` — no constraint
- `ohrm_login.user_id bigint` — no constraint

This is the definitive cascade map. QA must not assume employee deletion cleans up all dependent data.

### 7.2 Full FK Inventory

The complete FK map (referencing table → referenced table, `DELETE_RULE`) is captured in §6 for the relevant tables and §7.1 for employee-related cascades. The full 150+ FK list was extracted via `information_schema.REFERENTIAL_CONSTRAINTS` and `information_schema.KEY_COLUMN_USAGE`.

### 7.3 API → Data Group Mapping

Every API endpoint class maps to a `data_group_id` via `ohrm_api_permission`. The data group's flags (`can_read`/`can_create`/`can_update`/`can_delete`) plus the per-role rows in `ohrm_user_role_data_group` determine endpoint-level authorization.

---

## 8. Testing Implications

### 8.1 Where DB Verification Is Appropriate

- **Confirm API persistence:** After `POST /api/v2/pim/employees`, query `hs_hr_employee` to confirm `emp_number`, names, custom fields.
- **Verify soft deletion:** When a LeaveType is "deleted" via API, confirm `ohrm_leave_type.deleted = 1` rather than the row being removed.
- **Check workflow state:** After an approve action, verify `ohrm_leave.status` in both API response and DB.
- **Validate balance arithmetic:** After leave approval, check `ohrm_leave_entitlement.no_of_days` and `days_used`.
- **Debugging:** Inspect DB when API behavior is unexpected.

### 8.2 Where Direct DB Testing Creates Coupling

- Asserting on internal column values already exposed via API responses.
- Manually inserting rows into workflow-heavy tables without going through the state machine.
- Modifying `lft`/`rgt`/`level` in `ohrm_subunit` without the NestedSet helper.
- Assuming every column is mapped to an entity — some legacy columns may be unused.

### 8.3 Controlled Test Setup

Useful for:

- Creating employees with specific job titles, locations, or supervisors.
- Seeding leave entitlements for a known balance before a leave test.
- Creating OAuth2 clients with known credentials.
- Setting `hs_hr_config` values.

Prefer API for setup when the API exists; fall back to DB for bulk or low-level fixtures.

For live, read-only verification of the configured instance, run `npm run test:live`. The integration suite compares the Admin employee API response with `hs_hr_employee`, exercises repository reads and a read-only transaction through the real MariaDB pool, and does not seed or delete business data.

### 8.4 Cleanup

- Give each created record a unique identifier and retain the application-returned ID with its test owner.
- Clean up only test-owned records, using a supported OrangeHRM lifecycle operation where one exists. Verify the resulting state instead of assuming cleanup succeeded.
- Do not use direct SQL deletion or `deleteWhere()` as routine test cleanup.
- The framework DB client is read-only and accepts only non-locking `SELECT` queries. Keep the database account read-only as a second boundary where the environment permits it.
- Employee deletion is a hard delete. If an explicitly authorized administrative operation requires it, first check dependent records, including timesheets and attendance, then verify the employee is absent and inspect orphan integrity afterward.
- `findOrphanedTimesheets()` is a post-delete integrity check only; its result is not permission to delete an employee.
- **`hs_hr_unique_id`:** `last_id` is not reset by employee deletion; IDs keep advancing.

### 8.5 Permission and Workflow Tests

- **Endpoint-level:** query `ohrm_api_permission` + `ohrm_data_group` + `ohrm_user_role_data_group` to know expected 403s.
- **Workflow-level:** query `ohrm_workflow_state_machine` for allowed transitions per `(workflow, state, role)`.
- **Row-level:** the `self` flag in `ohrm_user_role_data_group` scopes access to the logged-in user's own records.

---

## 9. Known Quirks / Gotchas

- Doctrine annotations only — PHP 8 attributes are not scanned.
- Proxies must be regenerated in production: `bin/console orm:generate-proxies` (wired into `composer.json` `post-autoload-dump`).
- `MIGRATIONS_MAP` is in `installer/`, not `src/` — new migrations must be registered there.
- `'3.3.3'` baseline loads raw SQL dumps; new migrations use `AbstractMigration` methods.
- Workflow action encoding is mixed — integer IDs for flows 0,1,2,3,5,6,7; action names for flow 4 (Leave).
- Role naming inconsistency — Leave uses `ESS`, others use `ESS USER`.
- `hs_hr_unique_id` is separate from `AUTO_INCREMENT` — the next `emp_number` is `last_id + 1`, not `max(emp_number) + 1`.
- Three soft-delete conventions — `deleted`, `is_deleted`, `purged_at`/`deleted_at`.
- Two OAuth table sets — `ohrm_oauth2_*` is active, `ohrm_oauth_*` is dead code.
- No FK on timesheet/attendance `employee_id` — rows orphan on employee delete.
- `ohrm_user.emp_number` is nullable — a user can exist without an employee link.
- `hs_hr_employee.emp_marital_status` is varchar, not enum — but `hs_hr_emp_dependents.ed_relationship_type` is a real enum.
- `ohrm_leave_entitlement.no_of_days` has very high precision — `decimal(19,15)`. Balance arithmetic must account for this.
- `ohrm_work_week` has only one row with `operational_country_id = NULL` — it is the global default, not a per-country config.
- `ohrm_attendance_record` stores both UTC and user-local times plus timezone name — timezone correctness matters for time-based tests.
- `ohrm_login` has no FK to `ohrm_user` — login records can outlive user deletion.
- `hs_hr_config` contains OAuth encryption keys — do not expose or log these values.
- `@@transaction_isolation = REPEATABLE-READ` — concurrent tests may see stale reads within a transaction.
- All tables are InnoDB — FK enforcement is active; tests that attempt to violate FKs will fail with a constraint error.

---

## 10. Version-Specific Notes

- OrangeHRM version: 5.9.0 (from `hs_hr_config` key `instance.version`)
- Migration version: last row in `ohrm_migration_log` is 5.9.0
- MariaDB runtime: 11.4.13-MariaDB-ubu2404
- Historical migration install stamp: 10.11.19-MariaDB-ubu2204
- PHP: 8.3.35
- Doctrine ORM: 2.20.7
- Doctrine DBAL: 3.8.1
- Doctrine Annotations: 1.14.4 (abandoned upstream)
- `league/oauth2-server`: ~8.4.2
- Migration map: `installer/Util/AppSetupUtility.php:39` (`MIGRATIONS_MAP` constant)
- OAuth2 tables introduced in 5.4.0 (`ohrm_oauth2_*`)
- Legacy OAuth tables (`ohrm_oauth_*`) are pre-5.4 artifacts — still present, unreferenced
- Git commit: `d46a115` ("Add OrangeHRM 5.9 cloned project"), branch `main`

---

## 11. Facts vs Inferences vs Assumptions

### FACT (verified by SQL, file path, or live query)

- Doctrine 2.20.7, DBAL 3.8.1, Annotations 1.14.4
- Annotation-based metadata only; no attributes, no repositories, no lifecycle callbacks
- `TIME_DIFF` custom DQL function registered at `lib/orm/Doctrine.php:77`
- Dev cache = `ArrayAdapter`; prod cache = `FilesystemAdapter` (`doctrine_metadata`, `doctrine_queries`)
- `MIGRATIONS_MAP` at `installer/Util/AppSetupUtility.php:39`
- `AbstractMigration` at `installer/Util/V1/AbstractMigration.php:27`
- 34 migration directories, V3_3_3 through V5_9_0
- 36 rows in `ohrm_migration_log`, 3.3.3 → 5.9.0
- `hs_hr_config.instance.version = 5.9.0`
- `hs_hr_employee` has 47 columns, PK `emp_number AUTO_INCREMENT`
- 6 FKs on `hs_hr_employee`, all `ON DELETE SET NULL`
- `hs_hr_unique_id` tracks last `emp_number = 4`
- `ohrm_user_role` has 7 rows; only Admin and ESS are assignable
- `ohrm_data_group` has 280 rows; `ohrm_user_role_data_group` has 673 rows
- `ohrm_api_permission` has 191 rows
- `ohrm_workflow_state_machine` has 138 rows
- Workflow action encoding: integer IDs for 0,1,2,3,5,6,7; action names for 4
- Leave status codes: -1 REJECTED, 0 CANCELLED, 1 PENDING APPROVAL, 2 SCHEDULED, 3 TAKEN, 4 WEEKEND, 5 HOLIDAY
- `ohrm_leave` FKs: `leave_request_id` CASCADE, `leave_type_id` CASCADE
- `ohrm_leave_request.emp_number` → `hs_hr_employee` CASCADE
- `ohrm_timesheet.employee_id` has no FK
- `ohrm_attendance_record.employee_id` has no FK
- `ohrm_emp_termination.emp_number` → `hs_hr_employee` CASCADE
- All 150+ tables are InnoDB
- `@@transaction_isolation = REPEATABLE-READ`
- `Config::PRODUCT_MODE` defined at `src/lib/config/Config.php:57`
- `ohrm_oauth_*` tables are unreferenced by application code
- `ohrm_subunit` uses `lft`, `rgt`, `level` (not `depth`)
- `ohrm_work_week` has 1 row with `operational_country_id = NULL`
- Soft-delete columns: `deleted` (leave_type, leave_entitlement, user), `is_deleted` (claim_event, claim_request, customer, expense, expense_type, job_title, project, project_activity), `purged_at` (employee), `deleted_at` (kpi)

### INFERENCE (derived from multiple facts)

- The `hs_hr_*` prefix denotes legacy 4.x tables; `ohrm_*` denotes 5.x tables — inferred from the migration timeline and the table inventory
- `ohrm_user.user_password` uses bcrypt or argon2 — inferred from `varchar(255)` and modern PHP hashing practice; not verified against the hashing class
- The `self` flag in `ohrm_user_role_data_group` scopes access to the logged-in user's own records — inferred from the flag name and its usage pattern
- `hs_hr_unique_id.last_id = 4` means the next employee will be `emp_number = 5` — inferred from the table's purpose and the absence of other ID generators

### ASSUMPTION (not verified)

- The runtime value of `Config::PRODUCT_MODE` in this instance — it is set via `sed` during CI packaging; the default source value was not inspected
- Whether `ohrm_timesheet` and `ohrm_attendance_record` orphaned rows are cleaned up by any background job — no such job was found, but the search was not exhaustive

### NOT YET VERIFIED

- Whether Google SMTP is configured in `ohrm_email_configuration` — this table has 0 rows, so email sending is not functional
- The exact runtime value of `PRODUCT_MODE`

---

## 12. Sources

**Source files (cloned 5.9 tree, commit `d46a115`):**

- `composer.json` — dependency pins
- `composer.lock` — resolved versions
- `lib/orm/Doctrine.php` — Doctrine bootstrap, caching, proxy config, custom DQL
- `lib/orm/Functions/TimeDiff.php` — `TIME_DIFF` implementation
- `lib/config/Config.php` — `PRODUCT_MODE` constant
- `installer/Util/AppSetupUtility.php` — `MIGRATIONS_MAP` constant
- `installer/Util/V1/AbstractMigration.php` — migration base class
- `installer/Migration/V3_3_3/` … `V5_9_0/` — 34 migration directories
- `installer/Migration/V3_3_3/dbscript-1.sql`, `dbscript-2.sql` — baseline dumps
- `installer/Command/UpgradeCommand.php` — reads `MIGRATIONS_MAP`
- `installer/Util/Service/DataRegistrationService.php` — `PRODUCT_MODE` consumer
- `plugins/orangehrmPimPlugin/entity/Employee.php` — entity mapping
- `plugins/orangehrmCoreOAuthPlugin/entity/` — OAuth2 entities
- `plugins/orangehrmCoreOAuthPlugin/config/routes.yaml` — OAuth routes
- `plugins/orangehrmPimPlugin/config/routes.yaml` — PIM routes
- `plugins/orangehrmLeavePlugin/config/routes.yaml` — Leave routes
- `plugins/orangehrmTimePlugin/config/routes.yaml` — Time routes
- `plugins/orangehrmRecruitmentPlugin/config/routes.yaml` — Recruitment routes
- `plugins/orangehrmAdminPlugin/config/routes.yaml` — Admin routes
- `plugins/orangehrmClaimPlugin/config/routes.yaml` — Claim routes
- `.github/workflows/4x_dumps/V4_0.sql` … `V4_10_1.sql` — migration dumps
- `.agents/skills/migrations/SKILL.md` — migration workflow documentation

**SQL queries against the running instance:**

- `SHOW TABLES;`
- `DESCRIBE hs_hr_employee;`
- `SHOW CREATE TABLE hs_hr_employee;`
- `SHOW CREATE TABLE ohrm_emp_termination;`
- `SHOW KEYS FROM hs_hr_employee;`
- `DESCRIBE ohrm_migration_log;`
- `SELECT * FROM ohrm_migration_log ORDER BY id;`
- `SELECT * FROM hs_hr_config;`
- `SELECT * FROM ohrm_user_role;`
- `SELECT * FROM ohrm_data_group ORDER BY id;`
- `SELECT * FROM ohrm_user_role_data_group ORDER BY user_role_id, data_group_id;`
- `SELECT * FROM ohrm_user_role_screen ORDER BY user_role_id, screen_id;`
- `SELECT * FROM ohrm_api_permission ORDER BY id;`
- `SELECT * FROM ohrm_workflow_state_machine;`
- `SELECT * FROM ohrm_leave;`
- `SELECT * FROM ohrm_leave_request;`
- `SELECT * FROM ohrm_leave_status ORDER BY id;`
- `SELECT * FROM ohrm_attendance_record ORDER BY state;`
- `SELECT * FROM ohrm_timesheet ORDER BY state;`
- `SELECT * FROM ohrm_job_candidate;`
- `SELECT * FROM ohrm_organization_gen_info;`
- `SELECT * FROM hs_hr_unique_id;`
- `SELECT * FROM ohrm_theme;`
- `SELECT * FROM ohrm_work_week;`
- `SELECT * FROM ohrm_email_configuration;`
- `SELECT @@tx_isolation;`
- `SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'orangehrm';`
- `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'orangehrm' AND (LOWER(COLUMN_NAME) LIKE '%deleted%' OR ...) ORDER BY TABLE_NAME, ORDINAL_POSITION;`
- `SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = 'orangehrm' AND REFERENCED_TABLE_NAME IS NOT NULL;`
- `SELECT CONSTRAINT_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, UNIQUE_CONSTRAINT_NAME, UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'orangehrm' ORDER BY TABLE_NAME, CONSTRAINT_NAME;`
- `SHOW COLUMNS FROM ohrm_user;`
- `SELECT id, user_name, user_role_id, status, emp_number FROM ohrm_user ORDER BY id;`
- `SELECT id, name, lft, rgt, level FROM ohrm_subunit ORDER BY lft;`
- `DESCRIBE ohrm_oauth2_client;`
- `DESCRIBE ohrm_oauth2_access_token;`
- `DESCRIBE ohrm_login;`
- `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'orangehrm' ORDER BY TABLE_ROWS DESC;`

**Searches across the codebase:**

- `Select-String -Pattern '@ORM\\Column'` (found)
- `Select-String -Pattern '#\[ORM\\Column'` (zero matches)
- `Select-String -Pattern 'createAnnotationMetadataConfiguration|createAttributeMetadataConfiguration'` (found annotation config)
- `Select-String -Pattern 'repositoryClass'` (zero matches)
- `Select-String -Pattern 'HasLifecycleCallbacks|@ORM\\PrePersist|@ORM\\PreUpdate'` (zero matches)
- `Select-String -Pattern 'MIGRATIONS_MAP|MigrationInterface|AbstractMigration|MigrationRunner|MigrationService'` (found in `installer/`)
- `Select-String -Pattern 'PRODUCT_MODE'` (found in `src/`, `installer/`, `.github/`, `.agents/`)
- `Select-String -Pattern 'ohrm_oauth_client|ohrm_oauth_access_token|...'` (zero matches — legacy OAuth dead)
- `Select-String -Pattern 'OAuth|oauth|access_token|refresh_token|client_id'` (found OAuth2 references)

**Git metadata:**

- Branch: `main`
- HEAD: `d46a115` — "Add OrangeHRM 5.9 cloned project"

---

_End of document._
