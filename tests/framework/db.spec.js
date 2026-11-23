const { expect, test } = require('@playwright/test');

const { DbClient } = require('../../src/db/client');
const { DbError } = require('../../src/db/errors');
const { toCamel, toSnake } = require('../../src/db/row');

function createConnection({ execute, failures = {} } = {}) {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (failures.execute) {
        throw failures.execute;
      }
      return execute ? execute(sql, params) : [[], []];
    },
    async beginTransaction() {
      calls.push({ method: 'beginTransaction' });
      if (failures.beginTransaction) {
        throw failures.beginTransaction;
      }
    },
    async commit() {
      calls.push({ method: 'commit' });
      if (failures.commit) {
        throw failures.commit;
      }
    },
    async rollback() {
      calls.push({ method: 'rollback' });
      if (failures.rollback) {
        throw failures.rollback;
      }
    },
    release() {
      calls.push({ method: 'release' });
    },
  };
  return { connection, calls };
}

function createPool(connection) {
  let acquisitions = 0;
  let closes = 0;
  return {
    async getConnection() {
      acquisitions += 1;
      return connection;
    },
    async end() {
      closes += 1;
    },
    get acquisitions() {
      return acquisitions;
    },
    get closes() {
      return closes;
    },
  };
}

test.describe('database client', () => {
  test('executes parameterized queries and releases each acquired connection', async () => {
    const { connection, calls } = createConnection({
      execute: async () => [[{ emp_number: 7, emp_firstname: 'Ada' }], []],
    });
    const pool = createPool(connection);
    const client = new DbClient(pool);

    await expect(client.selectOne('SELECT * FROM employee WHERE id = ?', [7])).resolves.toEqual({
      emp_number: 7,
      emp_firstname: 'Ada',
    });
    await expect(client.selectValue('SELECT COUNT(*) AS n')).resolves.toBe(7);
    await expect(client.execute('UPDATE employee SET name = ?', ['Ada'])).resolves.toEqual({
      affectedRows: 0,
      insertId: null,
      changedRows: 0,
    });

    expect(pool.acquisitions).toBe(3);
    expect(calls.filter((call) => call.method === 'release')).toHaveLength(3);
  });

  test('normalizes MySQL failures with query context', async () => {
    const mysqlError = Object.assign(new Error('Duplicate value'), {
      code: 'ER_DUP_ENTRY',
      sqlState: '23000',
      sqlMessage: 'Duplicate value',
    });
    const { connection, calls } = createConnection({ failures: { execute: mysqlError } });
    const client = new DbClient(createPool(connection));

    await expect(client.execute('INSERT INTO t VALUES (?)', ['value'])).rejects.toMatchObject({
      name: 'DbError',
      code: 'DUPLICATE_KEY',
      sqlState: '23000',
      sqlMessage: 'Duplicate value',
      sql: 'INSERT INTO t VALUES (?)',
      params: ['value'],
      raw: mysqlError,
    });
    expect(calls.filter((call) => call.method === 'release')).toHaveLength(1);
  });

  test('scopes transaction queries to one connection and commits on success', async () => {
    const { connection, calls } = createConnection();
    const pool = createPool(connection);
    const client = new DbClient(pool);

    await expect(
      client.transaction(async (tx) => {
        await tx.execute('UPDATE t SET value = ?', [1]);
        return 'committed';
      }),
    ).resolves.toBe('committed');

    expect(pool.acquisitions).toBe(1);
    expect(calls.map((call) => call.method).filter(Boolean)).toEqual([
      'beginTransaction',
      'commit',
      'release',
    ]);
  });

  test('rolls back on callback errors and surfaces rollback failures', async () => {
    const callbackError = new Error('Callback failed');
    const firstConnection = createConnection();
    const firstClient = new DbClient(createPool(firstConnection.connection));
    await expect(firstClient.transaction(() => Promise.reject(callbackError))).rejects.toBe(
      callbackError,
    );
    expect(firstConnection.calls.map((call) => call.method)).toEqual([
      'beginTransaction',
      'rollback',
      'release',
    ]);

    const rollbackError = new Error('Rollback failed');
    const secondConnection = createConnection({ failures: { rollback: rollbackError } });
    const secondClient = new DbClient(createPool(secondConnection.connection));
    try {
      await secondClient.transaction(() => Promise.reject(callbackError));
      throw new Error('Expected transaction to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.message).toBe('Database transaction failed and rollback also failed');
      expect(error.cause).toBe(rollbackError);
      expect(error.errors[0]).toBe(callbackError);
      expect(error.errors[1]).toBeInstanceOf(DbError);
    }
  });

  test('maps unknown MySQL errors without losing the raw error', () => {
    const raw = Object.assign(new Error('Connection lost'), { code: 'ECONNRESET' });
    expect(DbError.fromMysql(raw).code).toBe('UNKNOWN');
    expect(DbError.fromMysql(raw).raw).toBe(raw);
  });
});

test.describe('database row helpers', () => {
  test('convert row keys only when explicitly requested', () => {
    expect(toCamel({ emp_number: 3, alreadyCamel: null })).toEqual({
      empNumber: 3,
      alreadyCamel: null,
    });
    expect(toCamel(null)).toBeNull();
    expect(toSnake({ empNumber: 3, alreadySnake: null })).toEqual({
      emp_number: 3,
      already_snake: null,
    });
  });
});
