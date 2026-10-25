const { SELECTORS } = require('../selectors');

class OxdToast {
  constructor(page) {
    this.page = page;
  }

  last() {
    return this.page.locator(SELECTORS.toast).last();
  }

  async waitForSuccess(text) {
    const toast = this.page.locator(SELECTORS.toastSuccess).last();
    await toast.waitFor({ state: 'visible' });
    if (text) {
      await toast.getByText(text).waitFor({ state: 'visible' });
    }
  }

  async waitForError(text) {
    const toast = this.page.locator(SELECTORS.toastError).last();
    await toast.waitFor({ state: 'visible' });
    if (text) {
      await toast.getByText(text).waitFor({ state: 'visible' });
    }
  }

  async text() {
    return (await this.last().innerText()).trim();
  }

  async dismiss() {
    await this.last().click();
  }
}

module.exports = { OxdToast };
