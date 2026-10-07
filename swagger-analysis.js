/* eslint-disable no-console */
/* eslint-disable no-unused-vars */
const fs = require('fs');

const INPUT = './swagger/orangehrm-v2.json';
const OUTPUT = './swagger-analysis.txt';

const j = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

const paths = j.paths || {};
const schemas = j.components?.schemas || {};

const operations = [];
const refs = new Map();
const anomalies = [];
const reviewItems = [];
const enumValues = new Map();
const schemaUsage = new Map();

// ---- helper -----------------------------------------------------------------

function resolveRef(ref) {
  if (!ref || typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let value = j;
  for (const part of ref.slice(2).split('/')) value = value?.[part];
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

function addMap(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function scanSchema(schema, context) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.$ref) addMap(refs, schema.$ref, context);

  if (schema.enum) {
    if (!enumValues.has(context)) enumValues.set(context, new Set());
    for (const value of schema.enum) {
      enumValues.get(context).add(typeof value === 'string' ? value : JSON.stringify(value));
    }
  }

  if (schema.properties) {
    for (const [name, property] of Object.entries(schema.properties)) {
      scanSchema(property, `${context}.${name}`);
    }
  }

  if (schema.items) scanSchema(schema.items, `${context}[]`);

  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(schema[key])) {
      schema[key].forEach((item, index) => {
        scanSchema(item, `${context}.${key}[${index + 1}]`);
      });
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    scanSchema(schema.additionalProperties, `${context}.<additionalProperties>`);
  }
}

function scanObject(obj, context) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.$ref) addMap(refs, obj.$ref, context);
  if (obj.schema) scanSchema(obj.schema, context);

  if (obj.content) {
    for (const [contentType, media] of Object.entries(obj.content)) {
      scanSchema(media.schema, `${context} [${contentType}]`);
    }
  }
}

// ---- schema inspection helpers --------------------------------------------

function collectProperties(schema, out = {}, depth = 0, seen = new Set()) {
  if (!schema || typeof schema !== 'object' || depth > 6) return out;

  if (schema.$ref) {
    if (seen.has(schema.$ref)) return out;
    seen.add(schema.$ref);
    const resolved = resolveRef(schema.$ref);
    if (!resolved) return out;
    return collectProperties(resolved, out, depth + 1, seen);
  }

  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(schema[key])) {
      for (const item of schema[key]) collectProperties(item, out, depth + 1, seen);
    }
  }

  if (schema.properties) {
    for (const [name, prop] of Object.entries(schema.properties)) {
      if (!(name in out)) {
        out[name] = {
          type: prop.type,
          format: prop.format,
          ref: prop.$ref,
        };
      }
    }
  }

  if (schema.items) collectProperties(schema.items, out, depth + 1, seen);

  return out;
}

function inferType(schema) {
  if (!schema) return 'unknown';
  if (schema.$ref) return schema.$ref;
  if (schema.type) return schema.type;
  if (schema.oneOf || schema.anyOf || schema.allOf) return 'composition';
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return 'unknown';
}

