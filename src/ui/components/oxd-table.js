const { SELECTORS, iconButton } = require('../selectors');

class OxdTable {
  constructor(page) {
    this.page = page;
  }

  root() {
    return this.page.locator(SELECTORS.cardTable);
  }

  rows() {
    return this.page.locator(SELECTORS.cardTableCard);
  }

  async rowCount() {
    return this.rows().count();
  }

  rowByText(text) {
    return this.rows().filter({ hasText: text }).first();
  }

  checkboxInRow(text) {
    return this.rowByText(text).locator(SELECTORS.cardTableCheckbox).getByRole('checkbox');
  }

  actionInRow(text, actionName) {
    return this.rowByText(text)
      .locator(SELECTORS.cardTableActions)
      .locator(`button:has(${iconButton(actionName)})`);
  }

  async clickAction(text, actionName) {
    await this.actionInRow(text, actionName).click();
  }

  selectAllCheckbox() {
    return this.page.locator(SELECTORS.cardTableHeaderCell).getByRole('checkbox').first();
  }

  async sortBy(columnName, direction = 'asc') {
    if (direction !== 'asc' && direction !== 'desc') {
      throw new TypeError('Sort direction must be "asc" or "desc"');
    }

    const header = this.page.locator(SELECTORS.cardTableHeaderCell).filter({ hasText: columnName });
    await header.locator(SELECTORS.cardTableSortDropdown).click();
    await this.page
      .getByRole('menuitem', {
        name: new RegExp(direction === 'asc' ? 'Ascending' : 'Descending', 'i'),
      })
      .click();
  }

  async waitForLoad() {
    await this.page.locator(SELECTORS.cardTableLoader).waitFor({ state: 'detached' });
  }

  async waitForRowCount(count) {
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError('Row count must be a non-negative integer');
    }

    await this.page.waitForFunction(
      ({ selector, expectedCount }) =>
        globalThis.document.querySelectorAll(selector).length === expectedCount,
      { selector: SELECTORS.cardTableCard, expectedCount: count },
    );
  }
}

module.exports = { OxdTable };
