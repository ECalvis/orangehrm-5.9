const { sourceContract } = require('./schemas/source-contracts');

function createRouteGroup(client, definitions) {
  const group = {};

  for (const [endpointName, operations] of Object.entries(definitions)) {
    group[endpointName] = {};

    for (const [operationName, definition] of Object.entries(operations)) {
      const source = sourceContract(definition);
      const contract = Object.freeze({
        operation: `${endpointName}.${operationName}`,
        ...source,
        responseSchema: definition.responseSchema,
        metaSchema: definition.metaSchema,
      });

      const operation = (input = {}) => {
        const isObjectInput = input && typeof input === 'object' && !Array.isArray(input);
        const options = isObjectInput ? input : {};
        const pathKeys = Array.from(definition.path.matchAll(/\{([^}]+)\}/g), (match) => match[1]);
        const pathParams =
          isObjectInput && (options.pathParams ?? options)
            ? (options.pathParams ?? options)
            : pathKeys.length === 1
              ? { [pathKeys[0]]: input }
              : {};

        const path = definition.path.replace(/\{([^}]+)\}/g, (_match, key) => {
          const value = pathParams[key];
          return encodeSegment(value, `${key} is required for ${endpointName}.${operationName}`);
        });

        const reservedKeys = new Set(['data', 'body', 'headers', 'params', 'pathParams', 'ids']);
        const query =
          definition.method === 'GET'
            ? (options.params ??
              Object.fromEntries(
                Object.entries(options).filter(
                  ([key]) => !pathKeys.includes(key) && !reservedKeys.has(key),
                ),
              ))
            : options.params;

        let data = options.data ?? options.body;
        if (['POST', 'PUT', 'PATCH'].includes(definition.method) && pathKeys.length === 0) {
          data = input;
        }

        if (definition.method === 'DELETE' && data === undefined) {
          if (options.ids !== undefined) {
            data = { ids: Array.isArray(options.ids) ? options.ids : [options.ids] };
          } else if (pathKeys.length === 0 && Array.isArray(input)) {
            data = { ids: input };
          } else if (
            pathKeys.length === 0 &&
            (typeof input === 'number' || typeof input === 'string')
          ) {
            data = { ids: [input] };
          } else if (pathKeys.length === 0 && input && typeof input === 'object') {
            data = input;
          }
        }

        return client.request({
          method: definition.method,
          url: path,
          params: query,
          data,
          headers: options.headers,
          pathParams: Object.fromEntries(pathKeys.map((key) => [key, pathParams[key]])),
          contract,
        });
      };

      Object.defineProperty(operation, 'route', {
        value: Object.freeze({ ...definition, contract }),
      });

      group[endpointName][operationName] = operation;
    }
  }

  return group;
}

function encodeSegment(value, errorMessage = 'Resource identifier is required') {
  if (value == null || value === '') {
    throw new TypeError(errorMessage);
  }

  return encodeURIComponent(String(value));
}

module.exports = { createRouteGroup, encodeSegment };