function refName(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const m = ref.match(/^#\/components\/schemas\/(.+)$/);
  return m ? m[1] : null;
}

// ---- the "known wrong schema" table ---------------------------------------
// These are deliberate, curated expectations. Add to this list as you find
// more mismatches during review.

const EXPECTED_RESPONSE_SCHEMAS = {
  // operationId: expected schema name
  'list-all-education-records': 'Admin-EducationModel',
  'create-an-education-record': 'Admin-EducationModel',
  'get-an-education-record': 'Admin-EducationModel',
  'update-an-education-record': 'Admin-EducationModel',

  'update-email-configuration': 'Admin-EmailConfigurationModel',
  'get-email-configuration': 'Admin-EmailConfigurationModel',

  'update-localization-settings': 'Admin-LocalizationModel',
  'get-localization-settings': 'Admin-LocalizationModel',

  'create-a-project': 'Time-ProjectDetailedModel',
  'update-a-project': 'Time-ProjectDetailedModel',
  'get-a-project': 'Time-ProjectDetailedModel',

  'get-an-employees-personal-details': 'Pim-EmployeePersonalDetailModel',
  'update-an-employees-personal-details': 'Pim-EmployeePersonalDetailModel',

  'get-an-employees-memberships': 'Pim-EmployeeMembershipModel',
  'list-an-employees-memberships': 'Pim-EmployeeMembershipModel',

  'update-a-termination-reason': 'Pim-TerminationReasonConfigurationModel',
  'get-a-termination-reason': 'Pim-TerminationReasonConfigurationModel',

  'update-a-job-title': 'Admin-JobTitleModel',
  'create-a-job-title': 'Admin-JobTitleModel',
  'get-a-job-title': 'Admin-JobTitleModel',

  'update-a-pay-grade': 'Admin-PayGradeModel',
  'create-a-pay-grade': 'Admin-PayGradeModel',
  'get-a-pay-grade': 'Admin-PayGradeModel',

  'update-a-language-record': 'Admin-LanguageModel',
  'get-a-language-record': 'Admin-LanguageModel',
  'create-a-language': 'Admin-LanguageModel',
  'list-all-language-records': 'Admin-LanguageModel',
};

// ---- scan ------------------------------------------------------------------

for (const [path, item] of Object.entries(paths)) {
  const pathParameters = item.parameters || [];

  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;

    const operation = {
      method,
      path,
      operationId: op.operationId || '',
      summary: op.summary || '',
      tags: op.tags || [],
      parameters: [...pathParameters, ...(op.parameters || [])],
      requestBody: op.requestBody,
      responses: op.responses || {},
    };

    operations.push(operation);

    scanObject(op.requestBody, `${method.toUpperCase()} ${path} requestBody`);

    for (const parameter of operation.parameters) {
      const resolved = resolveParameter(parameter);
      scanObject(
        resolved,
        `${method.toUpperCase()} ${path} parameter:${resolved.name || 'unknown'}`,
      );
    }

    for (const [code, response] of Object.entries(op.responses || {})) {
      const resolved = response.$ref ? resolveRef(response.$ref) : response;
      scanObject(resolved, `${method.toUpperCase()} ${path} response:${code}`);
    }

    if (path.includes('}')) {
      const open = (path.match(/{/g) || []).length;
      const close = (path.match(/}/g) || []).length;
      if (open !== close) {
        anomalies.push({
          type: 'Malformed path parameter braces',
          method: method.toUpperCase(),
          path,
        });
      }
    }

    if (/shedule/i.test(path) || /shedule/i.test(op.summary || '')) {
      anomalies.push({
        type: 'Possible spelling issue: "shedule"',
        method: method.toUpperCase(),
        path,
        summary: op.summary || '',
      });
    }

    const pathParams = [...path.matchAll(/{([^}]+)}/g)].map((m) => m[1]);
    for (const param of pathParams) {
      const defined = operation.parameters.some((p) => {
        const r = resolveParameter(p);
        return r.name === param && r.in === 'path';
      });
      if (!defined) {
        anomalies.push({
          type: 'Path parameter may not be defined',
          method: method.toUpperCase(),
          path,
          parameter: param,
        });
      }
    }

    for (const parameter of operation.parameters) {
      const r = resolveParameter(parameter);
      if (r.in === 'path' && r.required !== true) {
        anomalies.push({
          type: 'Path parameter is not marked required',
          method: method.toUpperCase(),
          path,
          parameter: r.name,
        });
      }
    }

    if (['post', 'put', 'patch'].includes(method) && !op.requestBody) {
      reviewItems.push({
        type: 'Write operation without requestBody',
        method: method.toUpperCase(),
        path,
        summary: op.summary || '',
      });
    }

    if (!op.responses || Object.keys(op.responses).length === 0) {
      anomalies.push({
        type: 'Operation has no responses',
        method: method.toUpperCase(),
        path,
      });
    }
  }
}

for (const [name, schema] of Object.entries(schemas)) {
  scanSchema(schema, `#/components/schemas/${name}`);
  if (schema.$ref) addMap(refs, schema.$ref, `#/components/schemas/${name}`);
}

// ---- SEMANTIC CHECKS: response schema mismatch -----------------------------

const responseSchemaMismatches = [];

