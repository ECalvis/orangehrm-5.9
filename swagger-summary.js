/* eslint-disable no-console */
/* eslint-disable no-unused-vars */
const fs = require('fs');

const SPEC_PATH = './swagger/orangehrm-v2.json';
const OUTPUT_PATH = './swagger-summary.txt';

const j = require(SPEC_PATH);

const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

const paths = Object.entries(j.paths || {});
const schemas = Object.entries(j.components?.schemas || {});
const security = j.components?.securitySchemes || {};
const tags = j.tags || [];

const operations = [];

const methodCount = {};
const responseCodes = {};
const contentTypes = {};
const parameterTypes = {};
const schemaTypes = {};
const tagStats = {};

let requestBodies = 0;
let parameters = 0;
let deprecated = 0;
let secured = 0;
let uploads = 0;
let paginated = 0;
let responses = 0;

function clean(value) {
  if (value === undefined || value === null) return 'N/A';
  return String(value).replace(/\s+/g, ' ').trim();
}

function resolveRef(ref) {
  if (!ref || typeof ref !== 'string') return null;
  if (!ref.startsWith('#/')) return null;
  let value = j;
  for (const part of ref.slice(2).split('/')) {
    value = value?.[part];
  }
  return value ?? null;
}

function resolveParameter(parameter, depth = 0) {
  if (!parameter || typeof parameter !== 'object') return parameter;
  if (depth > 8) return parameter;
  if (!parameter.$ref) return parameter;
  const resolved = resolveRef(parameter.$ref);
  if (!resolved) return parameter;
  if (resolved.$ref) return resolveParameter(resolved, depth + 1);
  return { ...resolved, __resolvedFrom: parameter.$ref };
}

function section(title) {
  return [
    '',
    '======================================================================',
    ' ' + title,
    '======================================================================',
    '',
  ];
}

/*
============================================================
ANALYZE API
============================================================
*/

for (const [path, item] of paths) {
  for (const method of methods) {
    const op = item[method];
    if (!op) continue;

    operations.push({ path, method, op });

    methodCount[method] = (methodCount[method] || 0) + 1;
    if (op.requestBody) requestBodies++;
    if (op.parameters) parameters += op.parameters.length;
    if (op.deprecated === true) deprecated++;
    if (op.security || j.security) secured++;

    const operationTags = op.tags && op.tags.length ? op.tags : ['Untagged'];
    for (const tag of operationTags) {
      if (!tagStats[tag]) {
        tagStats[tag] = { operations: 0, methods: {}, paths: new Set() };
      }
      tagStats[tag].operations++;
      tagStats[tag].paths.add(path);
      tagStats[tag].methods[method] = (tagStats[tag].methods[method] || 0) + 1;
    }

    const rawParams = [...(item.parameters || []), ...(op.parameters || [])];

    for (const raw of rawParams) {
      const p = resolveParameter(raw);
      if (p.in) parameterTypes[p.in] = (parameterTypes[p.in] || 0) + 1;

      const name = p.name ? String(p.name).toLowerCase() : '';
      if (
        name.includes('page') ||
        name.includes('limit') ||
        name.includes('offset') ||
        name.includes('sort') ||
        name.includes('order')
      ) {
        paginated++;
      }
    }

    if (op.requestBody && op.requestBody.content) {
      for (const type of Object.keys(op.requestBody.content)) {
        contentTypes[type] = (contentTypes[type] || 0) + 1;
        if (type.includes('multipart') || type.includes('octet-stream')) uploads++;
      }
    }

    for (const [code, response] of Object.entries(op.responses || {})) {
      responses++;
      responseCodes[code] = (responseCodes[code] || 0) + 1;
      for (const type of Object.keys(response.content || {})) {
        contentTypes[type] = (contentTypes[type] || 0) + 1;
      }
    }
  }
}

/*
============================================================
ANALYZE SCHEMAS
============================================================
*/

for (const [name, schema] of schemas) {
  const type = schema.type || 'object';
  schemaTypes[type] = (schemaTypes[type] || 0) + 1;
}

/*
============================================================
BUILD REPORT
============================================================
*/

const lines = [];

lines.push(
  '======================================================================',
  ' ORANGEHRM OPENAPI SUMMARY',
  '======================================================================',
);

lines.push(...section('API INFORMATION'));
lines.push('OpenAPI version : ' + clean(j.openapi));
lines.push('API title : ' + clean(j.info?.title));
lines.push('API version : ' + clean(j.info?.version));
lines.push('Description : ' + clean(j.info?.description));

