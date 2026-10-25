const { SELECTORS } = require('../selectors');

class OxdDialog {
  constructor(page) {
    this.page = page;
  }

  root() {
    return this.page.locator(SELECTORS.overlay);
  }

  async waitFor() {
    await this.root().waitFor({ state: 'visible' });
  }

  async text() {
    return (await this.root().innerText()).trim();
  }

  async confirm() {
    const dialog = this.root();
    await dialog
      .locator('button.oxd-button--secondary, button.oxd-button--label-danger')
      .last()
      .click();
    await dialog.waitFor({ state: 'detached' });
  }

  async cancel() {
    const dialog = this.root();
    await dialog.locator('button.oxd-button--ghost').first().click();
    await dialog.waitFor({ state: 'detached' });
  }
}

module.exports = { OxdDialog };
