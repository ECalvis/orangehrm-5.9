const { expect, test } = require('@playwright/test');

const env = require('../../src/config/env');
const { createUi } = require('../../src/ui');
const {
  cleanupTimesheetLifecycle,
  createTimesheetLifecycle,
} = require('../../src/workflows/timesheet-lifecycle');
const { createTestIdentity } = require('../../src/workflows/test-data');
const { createLiveApi, createLiveDb } = require('./live-support');

test.describe('Live timesheet lifecycle workflow', () => {
  test.skip(
    process.env.OHRM_RUN_MUTATING_LIVE_TESTS !== 'true',
    'Set OHRM_RUN_MUTATING_LIVE_TESTS=true to create and approve an owned timesheet',
  );

  test('creates, submits, approves and verifies an owned timesheet, then terminates its employee', async ({
    page,
  }, testInfo) => {
    const api = createLiveApi('admin');
    const db = createLiveDb();
    const ui = createUi(page, env.baseUrl);
    const identity = createTestIdentity();
    const owner = `timesheet-${identity.tag}`;
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
      const period = (await api.time.defaultTimesheet.get()).data;
      if (!period?.startDate || !period?.endDate) {
        throw new Error('Default timesheet period did not contain startDate and endDate');
      }

      record = await createTimesheetLifecycle({
        api,
        db,
        ui,
        employee,
        owner,
        date: period.startDate,
        duration: '01:15',
      });
      await testInfo.attach('owned-timesheet.json', {
        body: JSON.stringify(record, null, 2),
        contentType: 'application/json',
      });
      expect(record.state).toBe('APPROVED');
    } catch (error) {
      workflowError = error;
      record = error.testRecord ?? record;
      if (record) {
        try {
          await testInfo.attach('owned-timesheet-after-failure.json', {
            body: JSON.stringify(record, null, 2),
            contentType: 'application/json',
          });
        } catch (attachmentError) {
          followUpErrors.push(attachmentError);
        }
      }
    }

    if (record?.employeeId) {
      try {
        const cleanup = await cleanupTimesheetLifecycle({ api, db, record });
        await testInfo.attach('timesheet-lifecycle-cleanup.json', {
          body: JSON.stringify(cleanup, null, 2),
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
        'Timesheet workflow and one or more cleanup operations failed',
      );
    }
    if (workflowError) {
      throw workflowError;
    }
    if (followUpErrors.length > 0) {
      throw new AggregateError(followUpErrors, 'Timesheet cleanup or database close failed');
    }
  });
});
