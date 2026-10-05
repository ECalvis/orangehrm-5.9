const mysql = require('mysql2/promise');

function createPool({ host, port, user, password, database, connectionLimit = 10 } = {}) {
  if (typeof host !== 'string' || !host.trim()) {
    throw new TypeError('Database host is required');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('Database port must be an integer between 1 and 65535');
  }
  if (typeof user !== 'string' || !user) {
    throw new TypeError('Database user is required');
  }
  if (typeof password !== 'string') {
    throw new TypeError('Database password must be a string');
  }
  if (typeof database !== 'string' || !database) {
    throw new TypeError('Database name is required');
  }
  if (!Number.isInteger(connectionLimit) || connectionLimit < 1) {
    throw new TypeError('Database connectionLimit must be a positive integer');
  }

  return mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    connectionLimit,
    waitForConnections: true,
    namedPlaceholders: false,
    timezone: 'Z',
    dateStrings: false,
    multipleStatements: false,
  });
}

module.exports = { createPool };
