/* eslint-disable no-console */
const fs = require('fs');

const INPUT = './swagger/orangehrm-v2.json';
const OUTPUT = './swagger-endpoints.txt';

const j = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

function resolveRef(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const prefix = '#/';
  if (!ref.startsWith(prefix)) return null;

  let value = j;
  for (const part of ref.slice(prefix.length).split('/')) {
    value = value?.[part];
  }
  return value ?? null;
}

function inspectSchema(schema, indent = '    ', seen = new Set()) {
  if (!schema) return [];

  if (schema.$ref) {
    const ref = schema.$ref;
    if (seen.has(ref)) {
      return [`${indent}$ref: ${ref} (circular)`];
    }
    const resolved = resolveRef(ref);
    if (!resolved) {
      return [`${indent}$ref: ${ref}`];
    }
    const nextSeen = new Set(seen);
    nextSeen.add(ref);
    return [`${indent}$ref: ${ref}`, ...inspectSchema(resolved, indent + '  ', nextSeen)];
  }

  const lines = [];

  if (schema.type) lines.push(`${indent}type: ${schema.type}`);
  if (schema.format) lines.push(`${indent}format: ${schema.format}`);
  if (schema.description)
    lines.push(`${indent}description: ${schema.description.replace(/\s+/g, ' ')}`);
  if (schema.enum) lines.push(`${indent}enum: ${JSON.stringify(schema.enum)}`);
  if (schema.default !== undefined)
    lines.push(`${indent}default: ${JSON.stringify(schema.default)}`);
  if (schema.example !== undefined)
    lines.push(`${indent}example: ${JSON.stringify(schema.example)}`);

  const constraints = [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minLength',
    'maxLength',
    'pattern',
    'minItems',
    'maxItems',
    'uniqueItems',
  ];
  for (const key of constraints) {
    if (schema[key] !== undefined) lines.push(`${indent}${key}: ${JSON.stringify(schema[key])}`);
  }

  if (schema.nullable !== undefined) lines.push(`${indent}nullable: ${schema.nullable}`);
  if (schema.required?.length) lines.push(`${indent}required: ${schema.required.join(', ')}`);

  if (schema.allOf) {
    lines.push(`${indent}allOf:`);
    schema.allOf.forEach((item, i) => {
      lines.push(`${indent}  [${i + 1}]`);
      lines.push(...inspectSchema(item, indent + '    ', seen));
    });
  }
  if (schema.oneOf) {
    lines.push(`${indent}oneOf:`);
    schema.oneOf.forEach((item, i) => {
      lines.push(`${indent}  [${i + 1}]`);
      lines.push(...inspectSchema(item, indent + '    ', seen));
    });
  }
  if (schema.anyOf) {
    lines.push(`${indent}anyOf:`);
    schema.anyOf.forEach((item, i) => {
      lines.push(`${indent}  [${i + 1}]`);
      lines.push(...inspectSchema(item, indent + '    ', seen));
    });
  }

  if (schema.items) {
    lines.push(`${indent}items:`);
    lines.push(...inspectSchema(schema.items, indent + '  ', seen));
  }

  if (schema.properties) {
    lines.push(`${indent}properties:`);
    for (const [name, property] of Object.entries(schema.properties)) {
      const required = schema.required?.includes(name) ? 'required' : 'optional';
      lines.push(`${indent}  - ${name} (${required})`);
      lines.push(...inspectSchema(property, indent + '    ', seen));
    }
  }

  return lines;
}

/**
 * NEW: resolve $ref parameters, but guard against cycles and refs that
 * point back to another $ref.
 */
function resolveParameter(parameter, depth = 0) {
  if (!parameter || typeof parameter !== 'object') return parameter;
  if (depth > 8) return parameter;
  if (!parameter.$ref) return parameter;

  const resolved = resolveRef(parameter.$ref);
  if (!resolved) return parameter;
  if (resolved.$ref) return resolveParameter(resolved, depth + 1);

  // Preserve the original ref for traceability, but merge resolved fields.
  return { ...resolved, __resolvedFrom: parameter.$ref };
}

function printParameter(rawParameter, indent = '  ') {
  const lines = [];

  if (!rawParameter) {
    lines.push(`${indent}- (unresolved parameter)`);
    return lines;
  }

  const parameter = resolveParameter(rawParameter);

  if (parameter.$ref && !parameter.__resolvedFrom) {
    lines.push(`${indent}$ref: ${parameter.$ref} (unresolved)`);
    return lines;
  }

  lines.push(`${indent}- ${parameter.name || 'Unnamed parameter'}`);

  if (parameter.__resolvedFrom) {
    lines.push(`${indent}  resolvedFrom: ${parameter.__resolvedFrom}`);
  }

  if (parameter.in) lines.push(`${indent}  location: ${parameter.in}`);
  lines.push(`${indent}  required: ${parameter.required === true ? 'yes' : 'no'}`);

  if (parameter.description) {
    lines.push(`${indent}  description: ${parameter.description.replace(/\s+/g, ' ')}`);
  }

  if (parameter.schema) {
    lines.push(`${indent}  schema:`);
    lines.push(...inspectSchema(parameter.schema, indent + '    '));
  }

  if (parameter.example !== undefined) {
    lines.push(`${indent}  example: ${JSON.stringify(parameter.example)}`);
  }
  if (parameter.examples) {
    lines.push(`${indent}  examples: ${JSON.stringify(parameter.examples, null, 2)}`);
  }

  return lines;
}

