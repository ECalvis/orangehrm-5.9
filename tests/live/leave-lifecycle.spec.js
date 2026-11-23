const { expect, test } = require('@playwright/test');

const env = require('../../src/config/env');
const { createUi } = require('../../src/ui');
const { cleanupLeaveLifecycle, createLeaveLifecycle } = require('../../src/workflows/leave-lifecycle');
const { createTestIdentity } = require('../../src/workflows/test-data');
const { createLiveApi, createLiveDb } = require('./live-support');

function addDays(date, amount) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

async function nextBusinessDate(adminApi, period, currentDate) {
  let date = addDays(currentDate, 2);
  let weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  while (weekday === 0 || weekday === 6) {
    date = addDays(date, 1);
    weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  }

  if (date > period.endDate) {
    throw new Error('No future leave date remains in the configured leave period');
  }

  const holidays = await adminApi.leave.holidays.list({
    fromDate: date,
    toDate: addDays(date, 14),
  });
  const holidayDates = new Set((holidays.data ?? []).map((holiday) => holiday.date));
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidayDates.has(date)) {
      if (date >= period.startDate && date <= period.endDate) {
        return date;
      }
      break;
    }
    date = addDays(date, 1);
  }
  throw new Error('Could not find a future non-holiday leave date in the configured period');
}

test.describe('Live leave lifecycle workflow', () => {
  test.skip(
    process.env.OHRM_RUN_MUTATING_LIVE_TESTS !== 'true',
    'Set OHRM_RUN_MUTATING_LIVE_TESTS=true to provision and cancel a uniquely identified leave request',
  );

  test('provisions a leave type and entitlement, applies as ESS, approves, verifies balance, then cancels', async (
    { page },
    testInfo,
  ) => {
    const adminApi = createLiveApi('admin');
    const essApi = createLiveApi('ess');
    const db = createLiveDb();
    const ui = createUi(page, env.baseUrl);
    const identity = createTestIdentity('LV');
    const owner = `leave-${identity.employeeId}`;
    let record;
    let workflowError;
    const followUpErrors = [];

    try {
      const [employeeResult, leavePeriod, currentDateTime] = await Promise.all([
        essApi.pim.myself.get(),
        adminApi.leave.leavePeriod.get(),
        adminApi.attendance.currentDateTime.get(),
      ]);
      const period = leavePeriod?.meta?.currentLeavePeriod;
      if (!employeeResult?.data?.empNumber || !period?.startDate || !period?.endDate) {
        throw new Error('ESS employee or configured leave period was unavailable');
      }
      const fromDate = await nextBusinessDate(adminApi, period, currentDateTime.data.utcDate);
      record = await createLeaveLifecycle({
        adminApi,
        essApi,
        db,
        ui,
        employee: employeeResult.data,
        owner,
        leaveTypeName: `QA ${identity.employeeId}`,
        fromDate,
        toDate: fromDate,
        entitlementFromDate: period.startDate,
        entitlementToDate: period.endDate,
        entitlementDays: 1,
      });
      await testInfo.attach('owned-leave.json', {
        body: JSON.stringify(record, null, 2),
        contentType: 'application/json',
      });
      expect(record.state).toBe('SCHEDULED');
    } catch (error) {
      workflowError = error;
      record = error.testRecord ?? record;
    }

    if (record?.leaveTypeId) {
      try {
        const cleanup = await cleanupLeaveLifecycle({ adminApi, essApi, db, record });
        await testInfo.attach('leave-lifecycle-cleanup.json', {
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
        'Leave workflow and one or more cleanup operations failed',
      );
    }
    if (workflowError) {
      throw workflowError;
    }
    if (followUpErrors.length > 0) {
      throw new AggregateError(followUpErrors, 'Leave cleanup or database close failed');
    }
  });
});
