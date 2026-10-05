const { LeaveListPage } = require('../pages/leave-list-page');
const { OxdToast } = require('../components/oxd-toast');

async function applyLeave(page, baseUrl, leave) {
  const leavePage = new LeaveListPage(page, baseUrl);
  await leavePage.applyLeave(leave);
  await new OxdToast(page).waitForSuccess();
}

module.exports = { applyLeave };
