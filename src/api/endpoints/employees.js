const { collectionMeta, deletedIds, emptyMeta } = require('../schemas/common');
const {
  employeeCreateBody,
  employeeDeleteBody,
  employeeDetailedModel,
  employeeGetQuery,
  employeeListQuery,
  employeeModel,
} = require('../schemas/employees');

const employeeData = { anyOf: [employeeModel, employeeDetailedModel] };

const employeeRoutes = {
  list: {
    method: 'GET',
    path: '/pim/employees',
    querySchema: employeeListQuery,
    responseSchema: { type: 'array', items: employeeData },
    metaSchema: collectionMeta,
  },
  get: {
    method: 'GET',
    path: '/pim/employees/{empNumber}',
    querySchema: employeeGetQuery,
    responseSchema: employeeData,
    metaSchema: emptyMeta,
  },
  create: {
    method: 'POST',
    path: '/pim/employees',
    bodySchema: employeeCreateBody,
    responseSchema: employeeModel,
    metaSchema: emptyMeta,
  },
  update: {
    method: 'PUT',
    path: '/pim/employees/{empNumber}',
  },
  delete: {
    method: 'DELETE',
    path: '/pim/employees',
    bodySchema: employeeDeleteBody,
    responseSchema: deletedIds,
    metaSchema: emptyMeta,
  },
  count: {
    method: 'GET',
    path: '/pim/employees/count',
  },
};

module.exports = { employeeRoutes };
