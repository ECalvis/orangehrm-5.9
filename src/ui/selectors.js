const SELECTORS = Object.freeze({
  sidepanel: 'aside.oxd-sidepanel',
  sidepanelNav: 'nav[aria-label="Sidepanel"]',
  mainMenuItem: '.oxd-main-menu-item',
  mainMenuItemName: '.oxd-main-menu-item--name',
  topbarNav: 'nav[aria-label="Topbar Menu"]',
  topbarTabItem: '.oxd-topbar-body-nav-tab-item',
  topbarTabLink: '.oxd-topbar-body-nav-tab-link',

  form: 'form.oxd-form',
  formLoader: '.oxd-form-loader',
  inputGroup: '.oxd-input-group',
  inputGroupLabel: '.oxd-input-group__label',
  inputFieldError: '.oxd-input-field-error-message',
  input: 'input.oxd-input',
  textarea: 'textarea.oxd-textarea',
  formActions: '.oxd-form-actions',

  selectTrigger: '.oxd-select-text-input',
  selectDropdown: '.oxd-select-dropdown',
  selectOption: '.oxd-select-option',
  multiselectChips: '.oxd-multiselect-chips-area',
  autocompleteInput: '.oxd-autocomplete-text-input input',
  autocompleteDropdown: '.oxd-autocomplete-dropdown',

  dateWrapper: '.oxd-date-wrapper',
  dateInput: '.oxd-date-input input.oxd-input',
  dateCalendar: '.oxd-calendar-wrapper',
  dateShortcutToday: '.oxd-date-input-links a:has-text("Today")',
  dateShortcutClear: '.oxd-date-input-links a:has-text("Clear")',

  cardTable: '.oxd-table',
  cardTableHeaderCell: '.oxd-table-header-cell',
  cardTableCard: '.oxd-table-card',
  cardTableRow: '.oxd-table-row',
  cardTableCell: '.oxd-table-cell',
  cardTableActions: '.oxd-table-cell-actions',
  cardTableCheckbox: '.oxd-table-card-cell-checkbox',
  cardTableLoader: '.oxd-table-loader',
  cardTableSortDropdown: '.oxd-table-header-sort-dropdown',

  overlay: '.oxd-overlay[role="dialog"]',
  dialogSheet: '.oxd-dialog-sheet',
  dialogClose: '.oxd-dialog-close-button',

  toastContainer: '.oxd-toast-container',
  toast: '.oxd-toast',
  toastSuccess: '.oxd-toast--success',
  toastError: '.oxd-toast--error',
  alert: '.oxd-alert[role="alert"]',

  spinner: '.oxd-loading-spinner',
  pagination: '.oxd-pagination',
  loginUsername: 'input[name="username"]',
  loginPassword: 'input[name="password"]',
});

function byLabelText(label) {
  return `${SELECTORS.inputGroup}:has(${SELECTORS.inputGroupLabel}:text-is(${JSON.stringify(label)}))`;
}

function iconButton(iconName) {
  return `.oxd-icon.bi-${iconName}`;
}

module.exports = { SELECTORS, byLabelText, iconButton };
