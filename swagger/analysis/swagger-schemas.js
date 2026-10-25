/* eslint-disable no-console */
const fs = require('fs');

const INPUT = './swagger/orangehrm-v2.json';
const OUTPUT = './swagger/analysis/swagger-schemas.txt';

const j = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

function resolveRef(ref) {
  if (!ref || typeof ref !== 'string') return null;

  if (!ref.startsWith('#/')) return null;

  let value = j;

  for (const part of ref.slice(2).split('/')) {
    value = value?.[part];
  }

  return value ?? null;
}

function formatValue(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function dumpSchema(schema, indent = '  ', seen = new Set()) {
  const lines = [];

  if (!schema) {
    lines.push(`${indent}N/A`);
    return lines;
  }

  if (schema.$ref) {
    lines.push(`${indent}$ref: ${schema.$ref}`);

    if (seen.has(schema.$ref)) {
      lines.push(`${indent}[circular reference]`);
      return lines;
    }

    const resolved = resolveRef(schema.$ref);

    if (resolved) {
      const nextSeen = new Set(seen);
      nextSeen.add(schema.$ref);

      lines.push(`${indent}resolved:`);
      lines.push(...dumpSchema(resolved, indent + '  ', nextSeen));
    }

    return lines;
  }

  if (schema.type !== undefined) {
    lines.push(`${indent}type: ${formatValue(schema.type)}`);
  }

  if (schema.title !== undefined) {
    lines.push(`${indent}title: ${formatValue(schema.title)}`);
  }

  if (schema.description !== undefined) {
    lines.push(`${indent}description: ${schema.description.replace(/\s+/g, ' ')}`);
  }

  if (schema.format !== undefined) {
    lines.push(`${indent}format: ${schema.format}`);
  }

  if (schema.nullable !== undefined) {
    lines.push(`${indent}nullable: ${schema.nullable}`);
  }

  if (schema.readOnly !== undefined) {
    lines.push(`${indent}readOnly: ${schema.readOnly}`);
  }

  if (schema.writeOnly !== undefined) {
    lines.push(`${indent}writeOnly: ${schema.writeOnly}`);
  }

  if (schema.deprecated !== undefined) {
    lines.push(`${indent}deprecated: ${schema.deprecated}`);
  }

  if (schema.example !== undefined) {
    lines.push(`${indent}example: ${formatValue(schema.example)}`);
  }

  if (schema.default !== undefined) {
    lines.push(`${indent}default: ${formatValue(schema.default)}`);
  }

  if (schema.enum) {
    lines.push(`${indent}enum:`);

    for (const value of schema.enum) {
      lines.push(`${indent}  - ${formatValue(value)}`);
    }
  }

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
    'minProperties',
    'maxProperties',
  ];

  for (const key of constraints) {
    if (schema[key] !== undefined) {
      lines.push(`${indent}${key}: ${formatValue(schema[key])}`);
    }
  }

  if (schema.required?.length) {
    lines.push(`${indent}required:`);

    for (const field of schema.required) {
      lines.push(`${indent}  - ${field}`);
    }
  }

  if (schema.additionalProperties !== undefined) {
    lines.push(`${indent}additionalProperties: ${formatValue(schema.additionalProperties)}`);
  }

  if (schema.discriminator) {
    lines.push(`${indent}discriminator:`);
    lines.push(
      `${indent}  ${JSON.stringify(schema.discriminator, null, 2)
        .split('\n')
        .join(`\n${indent}  `)}`,
    );
  }

  for (const composition of ['allOf', 'oneOf', 'anyOf']) {
    if (schema[composition]) {
      lines.push(`${indent}${composition}:`);

      schema[composition].forEach((item, index) => {
        lines.push(`${indent}  [${index + 1}]`);

        lines.push(...dumpSchema(item, indent + '    ', seen));
      });
    }
  }

  if (schema.not) {
    lines.push(`${indent}not:`);
    lines.push(...dumpSchema(schema.not, indent + '  ', seen));
  }

  if (schema.items) {
    lines.push(`${indent}items:`);
    lines.push(...dumpSchema(schema.items, indent + '  ', seen));
  }

  if (schema.prefixItems) {
    lines.push(`${indent}prefixItems:`);

    schema.prefixItems.forEach((item, index) => {
      lines.push(`${indent}  [${index + 1}]`);

      lines.push(...dumpSchema(item, indent + '    ', seen));
    });
  }

  if (schema.properties) {
    lines.push(`${indent}properties:`);

    for (const [name, property] of Object.entries(schema.properties)) {
      const required = schema.required?.includes(name) ? 'required' : 'optional';

      lines.push(`${indent}  ${name}: ${required}`);

      lines.push(...dumpSchema(property, indent + '    ', seen));
    }
  }

  if (schema.patternProperties) {
    lines.push(`${indent}patternProperties:`);

    for (const [pattern, property] of Object.entries(schema.patternProperties)) {
      lines.push(`${indent}  ${pattern}:`);

      lines.push(...dumpSchema(property, indent + '    ', seen));
    }
  }

  if (schema.propertyNames) {
    lines.push(`${indent}propertyNames:`);
    lines.push(...dumpSchema(schema.propertyNames, indent + '  ', seen));
  }

  if (schema.xml) {
    lines.push(`${indent}xml:`);
    lines.push(
      `${indent}  ${JSON.stringify(schema.xml, null, 2).split('\n').join(`\n${indent}  `)}`,
    );
  }

  return lines;
}

const schemas = j.components?.schemas || {};
const output = [];

output.push('======================================================================');
output.push(' ORANGEHRM OPENAPI COMPLETE SCHEMA INVENTORY');
output.push('======================================================================');
output.push('');

output.push(`Total schemas: ${Object.keys(schemas).length}`);
output.push('');

let count = 0;

for (const [name, schema] of Object.entries(schemas)) {
  count++;

  output.push('');
  output.push('======================================================================');
  output.push(` SCHEMA ${count}`);
  output.push('======================================================================');
  output.push('');

  output.push(`NAME: ${name}`);
  output.push('');

  output.push('DEFINITION');
  output.push('----------');

  output.push(...dumpSchema(schema, '  '));

  output.push('');
}

output.push('');
output.push('======================================================================');
output.push(' END OF SCHEMA INVENTORY');
output.push('======================================================================');

fs.writeFileSync(OUTPUT, output.join('\n'), 'utf8');

console.log(`Created: ${OUTPUT}`);
console.log(`Schemas: ${Object.keys(schemas).length}`);
