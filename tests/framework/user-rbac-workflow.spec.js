const { expect, test } = require('@playwright/test');

const { disableOwnedUser } = require('../../src/workflows/user-rbac-lifecycle');

test.describe('cross-layer user and RBAC lifecycle workflow', () => {
  test('disables only the owned ESS account and verifies the API and database state', async () => {
    const calls = [];
    const user = {
      id: 8,
      emp_number: 42,
      user_name: 'qa_owned_user',
      user_role_id: 2,
      status: 1,
      deleted: 0,
    };
    const api = {
      admin: {
        users: {
          async update(input) {
            calls.push(['user.update', input]);
            user.status = 0;
          },
          async get(id) {
            calls.push(['user.get', id]);
            return { data: { status: false } };
          },
        },
      },
    };
    const db = {
      workflowRecords: {
        async findUserById(id) {
          calls.push(['user.find', id]);
          return user;
        },
      },
    };

    await expect(
      disableOwnedUser({
        api,
        db,
        record: { userId: 8, username: 'qa_owned_user', empNumber: 42 },
        password: 'Test!Password9',
      }),
    ).resolves.toMatchObject({ userId: 8, state: 'disabled' });
    const updateCall = calls.find(([name]) => name === 'user.update');
    expect(updateCall[1]).toMatchObject({
      pathParams: { id: 8 },
      data: {
        username: 'qa_owned_user',
        changePassword: false,
        status: false,
        userRoleId: 2,
        empNumber: 42,
      },
    });
  });

  test('refuses to disable a user linked to a different employee', async () => {
    let updates = 0;
    await expect(
      disableOwnedUser({
        api: {
          admin: { users: { update: async () => (updates += 1), get: async () => ({}) } },
        },
        db: {
          workflowRecords: {
            findUserById: async () => ({
              id: 8,
              emp_number: 99,
              user_name: 'qa_owned_user',
              user_role_id: 2,
              status: 1,
              deleted: 0,
            }),
          },
        },
        record: { userId: 8, username: 'qa_owned_user', empNumber: 42 },
        password: 'Test!Password9',
      }),
    ).rejects.toThrow('Ownership check failed');
    expect(updates).toBe(0);
  });
});
