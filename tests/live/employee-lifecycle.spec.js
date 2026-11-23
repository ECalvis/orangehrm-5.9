const { expect, test } = require('@playwright/test');

const env = require('../../src/config/env');
const { createUi } = require('../../src/ui');
const { createEmployeeLifecycle } = require('../../src/workflows/employee-lifecycle');
const { createTestIdentity } = require('../../src/workflows/test-data');
const { terminateOwnedEmployee } = require('../../src/workflows/terminate-employee');
const { createLiveApi, createLiveDb } = require('./live-support');

test.describe('Live employee lifecycle workflow', () => {
  test.skip(
    process.env.OHRM_RUN_MUTATING_LIVE_TESTS !== 'true',
    'Set OHRM_RUN_MUTATING_LIVE_TESTS=true to create and terminate a uniquely identified employee',
  );

  test('creates via API, updates through UI, verifies API/DB, then terminates via OrangeHRM', async ({
    page,
  }, testInfo) => {
    const api = createLiveApi('admin');
    const db = createLiveDb();
    const ui = createUi(page, env.baseUrl);
    const identity = createTestIdentity();
    const owner = `employee-lifecycle-${identity.tag}`;
    const employee = {
      firstName: 'QA',
      middleName: '',
      lastName: identity.tag,
      employeeId: identity.employeeId,
    };
    const updatedMiddleName = `M${identity.employeeId}`;
    let ownedRecord;
    let workflowError;
    const followUpErrors = [];

    try {
      ownedRecord = await createEmployeeLifecycle({
        api,
        db,
        ui,
        employee,
        owner,
        updatedMiddleName,
      });
      await testInfo.attach('owned-employee.json', {
        body: JSON.stringify(ownedRecord, null, 2),
        contentType: 'application/json',
      });
      expect(ownedRecord.employee.middleName).toBe(updatedMiddleName);
    } catch (error) {
      workflowError = error;
      ownedRecord = error.testRecord ?? ownedRecord;
    }

    if (ownedRecord) {
      try {
        const termination = await terminateOwnedEmployee({
          api,
          db,
          empNumber: ownedRecord.empNumber,
          employeeId: ownedRecord.employeeId,
          owner,
        });
        await testInfo.attach('employee-lifecycle-cleanup.json', {
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
        'Employee workflow and one or more follow-up operations failed',
      );
    }
    if (workflowError) {
      throw workflowError;
    }
    if (followUpErrors.length > 0) {
      throw new AggregateError(followUpErrors, 'Employee cleanup or database close failed');
    }
  });
});
