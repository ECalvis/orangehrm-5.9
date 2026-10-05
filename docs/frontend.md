# OrangeHRM 5.9 Frontend Architecture

**Standalone research document for `docs/frontend.md`.**

Every claim is traceable to a specific file, a pasted `app.js` trace, or a DB row. Version discipline is enforced: **OXD is locked to 2.0.3**; the main-app version is **OrangeHRM 5.9.0**. Items that could not be verified are listed explicitly in §11.

---

## 1. Scope

Covers the frontend/UI architecture of OrangeHRM 5.9 as deployed in a local instance (MariaDB 10.11.19, PHP 8.3.35, Apache) and verified against a cloned 5.9 source tree and a cloned OXD 2.0.3 source tree. Focuses on the Vue 3 single-page application (SPA) that Playwright will interact with:

- Technology stack
- Module structure
- Routing
- API communication
- State handling
- Form and validation behavior
- Tables
- Inputs
- Navigation
- Feedback mechanisms
- Permissions
- Responsive behavior
- Stable DOM patterns

Does **not** prescribe Playwright page objects, component objects, or test-case designs. Does not cover backend PHP internals beyond what is necessary to explain frontend behavior.

---

## 2. What It Is

OrangeHRM's frontend is a **Vue.js 3 SPA** that communicates with the OrangeHRM PHP backend exclusively through REST API v2 endpoints under `/web/index.php/api/v2/...`. It is not server-rendered in the traditional sense: the browser loads an HTML shell and the Vue app mounts and renders the appropriate page component. **Navigation between pages is done via full page loads**, not Vue Router — every "route" resolves to a server-rendered shell that mounts a Vue component.

The UI is built on **OXD (Orange eXperience Design)** — a custom Vue 3 component library and design system developed by OrangeHRM Inc. The main application uses **OXD 2.0.3**, confirmed from `@ohrm/oxd`'s `package.json`.

The architecture was introduced in OrangeHRM 5.0 and is shared by all 5.x versions including 5.9. The 5.9 release did not introduce a new frontend framework; its user-visible additions (Workspace Notifications for Slack/Google Chat) are backend/configuration features.

---

## 3. OrangeHRM 5.9 Behavior

### 3.1 Technology stack (FACT)

| Technology | Version | Source |
|------------|---------|--------|
| Vue.js | `^3.2.45` | `@ohrm/oxd package.json` |
| TypeScript | `~4.7.4` (dev) | `@ohrm/oxd package.json` |
| OXD | `2.0.3` | `@ohrm/oxd package.json` |
| Axios | (imported by main app) | `APIService` source |
| date-fns | `^2.29.3` | `@ohrm/oxd package.json` |
| nanoid | `^4.0.0` | `@ohrm/oxd package.json` |
| mitt | `^3.0.0` | `@ohrm/oxd package.json` |
| SASS | `^1.57.1` (dev) | `@ohrm/oxd package.json` |

**Notable absences from OXD 2.0.3:**

- No Vue Router — routing is server-driven.
- No Vuex / Pinia — no global frontend store.
- No axios — it is a peer dependency of the main app, not bundled in OXD.
- No i18n framework — translations come from app-level config, not `vue-i18n`.

### 3.2 Application structure (FACT)

Frontend source lives under `src/client/src/`:
src/client/src/
├── core/ # Shared infrastructure
│ ├── components/ # Reusable core components
│ ├── util/
│ │ ├── services/ # APIService and related
│ │ ├── composable/ # Vue composables
│ │ └── helper/ # Helper functions (navigation.ts, etc.)
├── orangehrm{Module}Plugin/ # One directory per functional module
│ ├── components/ # Module-specific components
│ └── pages/ # Module page components

```text
```
Modules follow the naming pattern `orangehrmPimPlugin`, `orangehrmLeavePlugin`, `orangehrmAdminPlugin`, `orangehrmClaimPlugin`, `orangehrmRecruitmentPlugin`, `orangehrmTimePlugin`, `orangehrmPerformancePlugin`, `orangehrmAuthenticationPlugin`, `orangehrmBuzzPlugin`, `orangehrmDashboardPlugin`.

### 3.3 Routing (FACT)

Routes are defined **server-side** in Symfony `routes.yaml` files (one per plugin). Each route maps a URL path to a PHP controller method. That controller (typically extending `AbstractVueController`) sets the Vue component to render:

