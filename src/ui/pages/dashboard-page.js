const { BasePage } = require('../base-page');

class DashboardPage extends BasePage {
  async goto() {
    await super.goto('/web/index.php/dashboard/index');
  }
}

module.exports = { DashboardPage };
