const openApiDocument = require('./orangehrm-v2.openapi.json');
const { jsonValue, objectRequest, pathParameter } = require('./common');
const { ajv } = require('./validate');

const documentId = 'orangehrm://orangehrm-5.9';
const numericKeywords = new Set([
  'maximum',
  'maxItems',
  'maxLength',
  'maxProperties',
  'minimum',
  'minItems',
  'minLength',
  'minProperties',
  'multipleOf',
  'exclusiveMaximum',
  'exclusiveMinimum',
]);

for (const [name, schema] of Object.entries(openApiDocument.components?.schemas ?? {})) {
  const schemaId = `${documentId}/schemas/${encodeURIComponent(name)}`;
  ajv.addSchema({ ...withAbsoluteReferences(schema), $id: schemaId }, schemaId);
}

function resolveReference(value) {
  if (!value?.$ref?.startsWith('#/')) return value;

  return value.$ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((current, key) => current?.[key], openApiDocument);
}

function withAbsoluteReferences(value) {
  if (Array.isArray(value)) return value.map(withAbsoluteReferences);
  if (!value || typeof value !== 'object') return value;

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => !(key === 'enum' && Array.isArray(child) && child.length === 0))
      .map(([key, child]) => [
        key,
        key === '$ref' && typeof child === 'string' && child.startsWith('#/')
          ? absoluteReference(child)
          : key === 'type' && typeof child === 'string'
            ? normalizeOpenApiType(child)
            : key === 'required' && Array.isArray(child)
              ? [...new Set(child)]
              : numericKeywords.has(key) &&
                  typeof child === 'string' &&
                  child.trim() !== '' &&
                  Number.isFinite(Number(child))
                ? Number(child)
                : withAbsoluteReferences(child),
      ]),
  );

  if (value.type === 'DateTime' && normalized.format === undefined) {
    normalized.format = 'date-time';
  }

  return normalized;
}

function normalizeOpenApiType(type) {
  if (type === 'DateTime') return 'string';
  if (type === 'boleean') return 'boolean';
  if (type.startsWith('string,')) return 'string';
  return type;
}

function absoluteReference(reference) {
  const schemaPrefix = '#/components/schemas/';
  if (reference.startsWith(schemaPrefix)) {
    const name = reference.slice(schemaPrefix.length).replace(/~1/g, '/').replace(/~0/g, '~');
    return `${documentId}/schemas/${encodeURIComponent(name)}`;
  }

  return `${documentId}${reference}`;
}

function mediaSchema(content = {}) {
  const mediaType =
    content['application/json'] ??
    Object.values(content).find((candidate) => candidate && typeof candidate === 'object');

  return mediaType?.schema ? withAbsoluteReferences(mediaType.schema) : undefined;
}

function successResponse(operation) {
  const responses = operation?.responses ?? {};
  const successStatus =
    responses['200'] ??
    Object.entries(responses).find(([status]) => /^2\d\d$/.test(status))?.[1] ??
    responses.default;
  const response = resolveReference(successStatus);

  return allowEmptyArrayMetadata(mediaSchema(response?.content));
}

function allowEmptyArrayMetadata(value) {
  if (Array.isArray(value)) return value.map(allowEmptyArrayMetadata);
  if (!value || typeof value !== 'object') return value;

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, allowEmptyArrayMetadata(child)]),
  );
  const meta = normalized.properties?.meta;

  if (meta?.type === 'object' && !meta.properties && !meta.required?.length) {
    normalized.properties.meta = {
      anyOf: [
        { type: 'object', maxProperties: 0 },
        { type: 'array', maxItems: 0 },
      ],
    };
  }

  return normalized;
}

function sourceContract(definition) {
  const routePath = definition.openapiPath ?? `/api/v2${definition.path}`;
  const method = definition.method.toLowerCase();
  const normalizedPath = routePath.replace(/\{[^}]+\}/g, '{}');
  const matchedPath =
    routePath in (openApiDocument.paths ?? {})
      ? routePath
      : Object.keys(openApiDocument.paths ?? {}).find(
          (candidate) =>
            candidate.replace(/\{[^}]+\}/g, '{}') === normalizedPath &&
            openApiDocument.paths[candidate]?.[method],
        );
  const pathItem = openApiDocument.paths?.[matchedPath];
  const operation = pathItem?.[method];
  const parameters = [...(pathItem?.parameters ?? []), ...(operation?.parameters ?? [])]
    .map(resolveReference)
    .filter(Boolean);
  const pathParameters = parameters.filter(({ in: location }) => location === 'path');
  const queryParameters = parameters.filter(({ in: location }) => location === 'query');
  const pathKeys = Array.from(definition.path.matchAll(/\{([^}]+)\}/g), (match) => match[1]);

  const pathParamsSchema = pathKeys.length
    ? {
        type: 'object',
        required: pathKeys,
        properties: Object.fromEntries(
          pathKeys.map((name, index) => {
            const parameter =
              pathParameters.find((candidate) => candidate.name === name) ?? pathParameters[index];
            return [name, withAbsoluteReferences(parameter?.schema ?? pathParameter)];
          }),
        ),
        additionalProperties: false,
      }
    : undefined;

  const querySchema = queryParameters.length
    ? {
        type: 'object',
        properties: Object.fromEntries(
          queryParameters.map((parameter) => [
            parameter.name,
            withAbsoluteReferences(parameter.schema ?? jsonValue),
          ]),
        ),
        required: queryParameters.filter((parameter) => parameter.required).map(({ name }) => name),
        additionalProperties: false,
      }
    : undefined;

  const requestBody = resolveReference(operation?.requestBody);
  const sourceBodySchema = mediaSchema(requestBody?.content);
  const bodySchema =
    definition.bodySchema ??
    sourceBodySchema ??
    (['POST', 'PUT', 'PATCH', 'DELETE'].includes(definition.method) ? objectRequest : undefined);

  return {
    pathParamsSchema: definition.pathParamsSchema ?? pathParamsSchema,
    querySchema:
      definition.querySchema ??
      querySchema ??
      (definition.method === 'GET' ? objectRequest : undefined),
    bodySchema,
    bodyRequired:
      definition.bodyRequired ?? requestBody?.required ?? Boolean(bodySchema?.required?.length),
    responseBodySchema: successResponse(operation),
    coverage: operation ? 'openapi' : 'envelope',
  };
}

module.exports = { sourceContract };
