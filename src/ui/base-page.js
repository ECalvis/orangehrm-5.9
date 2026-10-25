const { SELECTORS } = require('./selectors');

class BasePage {
  constructor(page, baseUrl) {
    if (!page) {
      throw new TypeError('A Playwright page is required');
    }
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
      throw new TypeError('A non-empty base URL is required');
    }

    this.page = page;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async goto(path) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError('The page path must be an absolute path starting with "/"');
    }

    await this.page.goto(`${this.baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
    await this.waitForReady();
  }

  async waitForReady() {
    await this.page.locator(SELECTORS.sidepanel).waitFor({ state: 'attached' });
  }

  async navigateSidebar(label) {
    await this.page
      .locator(SELECTORS.sidepanelNav)
      .getByRole('link', { name: label, exact: true })
      .click();
    await this.page.waitForLoadState('domcontentloaded');
    await this.waitForReady();
  }

  async navigateTopbar(label) {
    await this.page
      .locator(SELECTORS.topbarNav)
      .getByRole('link', { name: label, exact: true })
      .click();
    await this.page.waitForLoadState('domcontentloaded');
    await this.waitForReady();
  }

  async currentUrl() {
    return this.page.url();
  }

  async title() {
    return this.page.title();
  }
}

module.exports = { BasePage };