lines.push(...section('PROJECT INFORMATION'));
lines.push('Terms of service: ' + clean(j.info?.termsOfService));
lines.push('Contact name : ' + clean(j.info?.contact?.name));
lines.push('Contact email : ' + clean(j.info?.contact?.email));
lines.push('License : ' + clean(j.info?.license?.name));
lines.push('License URL : ' + clean(j.info?.license?.url));

lines.push(...section('SERVERS'));
if (j.servers && j.servers.length) {
  j.servers.forEach(function (server, index) {
    let line = index + 1 + '. ' + clean(server.url);
    if (server.description) line += ' - ' + clean(server.description);
    lines.push(line);
  });
} else {
  lines.push('None defined');
}

lines.push(...section('API SIZE'));
lines.push('Unique paths : ' + paths.length);
lines.push('Operations : ' + operations.length);
lines.push('Schemas : ' + schemas.length);
lines.push('Tags/modules : ' + tags.length);
lines.push('Request bodies : ' + requestBodies);
lines.push('Parameters : ' + parameters);
lines.push('Responses : ' + responses);
lines.push('Secured ops : ' + secured);
lines.push('Deprecated ops : ' + deprecated);
lines.push('File uploads (multipart/octet-stream) : ' + uploads);
lines.push('Pagination-ish : ' + paginated);

lines.push(...section('HTTP METHODS'));
for (const method of methods) {
  if (methodCount[method]) {
    lines.push(method.toUpperCase().padEnd(10) + methodCount[method]);
  }
}

lines.push(...section('AUTH / SECURITY'));
const securityEntries = Object.entries(security);
if (securityEntries.length) {
  for (const [name, scheme] of securityEntries) {
    lines.push('Name : ' + name);
    lines.push('Type          : ' + clean(scheme.type));
    lines.push('Scheme        : ' + clean(scheme.scheme));
    lines.push('Bearer format : ' + clean(scheme.bearerFormat));
    lines.push('In            : ' + clean(scheme.in));
    if (scheme.flows) {
      lines.push('Flows         : ' + Object.keys(scheme.flows).join(', '));
      for (const [flowName, flow] of Object.entries(scheme.flows)) {
        lines.push('  Flow: ' + flowName);
        if (flow.authorizationUrl) lines.push('    Authorization URL: ' + flow.authorizationUrl);
        if (flow.tokenUrl) lines.push('    Token URL        : ' + flow.tokenUrl);
        if (flow.refreshUrl) lines.push('    Refresh URL      : ' + flow.refreshUrl);
        if (flow.scopes)
          lines.push('    Scopes           : ' + Object.keys(flow.scopes).join(', '));
      }
    }
    lines.push('');
  }
} else {
  lines.push('No security schemes defined');
}

lines.push(...section('GLOBAL SECURITY'));
if (j.security) lines.push(JSON.stringify(j.security, null, 2));
else lines.push('None');

lines.push(...section('MODULES / TAGS'));
Object.entries(tagStats)
  .sort(function (a, b) {
    return b[1].operations - a[1].operations;
  })
  .forEach(function (entry) {
    const tag = entry[0];
    const stats = entry[1];
    const methodText = Object.entries(stats.methods)
      .map(function (methodEntry) {
        return methodEntry[0].toUpperCase() + ':' + methodEntry[1];
      })
      .join(' ');
    lines.push(
      tag.padEnd(45) +
        String(stats.operations).padStart(4) +
        ' ops | paths:' +
        String(stats.paths.size).padStart(4) +
        ' | ' +
        methodText,
    );
  });

lines.push(...section('PARAMETERS BY LOCATION'));
Object.entries(parameterTypes)
  .sort(function (a, b) {
    return b[1] - a[1];
  })
  .forEach(function (entry) {
    lines.push(entry[0].padEnd(15) + entry[1]);
  });

lines.push(...section('CONTENT TYPES'));
Object.entries(contentTypes)
  .sort(function (a, b) {
    return b[1] - a[1];
  })
  .forEach(function (entry) {
    lines.push(entry[0].padEnd(40) + entry[1]);
  });

lines.push(...section('RESPONSE STATUS CODES'));
Object.entries(responseCodes)
  .sort(function (a, b) {
    const aNum = Number(a[0]);
    const bNum = Number(b[0]);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;
    return a[0].localeCompare(b[0]);
  })
  .forEach(function (entry) {
    lines.push(entry[0].padEnd(8) + entry[1]);
  });

lines.push(...section('SCHEMA TYPES'));
Object.entries(schemaTypes)
  .sort(function (a, b) {
    return b[1] - a[1];
  })
  .forEach(function (entry) {
    lines.push(entry[0].padEnd(15) + entry[1]);
  });

lines.push(...section('COMPONENTS'));
const components = j.components || {};
Object.entries(components).forEach(function (entry) {
  const name = entry[0];
  const value = entry[1];
  if (value && typeof value === 'object') {
    lines.push(name.padEnd(25) + Object.keys(value).length);
  }
});

