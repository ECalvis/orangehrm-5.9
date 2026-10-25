const { AdminUsersPage } = require('../pages/admin-users-page');
const { OxdToast } = require('../components/oxd-toast');

async function createUser(page, baseUrl, user) {
  const usersPage = new AdminUsersPage(page, baseUrl);
  await usersPage.goto();
  await usersPage.createUser(user);
  await new OxdToast(page).waitForSuccess();
}

module.exports = { createUser };
