const { SELECTORS, byLabelText } = require('../selectors');

class OxdForm {
  constructor(page) {
    this.page = page;
  }

  group(labelText) {
    return this.page.locator(byLabelText(labelText));
  }

  fieldByLabel(labelText) {
    return this.group(labelText)
      .locator(`${SELECTORS.input}, ${SELECTORS.textarea}, ${SELECTORS.selectTrigger}`)
      .first();
  }

  async fillByLabel(labelText, value) {
    const field = this.fieldByLabel(labelText);
    await field.scrollIntoViewIfNeeded();
    await field.fill(value);
  }

  async errorFor(labelText) {
    const error = this.group(labelText).locator(SELECTORS.inputFieldError);
    if ((await error.count()) === 0) {
      return null;
    }
    return (await error.first().innerText()).trim();
  }

  async submit() {
    await this.page
      .locator(SELECTORS.formActions)
      .getByRole('button', { name: /save|search|submit/i })
      .click();
  }

  async reset() {
    await this.page.locator(SELECTORS.formActions).getByRole('button', { name: /reset/i }).click();
  }

  async waitForLoad() {
    await this.page.locator(SELECTORS.formLoader).waitFor({ state: 'detached' });
  }
}

module.exports = { OxdForm };
