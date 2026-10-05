const userModel = {
  type: 'object',
  required: ['id', 'userName', 'deleted', 'status', 'employee', 'userRole'],
  properties: {
    id: { type: 'integer' },
    userName: { type: 'string' },
    deleted: { type: 'boolean' },
    status: { type: 'boolean' },
    employee: {
      type: 'object',
      required: ['empNumber', 'employeeId', 'firstName', 'middleName', 'lastName', 'terminationId'],
      properties: {
        empNumber: { type: ['integer', 'null'] },
        employeeId: { type: ['string', 'null'] },
        firstName: { type: ['string', 'null'] },
        middleName: { type: ['string', 'null'] },
        lastName: { type: ['string', 'null'] },
        terminationId: { type: ['integer', 'null'] },
      },
      additionalProperties: false,
    },
    userRole: {
      type: 'object',
      required: ['id', 'name', 'displayName'],
      properties: {
        id: { type: ['integer', 'null'] },
        name: { type: ['string', 'null'] },
        displayName: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const userListQuery = {
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
    status: { enum: [true, false, 'true', 'false', '1', '0', 1, 0] },
    username: { type: 'string' },
    userRoleId: { type: 'integer', minimum: 1 },
    empNumber: { type: 'integer', minimum: 1 },
    hasPassword: { enum: [true, false, 'true', 'false', '1', '0', 1, 0] },
    sortField: {
      enum: ['u.userName', 'u.status', 'r.name', 'e.firstName', 'e.lastName', 'r.displayName'],
    },
    sortOrder: { enum: ['ASC', 'DESC'] },
  },
  additionalProperties: false,
};

const userBody = {
  type: 'object',
  required: ['username', 'password', 'status', 'userRoleId', 'empNumber'],
  properties: {
    username: { type: 'string', minLength: 5, maxLength: 40 },
    password: { type: 'string', maxLength: 64 },
    status: { type: 'boolean' },
    userRoleId: { type: 'integer' },
    empNumber: { type: 'integer', minimum: 1 },
    changePassword: { type: 'boolean' },
  },
  additionalProperties: false,
};

const userDeleteBody = {
  type: 'object',
  required: ['ids'],
  properties: {
    ids: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } },
  },
  additionalProperties: false,
};

module.exports = { userBody, userDeleteBody, userListQuery, userModel };
