const { SELECTORS, byLabelText } = require('../selectors');

class OxdSelect {
  constructor(page) {
    this.page = page;
  }

  trigger(labelText) {
    return this.page.locator(byLabelText(labelText)).locator(SELECTORS.selectTrigger);
  }

  async open(labelText) {
    await this.trigger(labelText).click();
    await this.page.locator(SELECTORS.selectDropdown).waitFor({ state: 'visible' });
  }

  async choose(labelText, optionText) {
    await this.page
      .locator(SELECTORS.selectDropdown)
      .getByRole('option', { name: optionText, exact: true })
      .click();
  }

  async select(labelText, optionText) {
    await this.open(labelText);
    await this.choose(labelText, optionText);
  }

  async selectedValue(labelText) {
    return (await this.trigger(labelText).innerText()).trim();
  }

  async autocomplete(labelText, query, optionText) {
    const field = this.page.locator(byLabelText(labelText)).locator(SELECTORS.autocompleteInput);
    await field.fill(query);
    await this.page
      .locator(`${SELECTORS.autocompleteDropdown} [role="option"]`)
      .filter({ hasText: optionText })
      .first()
      .click();
  }
}

module.exports = { OxdSelect };
