const MYSQL_CODE_MAP = {
  ECONNREFUSED: 'CONN_REFUSED',
  ER_ACCESS_DENIED_ERROR: 'AUTH_FAILED',
  ER_BAD_DB_ERROR: 'NO_DATABASE',
  ER_DUP_ENTRY: 'DUPLICATE_KEY',
  ER_NO_REFERENCED_ROW: 'FK_MISSING',
  ER_NO_REFERENCED_ROW_2: 'FK_MISSING',
  ER_ROW_IS_REFERENCED: 'FK_IN_USE',
  ER_ROW_IS_REFERENCED_2: 'FK_IN_USE',
  ER_LOCK_WAIT_TIMEOUT: 'LOCK_TIMEOUT',
  ER_LOCK_DEADLOCK: 'DEADLOCK',
};

class DbError extends Error {
  constructor(message, { code, sqlState, sqlMessage, sql, params, raw } = {}) {
    super(message);

    this.name = 'DbError';
    this.code = code;
    this.sqlState = sqlState;
    this.sqlMessage = sqlMessage;
    this.sql = sql ? String(sql).slice(0, 500) : undefined;
    this.params = params;
    this.raw = raw;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  static fromMysql(err, sql, params) {
    if (err instanceof DbError) {
      return err;
    }

    return new DbError(err.message, {
      code: MYSQL_CODE_MAP[err.code] || 'UNKNOWN',
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage,
      sql,
      params,
      raw: err,
    });
  }
}

module.exports = { DbError };