```php
$component = new Component('x-widget-list');
$this->setComponent($component);
The Vue page component lives at src/client/src/orangehrm{X}Plugin/pages/widget-list/WidgetList.vue and is registered in src/client/src/pages.ts.

Client-side navigation is accomplished via two helpers in the main app:

navigate(path, pathParams, queryParams) — builds a URL from window.appGlobal.baseUrl + path, replaces {name} placeholders, appends query params (arrays as key[]=v), and sets window.location.href. Full page navigation.

reloadPage() — calls window.location.reload(). Called on any 401 response by APIService.

There is no client-side route table; the browser navigates to a URL and the server renders the appropriate shell.

3.4 API communication (FACT)
All frontend-to-backend data flow goes through a single APIService class. It is an Axios wrapper.

Constructor: new APIService(baseUrl, path) — baseUrl is window.appGlobal.baseUrl; path is the API endpoint path (e.g. /api/v2/pim/employees).

Methods:

Method	HTTP	URL
getAll(params?)	GET	this._apiSection
get(id, params?)	GET	${this._apiSection}/${id}
create(data)	POST	this._apiSection
update(id, data)	PUT	${this._apiSection}/${id}
delete(id)	DELETE	${this._apiSection}/${id}
deleteAll(data?)	DELETE	this._apiSection (body in data)
request(options)	any	this._apiSection + options
Headers:

getAll sets Content-Type: application/json, Accept: application/json, Cache-Control: no-store, no-cache, must-revalidate, post-check=0, pre-check=0.

create sets Content-Type and Accept.

Others set Content-Type only.

Response interceptor:

401 → reloadPage() (full page reload). This is why the SPA appears to "redirect" on session loss — the SPA itself reloads the page.

422 or 400 with a matching ignore path (setIgnorePath(regex)) → no toast; the raw error.response is rejected. This is how form-level validation errors avoid a global toast.

Other errors → $toast.unexpectedError(response?.error.message) (using the OrangeHRM envelope's error.message).

ETag caching (non-development only): if process.env.NODE_ENV !== 'development', the service attaches If-None-Match from a cached ETag and, on 304, resolves with the cached body as a 200. This caching is disabled in dev mode.

3.5 State management (FACT)
There is no Vuex or Pinia. State is managed through:

Local component state — ref, reactive, Options API data().

Composition API composables — reusable stateful logic.

Provide/inject — for table props, form context.

Props and events — parent-child communication.

Event bus (mitt) — for the card table's internal cell ↔ header ↔ row communication.

There is no cross-page caching of entity data. Each page fetches on mount.

3.6 Forms (FACT)
Forms use OXD components in a nested pattern:

vue
<oxd-form @submit-valid="filterItems" @reset="filterItems">
  <oxd-form-row>
    <oxd-grid :cols="4" class="orangehrm-full-width-grid">
      <oxd-grid-item>
        <oxd-input-field v-model="name" label="Name" required :rules="[...]" />
      </oxd-grid-item>
    </oxd-grid>
  </oxd-form-row>
  <oxd-divider />
  <oxd-form-actions>
    <oxd-button display-type="ghost" label="Reset" type="reset" />
    <oxd-button display-type="secondary" label="Search" type="submit" />
  </oxd-form-actions>
</oxd-form>
OxdForm (Form.vue):

Root is a real <form class="oxd-form" novalidate>.

novalidate disables native browser validation; all validation is JS-driven.

@submit.prevent prevents native submit.

Loading state renders .oxd-form-loader with a spinner.

Emits exactly one of submitValid / submitInvalid on submit.

isFormBusy blocks submit while any field is processing or the form is loading.

OxdFormRow, OxdFormActions, OxdDivider — layout primitives. OxdGrid + OxdGridItem provide the responsive column grid (.oxd-grid-{cols}, .oxd-grid-item, --gutters).

3.7 Validation (FACT)
Validation lives in three composables.

useFormValidation(isLoading) — provides a form context via formKey (a Symbol('form')):

formState = {fieldset: [], errorbag: []}.

validate() runs Promise.all(fieldset.map(field => field.validate())); on resolution, addError is called per field. A rejected promise is caught and logged, not rethrown — a buggy rule does not block submission.

searchErrors(id) returns [] while isLoading is true.

reset() calls each field's reset() and clears errorbag.

useField(fieldContext) — called by InputField:

Assigns a nanoid() cid per field.

Registers itself via form.registerField(...).

Watches modelValue and re-validates on every change — errors appear reactively while typing.

Runs rules sequentially; a rule that returns anything other than true short-circuits remaining rules.

A rule returning a string → that string becomes the error.

A rule returning non-true, non-string → generic type-error message.

Disabled fields skip validation and return no errors.

Exposes hasError and message (only the first error per field).

Rule signature: (value?: any) => string | boolean | Promise<string | boolean>.

Required + typing hint: OxdInputField shows * when required is true (class .oxd-input-field-required), and the message text when hasError is true (class .oxd-input-field-error-message).

3.8 Tables / data grids (FACT)
Three table components exist.

OxdCardTable (primary list views — PIM, Leave, Admin, Claim, Recruitment, Time, Performance, Buzz):

Uses a nanoid(8) tableId and a mitt event bus internally.

Header is rendered by DefaultCardHeader.vue — only at DEVICE_LG or DEVICE_XL (viewport ≥1000px).

Header cell is <div class="oxd-table-header-cell" role="columnheader"> (not a <th>).

Body is dispatched by DefaultCardContainer.vue to DefaultCardWeb.vue (desktop) or DefaultCardMobile.vue (mobile).

Each row on desktop is wrapped in <div class="oxd-table-card">; inside it an <oxd-card-tr> renders a <tr class="oxd-table-row">.

Cells are rendered by DefaultCellContainer.vue, which dispatches based on header.cellType (resolved by component name) or header.cellRenderer (a function).

Registered cell types: oxd-table-cell-default, oxd-table-cell-actions, oxd-table-cell-checkbox, oxd-table-cell-truncate.

Header sort uses a dropdown (TableHeaderSortDropdown.vue) with items Ascending / Descending.

Select-all checkbox is OxdCheckboxInput with icon check (all) or dash (partial).

Loading state renders .oxd-table-loader.

OxdClassicTable (rare):

Real <table class="oxd-table"> with <thead class="oxd-table-header">, <tbody class="oxd-table-body">, <tfoot class="oxd-table-footer">.

Header cells: <th class="oxd-padding-cell oxd-table-th">.

Data cells: <td class="oxd-padding-cell">.

Checkboxes are raw <input type="checkbox">, not OxdCheckboxInput.

OxdReportTable (used by ReportsTable.vue):

Uses @revolist/vue3-datagrid under the hood.

Fetches headers from /api/v2/{module}/reports and data from /api/v2/{module}/reports/data.

Filters include _dateFormattingEnabled: true.

Record count text: .oxd-text--count (i18n general.n_records_found).

Footer text: .oxd-text--footer.

Pagination: OxdPagination.

3.9 Inputs (FACT)
Every input type is wrapped by OxdInputField, which:

Renders an <oxd-input-group> (label + input + message).

Resolves the inner component from TYPE_MAP[type] — one of: oxd-input, oxd-textarea, oxd-file-input, oxd-date-input, oxd-time-input, oxd-radio-input, oxd-select-input, oxd-switch-input, oxd-password-input, oxd-checkbox-input, oxd-color-input, oxd-multiselect-input, oxd-autocomplete-input.

Forwards $attrs and has-error to the inner component.

Wires v-model through update:modelValue.

Uses useField for validation.

Input DOM summary:

Type	DOM root	Notes
Text	input.oxd-input	Native <input>
Textarea	textarea.oxd-textarea	Native <textarea>
Password	input.oxd-input (inside PasswordInput)	With password-strength-indicator chip
Checkbox	input[type=checkbox] inside .oxd-checkbox-wrapper > label	Label wraps input → getByLabel works
Radio	input[type=radio] inside .oxd-radio-wrapper > label	Label wraps input → getByLabel works
Switch	input[type=checkbox] inside .oxd-switch-wrapper > label	Visual is a <span>; native element is a checkbox
Select	<div class="oxd-select-text-input" tabindex="0">	NOT a native <select>
MultiSelect	Same trigger as select; chips in .oxd-multiselect-chips-area	Selected values shown as .oxd-chip
Autocomplete	<input> inside .oxd-autocomplete-text-input	800ms debounce; options in .oxd-autocomplete-dropdown with role="listbox"
Date	input.oxd-input inside .oxd-date-wrapper	Picker opens on click; shortcut links Today/Clear/Close
Time	input.oxd-input inside .oxd-time-wrapper	Displays hh:mm a; stores HH:mm; AM/PM radios in picker
File	<input type="file" class="oxd-file-input"> (hidden) + .oxd-file-div (visible)	Playwright setInputFiles() targets the hidden input
Color	<div class="oxd-color-input"> with preview swatch	Picker uses canvas palette, hue slider, HEX input
3.10 Dialogs, modals, toasts, alerts (FACT)
OxdDialog: wrapper around <oxd-overlay role="dialog"> → <oxd-sheet class="oxd-dialog-sheet"> → <oxd-dialog-close-button class="oxd-dialog-close-button-position">. Root container class .oxd-dialog-container-default. Dismisses on overlay click unless persistent.

OxdOverlay: <div role="dialog" class="oxd-overlay oxd-overlay--flex oxd-overlay--flex-centered">.

OxdDialogCloseButton: native <button class="oxd-dialog-close-button"> ×.

OxdToast: aria-live="assertive"; root .oxd-toast .oxd-toast--{type}; title and message as <oxd-text> inside .oxd-toast-content-text. Click dismisses unless persistent.

OxdToastContainer: .oxd-toast-container--{position} (position top or bottom); owns the toasts array.

OxdAlert: <div role="alert" class="oxd-alert oxd-alert--{type}"> with .oxd-alert-content-text.

Toast / Alert types (from Toast/types.ts): default, success, warn, error, info with icons star, check2, exclamation-triangle, exclamation-circle, info-circle.

App-level $toast API (in app.js, not OXD): notify, show, success, error, info, warn, clear, clearAll, saveSuccess, addSuccess, updateSuccess, deleteSuccess, cannotDelete, noRecordsFound. The mapping from each method to a specific {type, title, message} lives in the app's toast service (implementation NOT VERIFIED).

Dialogs in the main app: DeleteConfirmationDialog and ConfirmationDialog — teleported to #app, expose a showDialog() Promise resolving 'ok' or 'cancel'. Delete dialog buttons: general.no_cancel, general.yes_delete.

3.11 Navigation (FACT)
Sidepanel: <aside class="oxd-sidepanel" :class="{toggled}"> > <nav class="oxd-navbar-nav" role="navigation" aria-label="Sidepanel"> > .oxd-sidepanel-header (with branding and close button) + .oxd-sidepanel-body > <oxd-main-menu>.

OxdMainMenu renders .oxd-main-menu with a search input filtering by regex on item.name, and <ul class="oxd-main-menu"> containing <oxd-main-menu-item> per entry. Each item is:

vue
<li class="oxd-main-menu-item-wrapper">
  <a :class="{ 'oxd-main-menu-item': true, active, toggle }" :href="url">
    <oxd-icon :name="icon" class="oxd-main-menu-item--icon" />
    <oxd-text class="oxd-main-menu-item--name">{{ name }}</oxd-text>
  </a>
</li>
Menu items are real <a href="..."> links. Navigation triggers a full page load.

Menu items are passed via the menuItems prop, populated server-side. The frontend does not filter by permission; permission filtering happens before menuItems reaches the sidepanel.

Topbar: <oxd-navigation> renders <nav role="navigation" aria-label="Topbar Menu" class="oxd-topbar-body-nav"> with:

oxd-navigation-link per menu item.

oxd-navigation-more if items overflow (renders a "More" dropdown with a three-dots icon).

Leaf items render <a class="oxd-topbar-body-nav-tab-item" href="#">.

Parent items render via oxd-dropdown-menu with a chevron-down icon.

Sub-menu links have role="menuitem" and class .oxd-topbar-body-nav-tab-link.

Navigation uses window.location.replace(item.url) — full page navigation.

3.12 Loading states (FACT)
Form-level: .oxd-form-loader inside OxdForm, containing <oxd-loading-spinner>.

Table-level: .oxd-table-loader inside OxdCardTable when loading is true.

Spinner: .oxd-loading-spinner (inner) inside .oxd-loading-spinner-container (or --block when withContainer is false).

3.13 Errors (FACT)
API errors: handled by APIService response interceptor. 401 → reloadPage(). 422/400 with ignore-path → suppressed; rejected with error.response. Other errors → $toast.unexpectedError(response?.error.message).

Validation errors: rendered inline by OxdInputGroup as <oxd-text> with class .oxd-input-group__message.oxd-input-field-error-message. Only the first error per field is shown.

403 page: the auth-forbidden Vue component (registered in the public-component map). Renders <h1>403</h1> and i18n strings general.module_forbidden / general.module_access_restriction.

400 page: BadRequest.vue renders <oxd-alert type="warn" :message="$t('general.bad_request')">.

3.14 Success messages (FACT)
Success messages are rendered as toasts.

EmployeeList.vue calls $toast.deleteSuccess() after a delete; $toast.cannotDelete() when a row is undeletable.

The toast component has stable classes .oxd-toast--success etc.

The exact text of each $toast.X() method lives in the app's toast service (NOT VERIFIED).

3.15 Permissions (FACT)
Frontend permission rendering uses a $can global:

vue
<div v-if="$can.create('employee_list')"> ... </div>
<oxd-card-table :selectable="$can.delete('employee_list')" ... />
js
if (this.$can.delete('employee_list') && !this.unselectableEmpNumbers.includes(row.id)) {
  // render delete icon
}
The screen identifier is a string key (e.g. 'employee_list').

$can.create / $can.delete are the frontend gates. The backend gate is EmployeeController::preRender(), which supplies canCreate and canDelete from the workflow state machine.

The unselectableEmpNumbers prop is passed from the server (EmployeeService::getUndeletableEmpNumbers()). Rows whose id is in this array do not get a per-row delete icon and trigger $toast.cannotDelete() if delete is attempted.

Menu filtering happens server-side — the frontend receives a pre-filtered menuItems array. A user without permission for a screen will not see the corresponding menu item.

Direct URL access to a forbidden screen produces a 403 page rendered server-side, containing the <auth-forbidden> Vue component.

v-if removes elements from the DOM entirely — permission assertions must be made against element presence, not CSS visibility.

3.16 API ↔ frontend relationship (FACT)
Every API call is made through APIService. Endpoints follow /api/v2/{module}/{resource}. The frontend never accesses the database directly. The API request/response format is defined by the backend ({data, meta, rels} for success; {error: {status, message, data?}} for errors).

Live trace: the SPA at /web/index.php/pim/viewEmployeeList issues:

http
GET /web/index.php/api/v2/pim/employees?limit=50&offset=0&model=detailed&includeEmployees=onlyCurrent&sortField=employee.firstName&sortOrder=ASC
Accept: application/json
Cookie: _orangehrm=...
→ 200 OK, {"data": [...], "meta": {"total": 2}, "rels": []}
3.17 usePaginate (FACT)
Composable used by list pages. Default options:

js
{
  query: {},
  normalizer: identity,
  prefetch: true,
  toastNoRecords: true,
  pageSize: 50,
}
Behavior:

currentPage starts at 1.

isLoading toggles true at start, false at end.

query is cloned with null and '' values stripped to undefined.

limit = pageSize, offset = pageSize * (currentPage - 1).

Response is {data, meta, error?} from a wrapper that catches Axios errors.

normalizer is applied to response.data.data.

total = meta.total; if total > pageSize, showPaginator = true and pages = Math.ceil(total / pageSize); else currentPage resets to 1 and showPaginator = false.

On total === 0, calls $toast.noRecordsFound() (if toastNoRecords).

Watches currentPage and re-fetches.

3.18 useResponsive and breakpoints (FACT)
useResponsive returns reactive {windowWidth, windowHeight, screenType}, updated on mount and resize.

Breakpoints:

Device	Min	Max
xs	0	599
sm	600	799
md	800	999
lg	1000	1199
xl	1200	4000
DEVICE_LG and DEVICE_XL are the desktop breakpoints. Tables render the header and desktop layout only on these. Below lg, the table uses the mobile card layout and the table filter is collapsed by default.

3.19 usei18n (FACT)
usei18n returns a t(key, fallback) function that looks up key in the app's config (getConfig('language')) and falls back to fallback when the key is absent. Translation files are loaded from app config — the translation text may differ from the key.

3.20 navigate and reloadPage (FACT)
From the main app's navigation.ts (bundled into app.js):

buildUrl(path, pathParams, queryParams) — replaces {name} placeholders in path with pathParams[name]; appends query params (arrays as key[]=v).

navigate(path, pathParams, queryParams) — sets window.location.href = baseUrl + buildUrl(...). Full page navigation.

reloadPage() — window.location.reload().

Every navigation in OrangeHRM triggers a full page load.

4. Architecture
4.1 High-level
```text
Browser
  │
  ├── Vue.js 3 SPA Shell (server-rendered HTML + Vue mount point)
  │     ├── OXD Components (globally registered)
  │     ├── Module Page Components (loaded by server-provided component name)
  │     └── Provide/inject for form + table contexts
  │
  ├── APIService (Axios wrapper)
  │     └── /web/index.php/api/v2/... (REST API v2)
  │
  └── PHP Backend
        ├── Symfony routes.yaml (page routing)
        ├── AbstractVueController (renders Vue component shell)
        └── REST API Controllers (JSON responses)
