const employeeModel = {
  type: 'object',
  required: ['empNumber', 'lastName', 'firstName', 'middleName', 'employeeId', 'terminationId'],
  properties: {
    empNumber: { type: 'integer' },
    lastName: { type: 'string' },
    firstName: { type: 'string' },
    middleName: { type: 'string' },
    employeeId: { type: 'string' },
    terminationId: { type: ['integer', 'null'] },
  },
  additionalProperties: false,
};

const employeeDetailedModel = {
  ...employeeModel,
  properties: {
    ...employeeModel.properties,
    jobTitle: {
      type: 'object',
      required: ['id', 'title', 'isDeleted'],
      properties: {
        id: { type: ['integer', 'null'] },
        title: { type: ['string', 'null'] },
        isDeleted: { type: ['boolean', 'null'] },
      },
      additionalProperties: false,
    },
    subunit: {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: ['integer', 'null'] },
        name: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
    empStatus: {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: ['integer', 'null'] },
        name: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
    supervisors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['empNumber', 'lastName', 'firstName', 'middleName'],
        properties: {
          empNumber: { type: 'integer' },
          lastName: { type: 'string' },
          firstName: { type: 'string' },
          middleName: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const employeeCreateBody = {
  type: 'object',
  required: ['firstName', 'lastName'],
  properties: {
    firstName: { type: 'string', minLength: 1, maxLength: 30 },
    middleName: { type: 'string', minLength: 1, maxLength: 30 },
    lastName: { type: 'string', minLength: 1, maxLength: 30 },
    employeeId: { type: 'string', minLength: 1, maxLength: 10 },
    empPicture: {
      type: 'object',
      required: ['name', 'type', 'base64', 'size'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        type: { type: 'string' },
        base64: { type: 'string' },
        size: {
          anyOf: [
            { type: 'integer', minimum: 0 },
            { type: 'string', pattern: '^\\d+$' },
          ],
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const employeeListQuery = {
  type: 'object',
  properties: {
    limit: {
      anyOf: [
        { type: 'integer', minimum: 0 },
        { type: 'string', pattern: '^\\d*$' },
      ],
    },
    offset: {
      anyOf: [
        { type: 'integer', minimum: 0 },
        { type: 'string', pattern: '^\\d*$' },
      ],
    },
    includeEmployees: {
      enum: ['onlyCurrent', 'onlyPast', 'currentAndPast', 1, 2, 3, '1', '2', '3'],
    },
    name: { type: 'string', maxLength: 100 },
    nameOrId: { type: 'string', maxLength: 100 },
    employeeId: { type: 'string', maxLength: 10 },
    empStatusId: { type: 'integer', minimum: 1 },
    jobTitleId: { type: 'integer', minimum: 1 },
    subunitId: { type: 'integer', minimum: 1 },
    supervisorEmpNumbers: {
      type: 'array',
      items: { type: 'integer', minimum: 1 },
    },
    empNumber: { type: 'integer', minimum: 1 },
    model: { enum: ['default', 'detailed'] },
    sortField: {
      enum: [
        'employee.lastName',
        'employee.firstName',
        'employee.middleName',
        'employee.empNumber',
        'employee.employeeId',
        'jobTitle.jobTitleName',
        'empStatus.name',
        'subunit.name',
        'supervisor.firstName',
      ],
    },
    sortOrder: { enum: ['ASC', 'DESC'] },
  },
  additionalProperties: false,
};

const employeeGetQuery = {
  type: 'object',
  properties: { model: { enum: ['default', 'detailed'] } },
  additionalProperties: false,
};

const employeeDeleteBody = {
  type: 'object',
  required: ['ids'],
  properties: {
    ids: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } },
  },
  additionalProperties: false,
};

module.exports = {
  employeeCreateBody,
  employeeDeleteBody,
  employeeDetailedModel,
  employeeGetQuery,
  employeeListQuery,
  employeeModel,
};
