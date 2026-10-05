const { LoginPage } = require('../pages/login-page');

async function login(page, baseUrl, userOrRole = 'admin') {
  const loginPage = new LoginPage(page, baseUrl);
  await loginPage.loginAs(userOrRole);
}

module.exports = { login };
