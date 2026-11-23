const { DbError } = require('./errors');

function assertSafeDeleteTarget(table, conditions) {
  if (typeof table !== 'string' || !/^[A-Za-z_][A-Za-z\d_]*$/.test(table)) {
    throw new TypeError('Delete table must be a simple SQL identifier');
  }
  if (
    !conditions ||
    typeof conditions !== 'object' ||
    Array.isArray(conditions) ||
    Object.keys(conditions).length === 0
  ) {
    throw new TypeError('deleteWhere requires at least one condition');
  }
  for (const [column, value] of Object.entries(conditions)) {
    if (!/^[A-Za-z_][A-Za-z\d_]*$/.test(column)) {
      throw new TypeError(`Delete condition column must be a simple SQL identifier: ${column}`);
    }
    if (value === undefined) {
      throw new TypeError(`Delete condition value cannot be undefined: ${column}`);
    }
  }
}

function isDirectDestructiveStatement(sql) {
  const statement = sql.replace(
    /'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|`(?:``|[^`])*`|--[^\r\n]*|#[^\r\n]*|\/\*[\s\S]*?\*\//g,
    ' ',
  );
  return /\b(?:DELETE|TRUNCATE|DROP)\b/i.test(statement);
}

class DbClient {
  constructor(pool, connection = null) {
    if (typeof pool?.getConnection !== 'function' || typeof pool?.end !== 'function') {
      throw new TypeError('A database pool with getConnection() and end() is required');
    }

    this.pool = pool;
    this.connection = connection;
  }

  async select(sql, params = []) {
    return this._run(sql, params, async (connection) => {
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

  async execute(sql, params = []) {
    return this._execute(sql, params);
  }

  async deleteWhere(table, conditions) {
    assertSafeDeleteTarget(table, conditions);

    const entries = Object.entries(conditions);
    const params = [];
    const predicates = entries.map(([column, value]) => {
      const identifier = `\`${column}\``;
      if (value === null) {
        return `${identifier} IS NULL`;
      }
      params.push(value);
      return `${identifier} = ?`;
    });
    const sql = `DELETE FROM \`${table}\` WHERE ${predicates.join(' AND ')}`;

    return this._execute(sql, params, true);
  }

  async _execute(sql, params, allowDestructive = false) {
    return this._run(
      sql,
      params,
      async (connection) => {
        const [result] = await connection.execute(sql, params);
        return {
          affectedRows: result.affectedRows ?? 0,
          insertId: result.insertId ?? null,
          changedRows: result.changedRows ?? 0,
        };
      },
      allowDestructive,
    );
  }

  async transaction(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('transaction requires a callback');
    }
    if (this.connection) {
      throw new TypeError('Nested database transactions are not supported');
    }

    let connection;
    try {
      connection = await this.pool.getConnection();
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

      const scopedClient = new DbClient(this.pool, connection);
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
    if (this.connection) {
      throw new TypeError('A transaction-scoped database client cannot close the pool');
    }
    await this.pool.end();
  }

  async _run(sql, params, operation, allowDestructive = false) {
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new TypeError('SQL must be a non-empty string');
    }
    if (!Array.isArray(params)) {
      throw new TypeError('SQL parameters must be an array');
    }
    if (!allowDestructive && isDirectDestructiveStatement(sql)) {
      throw new TypeError('Direct destructive SQL is not allowed; use deleteWhere with conditions');
    }

    let connection = this.connection;
    try {
      if (!connection) {
        connection = await this.pool.getConnection();
      }
      return await operation(connection);
    } catch (error) {
      throw DbError.fromMysql(error, sql, params);
    } finally {
      if (connection && !this.connection) {
        connection.release();
      }
    }
  }
}

module.exports = { DbClient };
