const { DbClient } = require('./client');
const { createPool } = require('./pool');
const { EmployeesRepository } = require('./repositories/employees');
const { PermissionsRepository } = require('./repositories/permissions');
const { WorkflowRecordsRepository } = require('./repositories/workflow-records');

function createDb({ host, port, user, password, database, connectionLimit } = {}) {
  const pool = createPool({ host, port, user, password, database, connectionLimit });
  const client = new DbClient(pool);

  return {
    client,
    employees: new EmployeesRepository(client),
    permissions: new PermissionsRepository(client),
    workflowRecords: new WorkflowRecordsRepository(client),
    close: () => client.close(),
  };
}

module.exports = { createDb };
