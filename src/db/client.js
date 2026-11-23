const { DbError } = require('./errors');

function assertReadOnlyStatement(sql) {
  const statement = sql
    .replace(
      /'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|`(?:``|[^`])*`|--[^\r\n]*|#[^\r\n]*|\/\*[\s\S]*?\*\//g,
      ' ',
    )
    .trim();

  if (
    !/^SELECT\b/i.test(statement) ||
    /\b(?:INTO|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE)\b/i.test(statement) ||
    /\b(?:GET_LOCK|RELEASE_LOCK|RELEASE_ALL_LOCKS|SLEEP|BENCHMARK)\s*\(/i.test(statement) ||
    statement.includes(':=')
  ) {
    throw new TypeError(
      'Database client is read-only; only non-locking SELECT queries are allowed',
    );
  }
}

class DbClient {
  #pool;
  #connection;

  constructor(pool, connection = null) {
    if (typeof pool?.getConnection !== 'function' || typeof pool?.end !== 'function') {
      throw new TypeError('A database pool with getConnection() and end() is required');
    }

    this.#pool = pool;
    this.#connection = connection;
  }

  async select(sql, params = []) {
    return this.#run(sql, params, async (connection) => {
      const [rows] = await connection.execute(sql, params);
      return rows;
    });
  }

  async selectOne(sql, params = []) {
    const rows = await this.select(sql, params);
    return rows[0] ?? null;
  }

  async selectValue(sql, params = []) {
    const row = await this.selectOne(sql, params);
    return row ? (Object.values(row)[0] ?? null) : null;
  }

  async execute() {
    throw new TypeError('Database client is read-only; write statements are not supported');
  }

  async deleteWhere() {
    throw new TypeError('Database client is read-only; deleteWhere is not supported');
  }

  async transaction(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('transaction requires a callback');
    }
    if (this.#connection) {
      throw new TypeError('Nested database transactions are not supported');
    }

    let connection;
    try {
      connection = await this.#pool.getConnection();
    } catch (error) {
      throw DbError.fromMysql(error);
    }

    let transactionStarted = false;
    try {
      try {
        await connection.beginTransaction();
        transactionStarted = true;
      } catch (error) {
        throw DbError.fromMysql(error, 'START TRANSACTION', []);
      }

      const scopedClient = new DbClient(this.#pool, connection);
      const result = await fn(scopedClient);

      try {
        await connection.commit();
        transactionStarted = false;
      } catch (error) {
        throw DbError.fromMysql(error, 'COMMIT', []);
      }

      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          const rollbackDbError = DbError.fromMysql(rollbackError, 'ROLLBACK', []);
          throw new AggregateError(
            [error, rollbackDbError],
            'Database transaction failed and rollback also failed',
            { cause: rollbackError },
          );
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async close() {
    if (this.#connection) {
      throw new TypeError('A transaction-scoped database client cannot close the pool');
    }
    await this.#pool.end();
  }

  async #run(sql, params, operation) {
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new TypeError('SQL must be a non-empty string');
    }
    if (!Array.isArray(params)) {
      throw new TypeError('SQL parameters must be an array');
    }
    assertReadOnlyStatement(sql);

    let connection = this.#connection;
    try {
      if (!connection) {
        connection = await this.#pool.getConnection();
      }
      return await operation(connection);
    } catch (error) {
      throw DbError.fromMysql(error, sql, params);
    } finally {
      if (connection && !this.#connection) {
        connection.release();
      }
    }
  }
}

module.exports = { DbClient };
