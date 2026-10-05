const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');

const { ApiContractError } = require('../errors');
const schemas = require('./index');

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  strictTypes: false,
  strictRequired: false,
});
addFormats(ajv);
ajv.addKeyword('example');
ajv.addFormat('base64', {
  type: 'string',
  validate: (value) =>
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
});
ajv.addFormat('float', { type: 'number', validate: Number.isFinite });
const validators = new WeakMap();

for (const [name, schema] of Object.entries(schemas)) {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    ajv.addSchema(schema, `orangehrm://${name}`);
  }
}

function assertValid(schema, value, { stage, operation }) {
  let validate = validators.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    validators.set(schema, validate);
  }

  if (validate(value)) return;

  const issues = validate.errors.map(({ instancePath, keyword, message, params }) => ({
    path: instancePath || '/',
    keyword,
    message,
    params,
  }));

  throw new ApiContractError(`${stage} contract failed for ${operation}`, {
    stage,
    operation,
    issues,
  });
}

module.exports = { assertValid, ajv };