function printRequestBody(body) {
  const lines = [];
  if (!body) {
    lines.push('  None');
    return lines;
  }

  const resolvedBody = body.$ref ? resolveRef(body.$ref) : body;
  if (!resolvedBody) {
    lines.push(`  $ref: ${body.$ref} (unresolved)`);
    return lines;
  }

  if (body.$ref) lines.push(`  resolvedFrom: ${body.$ref}`);
  lines.push(`  required: ${resolvedBody.required === true ? 'yes' : 'no'}`);

  if (resolvedBody.description) {
    lines.push(`  description: ${resolvedBody.description.replace(/\s+/g, ' ')}`);
  }

  if (resolvedBody.content) {
    lines.push('  content:');
    for (const [contentType, media] of Object.entries(resolvedBody.content)) {
      lines.push(`    ${contentType}`);
      if (media.schema) {
        lines.push('      schema:');
        lines.push(...inspectSchema(media.schema, '        '));
      }
      if (media.example !== undefined)
        lines.push(`      example: ${JSON.stringify(media.example, null, 2)}`);
      if (media.examples) lines.push(`      examples: ${JSON.stringify(media.examples, null, 2)}`);
    }
  }

  return lines;
}

function printResponses(responses) {
  const lines = [];
  if (!responses || !Object.keys(responses).length) {
    lines.push('  None');
    return lines;
  }

  for (const [status, rawResponse] of Object.entries(responses)) {
    lines.push(`  ${status}`);

    const response = rawResponse.$ref ? resolveRef(rawResponse.$ref) : rawResponse;
    if (!response) {
      lines.push(`    $ref: ${rawResponse.$ref} (unresolved)`);
      continue;
    }
    if (rawResponse.$ref) {
      lines.push(`    resolvedFrom: ${rawResponse.$ref}`);
    }

    if (response.description) {
      lines.push(`    description: ${response.description.replace(/\s+/g, ' ')}`);
    }

    if (response.headers) {
      lines.push('    headers:');
      for (const [name, header] of Object.entries(response.headers)) {
        lines.push(`      - ${name}`);
        if (header.$ref) {
          lines.push(`        $ref: ${header.$ref}`);
        } else {
          if (header.description)
            lines.push(`        description: ${header.description.replace(/\s+/g, ' ')}`);
          if (header.schema) {
            lines.push('        schema:');
            lines.push(...inspectSchema(header.schema, '          '));
          }
        }
      }
    }

    if (response.content) {
      lines.push('    content:');
      for (const [contentType, media] of Object.entries(response.content)) {
        lines.push(`      ${contentType}`);
        if (media.schema) {
          lines.push('        schema:');
          lines.push(...inspectSchema(media.schema, '          '));
        }
        if (media.example !== undefined)
          lines.push(`        example: ${JSON.stringify(media.example, null, 2)}`);
        if (media.examples)
          lines.push(`        examples: ${JSON.stringify(media.examples, null, 2)}`);
      }
    }
  }

  return lines;
}

const output = [];

output.push('======================================================================');
output.push(' ORANGEHRM OPENAPI ENDPOINT INVENTORY');
output.push('======================================================================');
output.push('');
output.push(`OpenAPI version : ${j.openapi || 'N/A'}`);
output.push(`API title       : ${j.info?.title || 'N/A'}`);
output.push(`API version     : ${j.info?.version || 'N/A'}`);
output.push('');

let operationNumber = 0;

for (const [path, pathItem] of Object.entries(j.paths || {})) {
  const pathParameters = pathItem.parameters || [];

  for (const method of METHODS) {
    const op = pathItem[method];
    if (!op) continue;

    operationNumber++;

    output.push('');
    output.push('======================================================================');
    output.push(` OPERATION ${operationNumber}`);
    output.push('======================================================================');
    output.push('');
    output.push(`${method.toUpperCase()} ${path}`);
    output.push('');
    output.push(`operationId : ${op.operationId || 'N/A'}`);
    output.push(`summary     : ${op.summary || 'N/A'}`);
    output.push(`description : ${op.description ? op.description.replace(/\s+/g, ' ') : 'N/A'}`);
    output.push(`deprecated  : ${op.deprecated === true ? 'yes' : 'no'}`);
    output.push(`tags        : ${op.tags?.length ? op.tags.join(', ') : 'None'}`);
    output.push('');

    output.push('SECURITY');
    output.push('--------');
    if (op.security) output.push(JSON.stringify(op.security, null, 2));
    else if (j.security) {
      output.push('Inherited global security:');
      output.push(JSON.stringify(j.security, null, 2));
    } else output.push('None');
    output.push('');

    output.push('PARAMETERS');
    output.push('----------');
    const parameters = [...pathParameters, ...(op.parameters || [])];
    if (parameters.length) {
      for (const parameter of parameters) output.push(...printParameter(parameter));
    } else {
      output.push('  None');
    }
    output.push('');

    output.push('REQUEST BODY');
    output.push('------------');
    output.push(...printRequestBody(op.requestBody));
    output.push('');

    output.push('RESPONSES');
    output.push('---------');
    output.push(...printResponses(op.responses));
    output.push('');

    if (op.callbacks) {
      output.push('CALLBACKS');
      output.push('---------');
      output.push(JSON.stringify(op.callbacks, null, 2));
      output.push('');
    }
    if (op.servers) {
      output.push('SERVERS');
      output.push('-------');
      output.push(JSON.stringify(op.servers, null, 2));
      output.push('');
    }
    if (op.externalDocs) {
      output.push('EXTERNAL DOCS');
      output.push('-------------');
      output.push(JSON.stringify(op.externalDocs, null, 2));
      output.push('');
    }
  }
}

output.push('');
output.push('======================================================================');
output.push(' END OF ENDPOINT INVENTORY');
output.push('======================================================================');

fs.writeFileSync(OUTPUT, output.join('\n'), 'utf8');
console.log(`Created: ${OUTPUT}`);
console.log(`Operations: ${operationNumber}`);
