const { expect, test } = require('@playwright/test');

const env = require('../../src/config/env');
const { createUi } = require('../../src/ui');
const {
  cleanupUserRbacLifecycle,
  createUserRbacLifecycle,
} = require('../../src/workflows/user-rbac-lifecycle');
const { createTestIdentity } = require('../../src/workflows/test-data');
const { createLiveApi, createLiveDb } = require('./live-support');

test.describe('Live user creation and RBAC lifecycle workflow', () => {
  test.skip(
    process.env.OHRM_RUN_MUTATING_LIVE_TESTS !== 'true',
    'Set OHRM_RUN_MUTATING_LIVE_TESTS=true to create and disable a test-owned ESS account',
  );

  test('creates an ESS account, verifies allowed and denied UI access, then disables it', async (
    { page },
    testInfo,
  ) => {
    const api = createLiveApi('admin');
    const db = createLiveDb();
    const ui = createUi(page, env.baseUrl);
    const identity = createTestIdentity();
    const username = `qa_${identity.employeeId.toLowerCase()}`;
    const owner = `rbac-${identity.employeeId}`;
    const employee = {
      firstName: 'QA',
      middleName: '',
      lastName: identity.tag,
      employeeId: identity.employeeId,
    };
    const password = `Qa!${identity.employeeId.slice(2)}z9`;
    let record = {
      owner,
      username,
      employeeId: identity.employeeId,
      empNumber: null,
      userId: null,
    };
    let workflowError;
    const cleanupErrors = [];

    try {
      record = await createUserRbacLifecycle({
        api,
        db,
        ui,
        employee,
        owner,
        username,
        password,
      });
      await testInfo.attach('owned-user-rbac.json', {
        body: JSON.stringify(record, null, 2),
        contentType: 'application/json',
      });
      expect(record).toMatchObject({ role: 'ESS', state: 'disabled', employeeState: 'terminated' });
    } catch (error) {
      workflowError = error;
      record = error.testRecord ?? record;
    }

    if (record.empNumber != null) {
      try {
        const cleanup = await cleanupUserRbacLifecycle({ api, db, record, password });
        await testInfo.attach('user-rbac-recovery.json', {
          body: JSON.stringify(cleanup, null, 2),
          contentType: 'application/json',
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    try {
      await db.close();
    } catch (error) {
      cleanupErrors.push(error);
    }

    if (workflowError && cleanupErrors.length > 0) {
      throw new AggregateError(
        [workflowError, ...cleanupErrors],
        'User/RBAC workflow and one or more cleanup operations failed',
      );
    }
    if (workflowError) {
      throw workflowError;
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'User/RBAC cleanup or database close failed');
    }
  });
});