for (const op of operations) {
  const expected = EXPECTED_RESPONSE_SCHEMAS[op.operationId];
  if (!expected) continue;

  const successResponse = op.responses['200'] || op.responses['201'];
  if (!successResponse) continue;

  const resolved = successResponse.$ref ? resolveRef(successResponse.$ref) : successResponse;
  if (!resolved || !resolved.content) continue;

  const json = resolved.content['application/json'];
  if (!json || !json.schema) continue;

  const dataSchema = json.schema.properties?.data;
  if (!dataSchema) continue;

  const candidates = [];

  function walk(node) {
    if (!node) return;
    if (node.$ref) candidates.push(refName(node.$ref));
    if (node.items) walk(node.items);
    if (node.oneOf) node.oneOf.forEach(walk);
    if (node.anyOf) node.anyOf.forEach(walk);
    if (node.allOf) node.allOf.forEach(walk);
  }

  walk(dataSchema);

  if (candidates.length && !candidates.includes(expected)) {
    responseSchemaMismatches.push({
      operationId: op.operationId,
      method: op.method.toUpperCase(),
      path: op.path,
      expected,
      actual: candidates.filter(Boolean).join(', ') || '(inline schema)',
    });
  }
}

// ---- SEMANTIC CHECKS: request/response property type inconsistency ---------

const typeInconsistencies = [];

function schemaPropertyTypes(schema, out = {}, depth = 0, seen = new Set()) {
  if (!schema || typeof schema !== 'object' || depth > 6) return out;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return out;
    seen.add(schema.$ref);
    const resolved = resolveRef(schema.$ref);
    if (!resolved) return out;
    return schemaPropertyTypes(resolved, out, depth + 1, seen);
  }

  if (schema.properties) {
    for (const [name, prop] of Object.entries(schema.properties)) {
      if (!(name in out)) {
        out[name] = inferType(prop);
      }
    }
  }
  return out;
}

for (const op of operations) {
  if (!['post', 'put', 'patch'].includes(op.method)) continue;
  if (!op.requestBody || !op.requestBody.content) continue;

  const reqSchema = op.requestBody.content['application/json']?.schema;
  if (!reqSchema) continue;

  const reqTypes = schemaPropertyTypes(reqSchema);

  const success = op.responses['200'] || op.responses['201'];
  if (!success) continue;

  const resolved = success.$ref ? resolveRef(success.$ref) : success;
  const resSchema = resolved?.content?.['application/json']?.schema;
  if (!resSchema) continue;

  const resTypes = schemaPropertyTypes(resSchema);

  for (const [name, reqType] of Object.entries(reqTypes)) {
    if (!(name in resTypes)) continue;
    const resType = resTypes[name];
    if (reqType === 'unknown' || resType === 'unknown') continue;
    if (reqType === resType) continue;

    // skip harmless nullability / compositions
    if (reqType.includes('null') || resType.includes('null')) continue;
    if (reqType === 'composition' || resType === 'composition') continue;

    typeInconsistencies.push({
      operationId: op.operationId,
      method: op.method.toUpperCase(),
      path: op.path,
      property: name,
      requestType: reqType,
      responseType: resType,
    });
  }
}

// ---- SEMANTIC CHECKS: typos in keys and type values -----------------------

const typos = [];
const KNOWN_TYPOS = {
  boleean: 'boolean',
  booleen: 'boolean',
  integre: 'integer',
  integet: 'integer',
  strign: 'string',
  arrey: 'array',
  ojbect: 'object',
  desciption: 'description',
  lable: 'label',
  messsage: 'message',
  susbcriber: 'subscriber',
  intreview: 'interview',
  reveiw: 'review',
  attachemnt: 'attachment',
  intreviewer: 'interviewer',
  preform: 'perform',
  performend: 'performed',
};

function checkTypos(node, context) {
  if (!node || typeof node !== 'object') return;

  if (typeof node.type === 'string' && KNOWN_TYPOS[node.type]) {
    typos.push({
      context,
      where: `type: "${node.type}"`,
      suggestion: KNOWN_TYPOS[node.type],
    });
  }

  if (node.properties) {
    for (const [name, prop] of Object.entries(node.properties)) {
      if (KNOWN_TYPOS[name]) {
        typos.push({
          context: `${context}.${name}`,
          where: `property name "${name}"`,
          suggestion: KNOWN_TYPOS[name],
        });
      }
      checkTypos(prop, `${context}.${name}`);
    }
  }

  if (node.items) checkTypos(node.items, `${context}[]`);
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    if (node[key]) node[key].forEach((x, i) => checkTypos(x, `${context}.${key}[${i + 1}]`));
  }
}