lines.push(...section('TAG DEFINITIONS'));
if (tags.length) {
  tags.forEach(function (tag) {
    let line = clean(tag.name);
    if (tag.description) line += ' | ' + clean(tag.description);
    lines.push(line);
  });
} else {
  lines.push('No tag definitions');
}

/*
============================================================
COMPLETE OPERATION INVENTORY
============================================================
*/

lines.push(...section('COMPLETE API OPERATION INVENTORY'));

for (const operation of operations) {
  const op = operation.op;

  lines.push(operation.method.toUpperCase().padEnd(7) + operation.path);
  lines.push('  summary     : ' + clean(op.summary));
  lines.push('  operationId : ' + clean(op.operationId));
  lines.push('  tags        : ' + (op.tags && op.tags.length ? op.tags.join(', ') : 'Untagged'));
  lines.push('  deprecated  : ' + (op.deprecated === true ? 'YES' : 'NO'));

  const rawParams = [...(j.paths?.[operation.path]?.parameters || []), ...(op.parameters || [])];

  if (rawParams.length) {
    lines.push('  parameters  :');
    for (const raw of rawParams) {
      const p = resolveParameter(raw);
      const from = p.__resolvedFrom ? ` [${p.__resolvedFrom}]` : '';
      lines.push(
        '    - ' +
          clean(p.in) +
          ': ' +
          clean(p.name) +
          ' (' +
          (p.required ? 'required' : 'optional') +
          ')' +
          from,
      );
    }
  } else {
    lines.push('  parameters  : none');
  }

  if (op.requestBody && op.requestBody.content) {
    lines.push('  requestBody :');
    for (const [type, content] of Object.entries(op.requestBody.content)) {
      const schema = content.schema || {};
      const schemaName = schema.$ref || schema.type || 'N/A';
      lines.push('    - ' + type + ' -> ' + schemaName);
    }
  } else if (op.requestBody && op.requestBody.$ref) {
    lines.push('  requestBody : ' + op.requestBody.$ref);
  } else {
    lines.push('  requestBody : none');
  }

  if (op.responses) {
    lines.push('  responses   :');
    for (const [code, rawResponse] of Object.entries(op.responses)) {
      const response = rawResponse.$ref ? resolveRef(rawResponse.$ref) || rawResponse : rawResponse;
      const from = rawResponse.$ref ? ` [${rawResponse.$ref}]` : '';
      lines.push('    - ' + code + ': ' + clean(response.description) + from);
      if (response.content) {
        for (const [type, content] of Object.entries(response.content)) {
          const schema = content.schema || {};
          const schemaName = schema.$ref || schema.type || 'N/A';
          lines.push('      ' + type + ' -> ' + schemaName);
        }
      }
    }
  }

  lines.push('');
}

/*
============================================================
COMPLETE SCHEMA INVENTORY
============================================================
*/

lines.push(...section('COMPLETE SCHEMA INVENTORY'));

for (const [name, schema] of schemas) {
  lines.push('SCHEMA: ' + name);
  lines.push('  type        : ' + clean(schema.type || 'object'));

  if (schema.description) lines.push('  description : ' + clean(schema.description));
  if (schema.required && schema.required.length)
    lines.push('  required    : ' + schema.required.join(', '));

  if (schema.properties) {
    lines.push('  properties  :');
    for (const [propertyName, property] of Object.entries(schema.properties)) {
      let propertyType = property.$ref || property.type;

      if (!propertyType && property.anyOf) {
        propertyType = property.anyOf
          .map(function (x) {
            return x.$ref || x.type || 'unknown';
          })
          .join(' | ');
      }
      if (!propertyType && property.oneOf) {
        propertyType = property.oneOf
          .map(function (x) {
            return x.$ref || x.type || 'unknown';
          })
          .join(' | ');
      }
      if (!propertyType) propertyType = 'unknown';

      const required =
        schema.required && schema.required.includes(propertyName) ? 'required' : 'optional';
      lines.push('    - ' + propertyName + ': ' + propertyType + ' (' + required + ')');
    }
  }

  lines.push('');
}

lines.push(
  '======================================================================',
  ' END OF REPORT',
  '======================================================================',
);

fs.writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf8');

console.log('');
console.log('============================================================');
console.log(' ORANGEHRM SUMMARY GENERATED');
console.log('============================================================');
console.log('');
console.log('Input : ' + SPEC_PATH);
console.log('Output: ' + OUTPUT_PATH);
console.log('');
console.log('Paths : ' + paths.length);
console.log('Operations : ' + operations.length);
console.log('Schemas : ' + schemas.length);
console.log('');
console.log('Done.');
console.log('');
