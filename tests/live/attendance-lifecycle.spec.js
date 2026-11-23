const { expect, test } = require('@playwright/test');

const env = require('../../src/config/env');
const { createUi } = require('../../src/ui');
const { createAttendanceLifecycle } = require('../../src/workflows/attendance-lifecycle');
const { createTestIdentity } = require('../../src/workflows/test-data');
const { terminateOwnedEmployee } = require('../../src/workflows/terminate-employee');
const { createLiveApi, createLiveDb } = require('./live-support');

function timeBefore(currentTime, minutes) {
  const [hours, mins] = currentTime.split(':').map(Number);
  const total = hours * 60 + mins - minutes;
  if (total < 0) {
    throw new Error('The live UTC clock has not advanced far enough for a same-day punch pair');
  }
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

test.describe('Live attendance lifecycle workflow', () => {
  test.skip(
    process.env.OHRM_RUN_MUTATING_LIVE_TESTS !== 'true',
    'Set OHRM_RUN_MUTATING_LIVE_TESTS=true to create a uniquely identified employee and attendance record',
  );

  test('punches in and out through the authorized API, verifies DB/UI, then terminates the owned employee', async (
    { page },
    testInfo,
  ) => {
    const api = createLiveApi('admin');
    const db = createLiveDb();
    const ui = createUi(page, env.baseUrl);
    const identity = createTestIdentity();
    const owner = `attendance-${identity.employeeId}`;
    const employee = {
      firstName: 'QA',
      middleName: '',
      lastName: identity.tag,
      employeeId: identity.employeeId,
    };
    let record;
    let workflowError;
    const followUpErrors = [];

    try {
      const current = (await api.attendance.currentDateTime.get()).data;
      const nowMinutes =
        Number(current.utcTime.slice(0, 2)) * 60 + Number(current.utcTime.slice(3, 5));
      if (nowMinutes < 30) {
        throw new Error('Run the attendance workflow after 00:30 UTC to avoid a cross-day punch pair');
      }

      record = await createAttendanceLifecycle({
        api,
        db,
        ui,
        employee,
        owner,
        date: current.utcDate,
        punchInTime: timeBefore(current.utcTime, 25),
        punchOutTime: timeBefore(current.utcTime, 5),
        timezoneName: 'UTC',
        timezoneOffset: '0.0',
      });
      await testInfo.attach('owned-attendance.json', {
        body: JSON.stringify(record, null, 2),
        contentType: 'application/json',
      });
      expect(record.state).toBe('PUNCHED OUT');
    } catch (error) {
      workflowError = error;
      record = error.testRecord ?? record;
    }

    if (record?.empNumber) {
      try {
        const termination = await terminateOwnedEmployee({
          api,
          db,
          empNumber: record.empNumber,
          employeeId: record.employeeId,
          owner,
        });
        await testInfo.attach('attendance-employee-termination.json', {
          body: JSON.stringify(termination, null, 2),
          contentType: 'application/json',
        });
      } catch (error) {
        followUpErrors.push(error);
      }
    }

    try {
      await db.close();
    } catch (error) {
      followUpErrors.push(error);
    }

    if (workflowError && followUpErrors.length > 0) {
      throw new AggregateError(
        [workflowError, ...followUpErrors],
        'Attendance workflow and one or more cleanup operations failed',
      );
    }
    if (workflowError) {
      throw workflowError;
    }
    if (followUpErrors.length > 0) {
      throw new AggregateError(followUpErrors, 'Attendance cleanup or database close failed');
    }
  });
});
