const { BasePage } = require('../base-page');
const users = require('../../config/users');
const { SELECTORS } = require('../selectors');

class LoginPage extends BasePage {
  async goto() {
    await this.page.goto(`${this.baseUrl}/web/index.php/auth/login`, {
      waitUntil: 'domcontentloaded',
    });
    await this.page.locator(SELECTORS.loginUsername).waitFor({ state: 'visible' });
  }

  async loginAs(userOrRole = 'admin') {
    const credentials = typeof userOrRole === 'string' ? users[userOrRole] : userOrRole;

    if (
      !credentials ||
      typeof credentials.username !== 'string' ||
      typeof credentials.password !== 'string'
    ) {
      throw new TypeError('Login requires a configured role or { username, password } credentials');
    }

    await this.goto();
    await this.page.locator(SELECTORS.loginUsername).fill(credentials.username);
    await this.page.locator(SELECTORS.loginPassword).fill(credentials.password);
    await this.page.getByRole('button', { name: /login/i }).click();
    await this.waitForReady();
  }

  async logout() {
    await this.page.locator(SELECTORS.userDropdown).click();
    await this.page.getByRole('menuitem', { name: 'Logout', exact: true }).click();
    await this.page.locator(SELECTORS.loginUsername).waitFor({ state: 'visible' });
  }
}

module.exports = { LoginPage };