4.2 Page lifecycle
Browser requests a page URL (e.g. /web/index.php/pim/viewEmployeeList).
```
Symfony router matches routes.yaml entry.

Page controller (AbstractVueController subclass) executes:

Authorization check (screen permission).

Builds a Component object with props.

Renders HTML shell containing window.appGlobal (base URL etc.) and a Vue mount point.

Vue app boots, reads the component name, loads the corresponding page component.

Page component onMounted → calls APIService to fetch data.

User interactions → component state updates → API calls → UI updates.

4.3 Form lifecycle
OxdForm calls useFormValidation(isLoading), which provide()s a FormAPI under formKey.

Each OxdInputField calls useField({fieldLabel, rules, modelValue, onReset, disabled}).

useField assigns a nanoid cid, registers with the form, and starts a watcher on modelValue.

On every model change, validation runs; results are pushed to errorbag.

InputField reads hasError and message from useField and passes them to InputGroup.

On form submit, OxdForm.validate() runs all registered field validate() calls in parallel; then emits submitValid or submitInvalid.

On reset, each field calls its reset(), which resets state and restarts the watcher.

4.4 Card table lifecycle
Page passes headers and items to OxdCardTable.

OxdCardTable generates a nanoid(8) tableId and provide()s tableProps and screenState via injection keys.

DefaultCardHeader renders column headers (desktop only).

DefaultCardContainer dispatches to DefaultCardWeb (desktop) or DefaultCardMobile.

DefaultCardWeb iterates rows; each row is a <div class="oxd-table-card"> containing an <oxd-card-tr>.

Inside each row, DefaultCellContainer renders one <td> per header, dispatching on cellType or cellRenderer.

Row clicks, checkbox changes, select-all, and sort all emit through the mitt event bus with a tableId prefix.

CardTable.vue listens to the bus and re-emits as public Vue events (update:selected, update:order, click, clickCheckbox, update:selectAll).

5. Important Concepts
Concept	Description
OXD	Orange eXperience Design — the Vue 3 component library used throughout the app.
AbstractVueController	PHP base class for page controllers. Sets the Vue component to render.
APIService	Centralized Axios wrapper for all API calls.
Screen permission	DB-backed (role × screen × CRUD). Controls page access and menu visibility. Enforced server-side on page load.
$can global	Frontend permission object with methods like .create(screen), .delete(screen). Gates UI element rendering.
unselectableEmpNumbers	Server-provided prop listing empNumbers whose per-row delete is blocked.
useFormValidation	Form-level state manager providing formKey.
useField	Field-level registration, validation, and reset.
errorbag	Array of {cid, errors} entries managed by the form.
cid	nanoid() identifier assigned per field; used to look up errors.
tableProps	Injection key providing table configuration to header/body/cell components.
screenState	Injection key providing responsive screen type to components.
Event bus (mitt)	Internal table communication bus, scoped by tableId.
Toast types	default, success, warn, error, info.
navigate()	Full-page navigation helper.
reloadPage()	Full page reload — invoked on any 401.
6. Important Objects / Components / Endpoints / Entities
6.1 OXD component export list (2.0.3)
Full public export list from src/index.ts:

Components: OxdAlert, OxdButton, OxdIconButton, OxdGlassButton, OxdBuzzPostInput, OxdCalendar, OxdCardTable, OxdTableDropdown, OxdBarChart, OxdLegend, OxdPieChart, OxdChip, OxdDialog, OxdOverlay, OxdDivider, OxdDropdownMenu, OxdForm, OxdFormRow, OxdFormActions, OxdGrid, OxdGridItem, OxdIcon, OxdInputField, OxdInputGroup, OxdLabel, OxdLayout, OxdSpinner, OxdPageItem, OxdPagination, OxdProgressbar, OxdReportTable, OxdMultilineCell, OxdSheet, OxdSidePanel, OxdTabPanel, OxdTabContainer, OxdClassicTable, OxdTableFilter, OxdText, OxdToast, OxdToastContainer, OxdTopbar, OxdUserDropdown, OxdNotificationDropdown, OxdTreeView, OxdInput, OxdFileInput, OxdDateInput, OxdRadioInput, OxdSwitchInput, OxdTimeInput, OxdTextarea, OxdPasswordInput, OxdCheckboxInput, OxdColorInput, OxdSelectInput, OxdMultiSelectInput, OxdMultiSelectChips, OxdAutocompleteInput.

Helpers: useField, debounce, useResize, CellAdapter, buildLocale, StoreService, useResponsive, promiseDebounce, useFormValidation, convertPHPDateFormat, clickOutsideDirective, useProvideTableProps, useInjectTableProps.

Constants: CHART_COLORS, TOAST_TYPES, DEVICE_TYPES, formKey, tablePropsKey, tableScreenStateKey.

6.2 Main-app-only components (not OXD)
employee-autocomplete, delete-confirmation, table-header, jobtitle-dropdown, subunit-dropdown, employment-status-dropdown, include-employee-dropdown, password-strength-indicator, required-text, reports-table, and various page-specific components.

6.3 Input types (from TYPE_MAP)
oxd-input, oxd-textarea, oxd-file-input, oxd-date-input, oxd-time-input, oxd-radio-input, oxd-select-input, oxd-switch-input, oxd-password-input, oxd-checkbox-input, oxd-color-input, oxd-multiselect-input, oxd-autocomplete-input.

6.4 Cell types (from CardTable/Cell/)
cellType	Component	Notes
oxd-table-cell-default	Default.vue	Plain text; <div>{{item}}</div> on desktop
oxd-table-cell-actions	Actions.vue	<div class="oxd-table-cell-actions"> with per-action buttons
oxd-table-cell-checkbox	Checkbox.vue	.oxd-table-card-cell-checkbox with OxdCheckboxInput
oxd-table-cell-truncate	Truncate.vue	Truncates at 50 chars with show more/less toggle
6.5 Card header config
CardHeader interface: {name, title, slot?, cellType?, cellConfig?, sortField?, cellRenderer?}. Order values: 'ASC' | 'DESC' | 'DEFAULT'. RowItem supports isSelectable? and isDisabled?.

7. Relationships to Other OrangeHRM Layers
Frontend → API: every data operation goes through APIService → /api/v2/.... There is no direct DB access.

Frontend → Database (indirect): state reflects what the API returns. The frontend has no schema knowledge.

API → Frontend: the API envelope {data, meta, rels} (success) or {error: {status, message, data?}} (error) is the contract.

Permissions → Frontend: screen permissions checked server-side on page load. CRUD permissions surfaced via $can for conditional rendering. Data-group permissions affect API results (frontend unaware).

Menu → Frontend: menu structure delivered from DB, filtered by user permissions, rendered by the sidepanel/topbar.

OXD → Everything: every visual element is an OXD component. Version is pinned per OrangeHRM release (OXD 2.0.3 in 5.9).

Auth → Frontend: session cookie for browser SPA; OAuth Bearer for API clients. On session loss, APIService triggers reloadPage() which redirects to the login page.

8. Testing Implications
8.1 Navigation
Every navigation triggers a full page load (window.location.href or window.location.replace). Playwright must use waitForURL or waitForLoadState, not just DOM assertions.

reloadPage() on 401 causes the SPA to reload → redirect to login. Playwright should expect this on session loss.

8.2 Selectors
Do not use getByLabel() for OXD form fields. OxdLabel renders a <label> without a for attribute. Use .oxd-input-group filtering by label text and then locate the input within the group.

Do not use selectOption() for OXD select inputs. They are not native <select> elements — the trigger is .oxd-select-text-input.

Use .oxd-table-card as the row selector in card tables, not <tr>. The <tr> may be inside or adjacent to a wrapper <div>; do not assume a <table> > <tbody> > <tr> structure.

Prefer role-based selectors where available: role="dialog", role="alert", role="listbox", role="option", role="menu", role="menuitem", role="columnheader", role="navigation", role="button".

Use .oxd-icon.bi-{icon-name} for icon-based buttons (bi-pencil-fill, bi-trash, bi-caret-up-fill, etc.).

8.3 Forms
Invalid submissions do not call the API. Assert on inline error messages (.oxd-input-group__message) and toast absence.

Validation is reactive — errors can appear as the user types. Wait for the state, don't assume it appears at submit time only.

Only the first error per field is displayed.

Async rules (e.g. password strength) are debounced (500ms in PasswordInput).

8.4 Autocomplete / Select
Autocomplete search is debounced at 800ms. Wait before asserting options.

The dropdown is v-if — it doesn't exist until opened.

Options use @mousedown, not @click — Playwright's click() performs both, so it works.

8.5 Tables
On viewports < 1000px, the desktop header and layout are replaced with the mobile card layout. Set the viewport ≥ 1200px for stable table automation.

Rows are identified by .oxd-table-card — filter by content (:has-text("...")) rather than by index when possible.

Checkbox cells use @click.stop — clicks on the checkbox do not trigger the row click.

Row clicks (when clickable: true) navigate to the edit page.

8.6 Toasts
Toast root: .oxd-toast.oxd-toast--{type}.

aria-live="assertive" is set.

Auto-dismiss timing is controlled by the app-level toast service (NOT VERIFIED).

8.7 Permissions
Assert permission behavior by DOM presence (not CSS visibility) — v-if removes elements entirely.

Menu items reflect server-side permissions; to test permission scenarios, log in as different users.

8.8 API-assisted setup
All CRUD endpoints are accessible via Bearer token or session cookie.

APIService uses the same endpoints Playwright can hit directly. Test setup via API is viable and reduces flakiness.

8.9 Database verification
The frontend has no DB layer. To verify persisted state, either re-fetch via API or reload the page and assert UI state.

9. Known Quirks / Gotchas
OxdLabel has no for attribute — getByLabel() fails for OXD form fields.

OxdSelectInput is not a native <select> — selectOption() does not work.

Autocomplete debounce is 800ms — assertions must wait.

Card table rows are <div class="oxd-table-card">, not <tr> at the top level. The <tr> inside may be hoisted by the browser.

Header is rendered only at viewports ≥1000px. Mobile layout uses .oxd-table-card-cell with .header/.data.

Row checkboxes use @click.stop — no row navigation from checkbox clicks.

v-if vs v-show: menu items, table headers on mobile, dropdowns, toasts use v-if; filter areas and dropdown menus use v-show. Assertions must account for this.

401 → full page reload. APIService calls reloadPage(), so Playwright must handle navigation.

Full page navigation on every click-through. Even SPA-internal links use window.location.href.

unselectableEmpNumbers hides the checkbox, not disables it. The cell renders a hidden placeholder to keep column alignment.

First error per field is displayed. Multiple rules may be defined; only the first failure surfaces.

Sequential rule execution short-circuits. A rule returning non-true stops later rules.

useFormValidation.validate() catches rejected promises and logs them. A buggy rule does not block form submission.

OxdTableFilter is v-show. The filter area is in the DOM even when collapsed.

File input is single-file only. The output is {name, type, size, base64}.

Color input is a <div>, not a native <input type="color">. Picker uses canvas + hex input.

i18n lookup falls back to fallback when key missing — assertions should target the resolved text, not the key.

Topbar overflow — items beyond viewport width collapse into a "More" menu.

ETag caching is disabled in development mode.

usePaginate strips null and '' from query params — an empty filter value does not appear in the request.

10. Version-Specific Notes
OrangeHRM version: 5.9.0 (hs_hr_config.instance.version = 5.9.0).

OXD version: 2.0.3 (from @ohrm/oxd package.json).

Vue: ^3.2.45 (OXD dependency constraint; the main app's exact Vue version is NOT VERIFIED).

date-fns: ^2.29.3.

nanoid: ^4.0.0.

mitt: ^3.0.0.

No Vue Router, no Vuex/Pinia, no vue-i18n, no axios are bundled in OXD 2.0.3. The main app supplies axios.

5.9 release notes list Workspace Notifications (Slack/Google Chat) as the primary new feature; it is a backend/configuration feature. The frontend framework architecture is unchanged from 5.0 through 5.9.

Legacy OAuth tables (ohrm_oauth_*) exist in the DB but are unreferenced; the active OAuth2 tables are ohrm_oauth2_*.

11. Facts vs Inferences vs Assumptions
FACT (traceable to a specific file, DB row, HTTP response, or app.js trace)
Technology & project structure:

Frontend is Vue 3 SPA with TypeScript, Axios, OXD 2.0.3, SASS.

OXD 2.0.3 dependencies: vue@^3.2.45, date-fns@^2.29.3, nanoid@^4.0.0, mitt@^3.0.0, chart.js@^4.1.2, @revolist/vue3-datagrid@^3.2.17.

OXD does not bundle Vue Router, Vuex, Pinia, axios, or vue-i18n.

Source layout is src/client/src/core/ + src/client/src/orangehrm{Module}Plugin/.

Routing & navigation:

Routes are defined server-side in Symfony routes.yaml.

AbstractVueController sets the Vue component to render.

navigate() sets window.location.href; reloadPage() calls window.location.reload().

All navigations trigger full page loads.

API communication:

APIService is an Axios wrapper with getAll, get, create, update, delete, deleteAll, request.

Constructor: new APIService(baseUrl, path); base is window.appGlobal.baseUrl.

401 response → reloadPage().

422/400 with matching ignore path → suppressed toast.

Other errors → $toast.unexpectedError(response?.error.message).

ETag caching enabled in non-development builds only.

State:

No Vuex/Pinia. Local state + composables + provide/inject + mitt event bus.

Forms & validation:

OxdForm renders <form class="oxd-form" novalidate>, emits submitValid/submitInvalid.

useFormValidation provides formKey with addError, purgeErrors, searchErrors, registerField, unregisterField.

useField assigns nanoid() cid, registers with form, validates reactively on model change.

Rules run sequentially and short-circuit.

message = first error per field.

Disabled fields skip validation.

Inputs:

Every input is wrapped by OxdInputField → OxdInputGroup.

OxdLabel renders a native <label> with class .oxd-label and NO for attribute.

OxdInput renders <input class="oxd-input">.

OxdTextarea renders <textarea class="oxd-textarea">.

OxdSelectInput is a custom component, not a native <select>; trigger is .oxd-select-text-input.

OxdAutocompleteInput has 800ms debounce; dropdown is role="listbox"; options are role="option".

OxdDateInput is a native text input + calendar picker with Today/Clear/Close shortcuts.

OxdTimeInput displays hh:mm a, stores HH:mm; picker has hour/minute inputs and AM/PM radios.

OxdRadioInput, OxdSwitchInput, OxdCheckboxInput use native <input> wrapped in <label> (label lookup works).

OxdFileInput renders a hidden <input type="file" class="oxd-file-input"> + a visible .oxd-file-div.

OxdColorInput is a <div> with preview swatch; picker has canvas + hue + hex input.

Tables:

OxdCardTable is the primary list-table component.

Header renders only at DEVICE_LG/DEVICE_XL.

Header cells are <div role="columnheader"> with class .oxd-table-header-cell.

Rows are <div class="oxd-table-card"> wrapping an <oxd-card-tr>.

Cell types: default, actions, checkbox, truncate.

Actions cell renders .oxd-table-cell-actions with per-action icon buttons.

Checkbox cell uses @click.stop; renders .oxd-table-card-cell-checkbox with OxdCheckboxInput.

Select-all checkbox uses check (all) or dash (partial) icon.

Sort dropdown renders role="menu" with Ascending/Descending.

OxdClassicTable is a real <table> with <thead>/<tbody>/<tr>/<th>/<td>; uses raw <input type="checkbox">.

OxdReportTable uses @revolist/vue3-datagrid.

Feedback:

Toast types: default, success, warn, error, info.

Toast icons: star, check2, exclamation-triangle, exclamation-circle, info-circle.

Toast root: .oxd-toast.oxd-toast--{type}; aria-live assertive.

Alert root: .oxd-alert[role="alert"].

Dialog root: .oxd-overlay[role="dialog"] + .oxd-dialog-sheet.

Loading spinner: .oxd-loading-spinner.

App-level $toast API: notify, show, success, error, info, warn, clear, clearAll, saveSuccess, addSuccess, updateSuccess, deleteSuccess, cannotDelete, noRecordsFound.

Navigation:

Sidepanel: aside.oxd-sidepanel, nav[aria-label="Sidepanel"], .oxd-main-menu, .oxd-main-menu-item, .oxd-main-menu-item--name.

Topbar: nav[aria-label="Topbar Menu"], .oxd-topbar-body-nav-tab-item, .oxd-topbar-body-nav-tab-link.

Menu items are real <a href="..."> links.

Pagination:

usePaginate default pageSize: 50.

currentPage starts at 1.

Query null/'' values stripped.

normalizer applied to response.data.data.

showPaginator true only when total > pageSize.

Responsive:

Breakpoints: xs<600, sm<800, md<1000, lg<1200, xl≥1200.

DEVICE_LG/DEVICE_XL = desktop.

Permissions:

$can.create(screen), $can.delete(screen) gate UI rendering.

unselectableEmpNumbers prop blocks per-row delete.

Menu is pre-filtered server-side.

i18n:

usei18n returns t(key, fallback); reads from getConfig('language').

403 / 400 pages:

403 page is the auth-forbidden Vue component with <h1>403</h1> and i18n strings general.module_forbidden, general.module_access_restriction.

400 page is BadRequest.vue with <oxd-alert type="warn" :message="$t('general.bad_request')">.

INFERENCE
The <tr> inside <div class="oxd-table-card"> may be hoisted by the browser in the rendered DOM. Playwright should not depend on ancestor chains.

The exact {type, title, message} mapping of $toast.deleteSuccess() etc. is defined by the app-level toast service, not OXD.

OxdTableFilter's collapsed state uses v-show, so the filter inputs remain in the DOM when collapsed.

Menu permission filtering happens server-side before menuItems reaches the sidepanel; the frontend does not re-filter.

ASSUMPTION
The OXD files pasted during research match the version bundled with OrangeHRM 5.9. @ohrm/oxd is 2.0.3 per its own package.json, but the running OrangeHRM 5.9 node_modules version was not directly inspected.

NOT VERIFIED
The exact Vue version used by the main OrangeHRM 5.9 app (package.json in the main repo was not inspected).

The $toast service implementation (mapping of each $toast.X() to {type, title, message}).

The server-side page shell that injects window.appGlobal and initial menuItems.

Input/MultiSelect/types.ts and other ancillary input type files.

Toast auto-dismiss timing.

useToast (if it exists as a distinct composable in the main app).

12. Sources
OXD 2.0.3 files (pasted during research):

Barrel and metadata:

@ohrm/oxd/package.json (version 2.0.3)

src/index.ts (barrel exports)

Root components:

src/components/Alert/Alert.vue

src/components/Alert/Container/Example.vue

src/components/CardTable/CardTable.vue

src/components/CardTable/Decorator/DefaultCardContainer.vue

src/components/CardTable/Decorator/DefaultCardWeb.vue

src/components/CardTable/Decorator/DefaultCardMobile.vue

src/components/CardTable/Header/DefaultCardHeader.vue

src/components/CardTable/Cell/DefaultCellContainer.vue

src/components/CardTable/Cell/Default.vue

src/components/CardTable/Cell/Actions.vue

src/components/CardTable/Cell/Checkbox.vue

src/components/CardTable/Cell/Truncate.vue

src/components/CardTable/Cell/Dropdown.vue

src/components/CardTable/Table/Table.vue

src/components/CardTable/Table/TableBody.vue

src/components/CardTable/Table/TableRow.vue

src/components/CardTable/Table/TableDataCell.vue

src/components/CardTable/Table/TableHeader.vue

src/components/CardTable/Table/TableHeaderCell.vue

src/components/CardTable/Table/TableFooter.vue

src/components/CardTable/Table/TableHeaderSortDropdown.vue

src/components/CardTable/types.ts

src/components/Chip/Chip.vue

src/components/Dialog/Dialog.vue

src/components/Dialog/Overlay.vue

src/components/Dialog/CloseButton.vue

src/components/Dialog/Container/Default.vue

src/components/DropdownMenu/DropdownMenu.vue

src/components/Form/Form.vue

src/components/Grid/Grid.vue

src/components/Grid/GridItem.vue

src/components/Icon/Icon.vue

src/components/InputField/InputField.vue

src/components/InputField/InputGroup.vue

src/components/Input/Input.vue

src/components/Input/CheckboxInput.vue

src/components/Input/RadioInput.vue

src/components/Input/SwitchInput.vue

src/components/Input/FileInput.vue

src/components/Input/DateInput.vue

src/components/Input/PasswordInput.vue

src/components/Input/Textarea/Textarea.vue

src/components/Input/Select/SelectInput.vue

src/components/Input/Select/SelectText.vue

src/components/Input/Select/SelectOption.vue

src/components/Input/Select/SelectDropdown.vue

src/components/Input/Select/navigation-mixin.ts

src/components/Input/MultiSelect/MultiSelectInput.vue

src/components/Input/MultiSelect/MultiSelectChips.vue

src/components/Input/MultiSelect/multiselect-input.scss

src/components/Input/Autocomplete/AutocompleteInput.vue

src/components/Input/Autocomplete/AutocompleteTextInput.vue

src/components/Input/Autocomplete/AutocompleteOption.vue

src/components/Input/Autocomplete/AutocompleteDropdown.vue

src/components/Input/Autocomplete/AutocompleteChips.vue

src/components/Input/Time/TimeInput.vue

src/components/Input/Time/TimePicker.vue

src/components/Input/Color/ColorInput.vue

src/components/Input/Color/ColorPicker.vue

src/components/Label/Label.vue

src/components/Loader/Spinner.vue

src/components/Pagination/Pagination.vue

src/components/Pagination/PageItem.vue

src/components/SidePanel/SidePanel.vue

src/components/SidePanel/MainMenu.vue

src/components/SidePanel/MainMenuItem.vue

src/components/SidePanel/Branding.vue

src/components/Table/ClassicTable.vue

src/components/Table/Table.vue

src/components/Table/TableRow.vue

src/components/Table/TableHeader.vue

src/components/Table/TableHeaderCell.vue

src/components/Table/TableDataCell.vue

src/components/Table/TableBody.vue

src/components/Table/TableFooter.vue

src/components/TableFilter/TableFilter.vue

src/components/Text/Text.vue

src/components/Toast/Toast.vue

src/components/Toast/Container.vue

src/components/Toast/CloseButton.vue

src/components/Toast/Icon.vue

src/components/Toast/toast-mixin.ts

src/components/Toast/types.ts

src/components/Topbar/Navigation.vue

src/components/Topbar/NavigationLink.vue

src/components/Topbar/NavigationMore.vue

Composables:

src/composables/useField.ts

src/composables/useFormValidation.ts

src/composables/useCardtable.ts

src/composables/useResponsive.ts

src/composables/useResize.ts

src/composables/usei18n.ts

src/composables/types.ts

src/utils/event-bus.ts

src/components/Calendar/Calendar.vue

src/components/Calendar/Date.vue

src/components/Calendar/Day.vue

src/components/Calendar/CalendarController.vue

src/components/Calendar/CalendarDropdown.vue

Main-app files (OrangeHRM 5.9):

src/client/src/core/util/services/api.service.ts

src/client/src/orangehrmPimPlugin/pages/employee/EmployeeList.vue

src/client/src/core/pages/Forbidden.vue (the auth-forbidden component)

src/client/src/core/pages/BadRequest.vue

src/client/src/core/components/inputs/EmployeeAutocomplete.vue

src/client/src/core/components/inputs/PasswordInput.vue

src/client/src/core/components/labels/PasswordStrengthIndicator.vue

src/client/src/core/components/labels/RequiredText.vue

src/client/src/core/components/tables/ReportsTable.vue

src/client/src/core/components/dialogs/ConfirmationDialog.vue

src/client/src/core/components/dialogs/DeleteConfirmationDialog.vue

src/client/src/core/components/buttons/SubmitButton.vue

app.js — greps for navigation.ts (buildUrl, navigate, reloadPage), APIService, usePaginate, $toast API surface, DeleteConfirmationDialog component definition, auth-forbidden in the public-component map.

Live HTTP trace:

GET /web/index.php/api/v2/pim/employees?limit=50&offset=0&model=detailed&includeEmployees=onlyCurrent&sortField=employee.firstName&sortOrder=ASC → 200 OK with {data, meta: {total}, rels}.

Live DB queries (from the DB doc, referenced for cross-layer context):

hs_hr_config.instance.version = 5.9.0

ohrm_screen, ohrm_user_role_screen, ohrm_user_role_data_group, ohrm_api_permission, ohrm_workflow_state_machine — as documented in the API and Auth docs.

End of document.
