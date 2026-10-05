const jsonValue = {
  type: ['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'],
};

const successEnvelope = {
  type: 'object',
  required: ['data', 'meta', 'rels'],
  properties: {
    data: jsonValue,
    meta: { anyOf: [{ type: 'object' }, { type: 'array' }] },
    rels: { type: 'array' },
  },
  additionalProperties: false,
};

const errorEnvelope = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['status', 'message'],
      properties: {
        status: { type: ['integer', 'string'] },
        message: { type: 'string' },
        data: jsonValue,
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

const oauthErrorEnvelope = {
  type: 'object',
  required: ['error', 'error_description'],
  properties: {
    error: { type: 'string' },
    error_description: { type: 'string' },
    hint: { type: 'string' },
    message: { type: 'string' },
  },
  additionalProperties: true,
};

const objectRequest = {
  type: 'object',
  additionalProperties: true,
};

const pathParameter = {
  anyOf: [
    { type: 'integer', minimum: 1 },
    { type: 'string', minLength: 1 },
  ],
};

const emptyMeta = {
  anyOf: [
    { type: 'array', maxItems: 0 },
    { type: 'object', maxProperties: 0 },
  ],
};
const collectionMeta = {
  type: 'object',
  required: ['total'],
  properties: { total: { type: 'integer', minimum: 0 } },
  additionalProperties: false,
};

const deletedIds = { type: 'array', items: { type: 'integer', minimum: 1 } };

module.exports = {
  collectionMeta,
  deletedIds,
  emptyMeta,
  errorEnvelope,
  jsonValue,
  objectRequest,
  oauthErrorEnvelope,
  pathParameter,
  successEnvelope,
};
