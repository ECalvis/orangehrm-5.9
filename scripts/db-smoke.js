const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');

dotenvExpand.expand(dotenv.config());

const { createDb } = require('../src/db');

/* eslint-disable no-console */

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const port = Number(required('OHRM_DB_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('OHRM_DB_PORT must be an integer between 1 and 65535');
  }

  const db = createDb({
    host: required('OHRM_DB_HOST'),
    port,
    user: required('OHRM_DB_USER'),
    password: process.env.OHRM_DB_PASSWORD ?? '',
    database: required('OHRM_DB_NAME'),
  });

  try {
    const employeeCount = await db.employees.countAll();
    if (typeof employeeCount !== 'number') {
      throw new TypeError(`Expected employee count to be a number, got ${typeof employeeCount}`);
    }
    console.log('employees:', employeeCount);

    const permissions = await db.permissions.rolePermissionsForApi(
      'OrangeHRM\\Pim\\Api\\EmployeeAPI',
    );
    if (permissions.length !== 4) {
      throw new Error(`Expected four employee API permission rows, got ${permissions.length}`);
    }
    console.log('employee API permissions:', JSON.stringify(permissions, null, 2));

    const actionAllowed = await db.permissions.isActionAllowed(3, 'NOT_EXIST', 'ADMIN', 1);
    if (!actionAllowed) {
      throw new Error('Expected the example workflow action to be allowed');
    }
    console.log('example workflow action allowed:', actionAllowed);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error('\nDatabase smoke check failed:');
  console.error(error);
  process.exitCode = 1;
});