for (const op of operations) {
  if (op.requestBody?.content) {
    for (const media of Object.values(op.requestBody.content)) {
      checkTypos(media.schema, `${op.method.toUpperCase()} ${op.path} requestBody`);
    }
  }
  for (const [code, response] of Object.entries(op.responses)) {
    const resolved = response.$ref ? resolveRef(response.$ref) : response;
    if (resolved?.content) {
      for (const media of Object.values(resolved.content)) {
        checkTypos(media.schema, `${op.method.toUpperCase()} ${op.path} response:${code}`);
      }
    }
  }
}

for (const [name, schema] of Object.entries(schemas)) {
  checkTypos(schema, `#/components/schemas/${name}`);
}

// ---- SEMANTIC CHECKS: suspicious date fields typed as numbers --------------

const suspiciousDates = [];

function looksLikeDate(name) {
  return /(^date|date$|Date$|_date|At$|On$|birthday|joinedDate|issuedDate|expiryDate|startDate|endDate|dueDate|reviewDate|completedDate|performedDate|creditedDate|commenceDate|renewalDate|expiredDate)/.test(
    name,
  );
}

function looksLikeCode(name) {
  return /(^code$|Code$|_code$|countryCode|currencyId|taxStateCode|workStateCode|unemploymentStateCode|stateCode)/.test(
    name,
  );
}

function walkSchemaForFieldTypes(node, context) {
  if (!node || typeof node !== 'object') return;

  if (node.properties) {
    for (const [name, prop] of Object.entries(node.properties)) {
      const resolvedType = inferType(prop);

      if (looksLikeDate(name) && (resolvedType === 'number' || resolvedType === 'integer')) {
        suspiciousDates.push({
          context: `${context}.${name}`,
          type: resolvedType,
          name,
        });
      }

      if (looksLikeCode(name) && resolvedType === 'integer') {
        suspiciousDates.push({
          context: `${context}.${name}`,
          type: resolvedType,
          name,
          kind: 'code-as-integer',
        });
      }

      walkSchemaForFieldTypes(prop, `${context}.${name}`);
    }
  }

  if (node.items) walkSchemaForFieldTypes(node.items, `${context}[]`);
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    if (node[key])
      node[key].forEach((x, i) => walkSchemaForFieldTypes(x, `${context}.${key}[${i + 1}]`));
  }
}

for (const [name, schema] of Object.entries(schemas)) {
  walkSchemaForFieldTypes(schema, `#/components/schemas/${name}`);
}

// ---- build output ----------------------------------------------------------

const output = [];

function section(title) {
  output.push('');
  output.push('======================================================================');
  output.push(` ${title}`);
  output.push('======================================================================');
  output.push('');
}

output.push('======================================================================');
output.push(' ORANGEHRM OPENAPI ANALYSIS');
output.push('======================================================================');

section('BASIC COUNTS');
output.push(`Paths        : ${Object.keys(paths).length}`);
output.push(`Operations   : ${operations.length}`);
output.push(`Schemas      : ${Object.keys(schemas).length}`);

const methodCounts = {};
for (const op of operations) methodCounts[op.method] = (methodCounts[op.method] || 0) + 1;

output.push('');
output.push('HTTP METHODS');
for (const method of METHODS) {
  if (methodCounts[method])
    output.push(`${method.toUpperCase().padEnd(10)} ${methodCounts[method]}`);
}

section('OPERATIONS BY MODULE');
const modules = new Map();
for (const op of operations) {
  const tag = op.tags[0] || 'Untagged';
  if (!modules.has(tag)) modules.set(tag, []);
  modules.get(tag).push(op);
}
for (const [tag, ops] of [...modules.entries()].sort((a, b) => b[1].length - a[1].length)) {
  output.push(`${tag}: ${ops.length}`);
  const methods = {};
  for (const op of ops) methods[op.method] = (methods[op.method] || 0) + 1;
  output.push(
    '  ' +
      Object.entries(methods)
        .map(([m, c]) => `${m.toUpperCase()}:${c}`)
        .join(' '),
  );
}

