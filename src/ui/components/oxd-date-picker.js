const { SELECTORS, byLabelText } = require('../selectors');

class OxdDatePicker {
  constructor(page) {
    this.page = page;
  }

  input(labelText) {
    return this.page.locator(byLabelText(labelText)).locator(SELECTORS.input);
  }

  async set(labelText, isoDate) {
    const input = this.input(labelText);
    await input.click();
    await input.fill(isoDate);
    await input.press('Tab');
  }

  async clear(labelText) {
    const input = this.input(labelText);
    await input.fill('');
    await input.press('Tab');
  }

  async open(labelText) {
    await this.input(labelText).click();
    await this.page.locator(SELECTORS.dateCalendar).waitFor({ state: 'visible' });
  }
}

module.exports = { OxdDatePicker };
