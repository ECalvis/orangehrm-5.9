const { createEmployeeLifecycle } = require('./employee-lifecycle');
const { terminateOwnedEmployee } = require('./terminate-employee');
const { createTestIdentity } = require('./test-data');
const { createLeaveLifecycle, cleanupLeaveLifecycle } = require('./leave-lifecycle');
const { createAttendanceLifecycle } = require('./attendance-lifecycle');
const { createTimesheetLifecycle, cleanupTimesheetLifecycle } = require('./timesheet-lifecycle');
const {
  createUserRbacLifecycle,
  cleanupUserRbacLifecycle,
  disableOwnedUser,
} = require('./user-rbac-lifecycle');

module.exports = {
  createEmployeeLifecycle,
  terminateOwnedEmployee,
  createTestIdentity,
  createLeaveLifecycle,
  cleanupLeaveLifecycle,
  createAttendanceLifecycle,
  createTimesheetLifecycle,
  cleanupTimesheetLifecycle,
  createUserRbacLifecycle,
  cleanupUserRbacLifecycle,
  disableOwnedUser,
};