section('CRUD-LIKE RESOURCES');
const crud = new Map();
for (const op of operations) {
  const cleanPath = op.path
    .replace(/^\/api\/v2\//, '')
    .split('/')
    .filter(Boolean);
  if (!cleanPath.length) continue;
  const resource = cleanPath
    .map((x) => x.replace(/\{[^}]+\}/g, ''))
    .filter(Boolean)
    .join('/');
  if (!crud.has(resource)) crud.set(resource, new Set());
  crud.get(resource).add(op.method.toUpperCase());
}
for (const [resource, methods] of [...crud.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  output.push(`${resource.padEnd(60)} ${[...methods].join(', ')}`);
}

section('REQUEST BODY USAGE');
const requestBodyTypes = new Map();
for (const op of operations) {
  for (const [type, media] of Object.entries(op.requestBody?.content || {})) {
    addMap(requestBodyTypes, type, `${op.method.toUpperCase()} ${op.path}`);
  }
}
if (!requestBodyTypes.size) output.push('No request bodies found.');
else {
  for (const [type, ops] of requestBodyTypes) {
    output.push(`${type}: ${ops.size}`);
    for (const operation of ops) output.push(`  - ${operation}`);
  }
}

section('FILE / UPLOAD CANDIDATES');
const uploadCandidates = [];
for (const op of operations) {
  const contentTypes = Object.keys(op.requestBody?.content || {});
  const text = `${op.path} ${op.summary}`.toLowerCase();
  if (
    contentTypes.some((t) => t.includes('multipart') || t.includes('octet-stream')) ||
    /attachment|upload|picture|image|file|import/.test(text)
  )
    uploadCandidates.push(op);
}
if (!uploadCandidates.length) output.push('None detected.');
else
  for (const op of uploadCandidates)
    output.push(`${op.method.toUpperCase().padEnd(7)} ${op.path} | ${op.summary}`);

section('BULK / BATCH CANDIDATES');
const bulkCandidates = operations.filter((op) =>
  /bulk|batch|multiple|many/i.test(`${op.path} ${op.summary}`),
);
if (!bulkCandidates.length) output.push('None detected.');
else
  for (const op of bulkCandidates)
    output.push(`${op.method.toUpperCase().padEnd(7)} ${op.path} | ${op.summary}`);

section('ACTION / WORKFLOW CANDIDATES');
const actionCandidates = operations.filter((op) =>
  /\/(action|approve|cancel|reject|pass|fail|hire|shortlist|offer|decline|terminate|finalize|test|sync|purge|copy|import)(\/|$)/i.test(
    op.path,
  ),
);
if (!actionCandidates.length) output.push('None detected.');
else
  for (const op of actionCandidates)
    output.push(`${op.method.toUpperCase().padEnd(7)} ${op.path} | ${op.summary}`);

section('PAGINATION / FILTERING CANDIDATES');
for (const op of operations) {
  const resolved = op.parameters.map((p) => resolveParameter(p));
  const names = resolved
    .map((p) => p.name || '')
    .join(' ')
    .toLowerCase();
  if (!/page|limit|offset|sort|order|filter|search|start|end/.test(names)) continue;
  output.push(`${op.method.toUpperCase().padEnd(7)} ${op.path}`);
  for (const p of resolved) {
    if (/page|limit|offset|sort|order|filter|search|start|end/i.test(p.name || '')) {
      output.push(
        `  - ${p.name} [${p.in || 'unknown'}]${p.__resolvedFrom ? ` (${p.__resolvedFrom})` : ''}`,
      );
    }
  }
}

section('ENUMS');
for (const [context, values] of enumValues) {
  output.push(context);
  for (const value of values) output.push(`  - ${value}`);
}

section('SCHEMA REFERENCES');
const sortedRefs = [...refs.entries()].sort((a, b) => b[1].size - a[1].size);
for (const [ref, contexts] of sortedRefs) {
  output.push(`${ref}`);
  output.push(`  used ${contexts.size} time(s)`);
  for (const context of contexts) output.push(`  - ${context}`);
  output.push('');
}

section('UNUSED SCHEMAS');
const usedSchemaNames = new Set();
for (const ref of refs.keys()) {
  const m = ref.match(/^#\/components\/schemas\/(.+)$/);
  if (m) usedSchemaNames.add(m[1]);
}
let unusedCount = 0;
for (const name of Object.keys(schemas).sort()) {
  if (!usedSchemaNames.has(name)) {
    output.push(name);
    unusedCount++;
  }
}
if (!unusedCount) output.push('(none)');

section('RESPONSE SCHEMA MISMATCHES');
if (!responseSchemaMismatches.length) {
  output.push('No mismatches detected against the curated expectation table.');
} else {
  responseSchemaMismatches.forEach((m, i) => {
    output.push(`${i + 1}. ${m.method} ${m.path}`);
    output.push(`   operationId : ${m.operationId}`);
    output.push(`   expected    : ${m.expected}`);
    output.push(`   actual      : ${m.actual}`);
    output.push('');
  });
}

section('REQUEST / RESPONSE PROPERTY TYPE INCONSISTENCIES');
if (!typeInconsistencies.length) {
  output.push('No inconsistencies detected.');
} else {
  typeInconsistencies.forEach((m, i) => {
    output.push(`${i + 1}. ${m.method} ${m.path}`);
    output.push(`   operationId : ${m.operationId}`);
    output.push(`   property    : ${m.property}`);
    output.push(`   request     : ${m.requestType}`);
    output.push(`   response    : ${m.responseType}`);
    output.push('');
  });
}

section('SPELLING / TYPE TYPOS');
if (!typos.length) {
  output.push('No known typos detected.');
} else {
  typos.forEach((t, i) => {
    output.push(`${i + 1}. ${t.context}`);
    output.push(`   found      : ${t.where}`);
    output.push(`   suggestion : ${t.suggestion}`);
    output.push('');
  });
}

section('SUSPICIOUS DATE FIELDS TYPED AS NUMBERS');
const dateIssues = suspiciousDates.filter((s) => s.kind !== 'code-as-integer');
if (!dateIssues.length) {
  output.push('None detected.');
} else {
  dateIssues.forEach((s, i) => {
    output.push(`${i + 1}. ${s.context}`);
    output.push(`   field : ${s.name}`);
    output.push(`   type  : ${s.type} (expected a date/string)`);
    output.push('');
  });
}

section('SUSPICIOUS CODE FIELDS TYPED AS INTEGERS');
const codeIssues = suspiciousDates.filter((s) => s.kind === 'code-as-integer');
if (!codeIssues.length) {
  output.push('None detected.');
} else {
  codeIssues.forEach((s, i) => {
    output.push(`${i + 1}. ${s.context}`);
    output.push(`   field : ${s.name}`);
    output.push(`   type  : ${s.type} (expected a string code)`);
    output.push('');
  });
}

section('ANOMALIES / THINGS TO REVIEW');
if (!anomalies.length) {
  output.push('No obvious anomalies detected.');
} else {
  anomalies.forEach((item, index) => {
    output.push(`${index + 1}. ${item.type}`);
    output.push(`   Method : ${item.method || 'N/A'}`);
    output.push(`   Path   : ${item.path || 'N/A'}`);
    if (item.parameter) output.push(`   Param  : ${item.parameter}`);
    if (item.summary) output.push(`   Summary: ${item.summary}`);
    output.push('');
  });
}

section('REVIEW ITEMS (not errors)');
if (!reviewItems.length) {
  output.push('None.');
} else {
  reviewItems.forEach((item, index) => {
    output.push(`${index + 1}. ${item.type}`);
    output.push(`   Method : ${item.method}`);
    output.push(`   Path   : ${item.path}`);
    if (item.summary) output.push(`   Summary: ${item.summary}`);
    output.push('');
  });
}

section('SECURITY');
output.push(JSON.stringify(j.components?.securitySchemes || {}, null, 2));
output.push('');
output.push('Global security:');
output.push(JSON.stringify(j.security || [], null, 2));

section('SERVERS');
if (j.servers?.length) {
  j.servers.forEach((server, index) => {
    output.push(`${index + 1}. ${server.url}`);
    if (server.description) output.push(`   ${server.description}`);
  });
} else {
  output.push('None defined.');
}

output.push('');
output.push('======================================================================');
output.push(' END OF ANALYSIS');
output.push('======================================================================');

fs.writeFileSync(OUTPUT, output.join('\n'), 'utf8');

console.log(`Created: ${OUTPUT}`);
console.log(`Operations analyzed: ${operations.length}`);
console.log(`Schemas analyzed: ${Object.keys(schemas).length}`);
console.log(`Anomalies found: ${anomalies.length}`);
console.log(`Review items: ${reviewItems.length}`);
console.log(`Response schema mismatches: ${responseSchemaMismatches.length}`);
console.log(`Type inconsistencies: ${typeInconsistencies.length}`);
console.log(`Typos: ${typos.length}`);
console.log(`Suspicious date fields: ${dateIssues.length}`);
console.log(`Suspicious code fields: ${codeIssues.length}`);
