/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const INPUT = './swagger/orangehrm-v2.json';
const OUT_TXT = './swagger-findings.txt';
const OUT_CSV = './swagger-findings.csv';
const SNAPSHOT = './swagger-findings.snapshot.json';

// ---- CLI -------------------------------------------------------------------
const args = process.argv.slice(2);
let baselineFile = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--baseline' && args[i + 1]) baselineFile = args[++i];
  if (args[i] === '--help') {
    console.log('usage: node swagger-findings.js [--baseline <snapshot.json>]');
    process.exit(0);
  }
}
if (!baselineFile && fs.existsSync(SNAPSHOT)) baselineFile = SNAPSHOT;

// ---- Load spec -------------------------------------------------------------
const j = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const paths = j.paths || {};
const schemas = j.components?.schemas || {};
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

// ---- Finding accumulator ---------------------------------------------------
const findings = [];
function add(f) {
  findings.push({
    id: f.id,
    severity: f.severity,
    category: f.category,
    method: f.method || '',
    path: f.path || '',
    location: f.location,
    field: f.field || '',
    current: f.current,
    expected: f.expected,
    note: f.note || '',
  });
}

// ---- Helpers ---------------------------------------------------------------
function refName(ref) {
  if (typeof ref !== 'string') return null;
  const m = ref.match(/^#\/components\/schemas\/(.+)$/);
  return m ? m[1] : null;
}
function resolveRef(ref) {
  if (!ref || typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let v = j;
  for (const p of ref.slice(2).split('/')) v = v?.[p];
  return v ?? null;
}
function jsonPointer(path) {
  return path.replace(/~/g, '~0').replace(/\//g, '~1');
}

const EXPECTED_RESPONSE_SCHEMAS = {
  'list-all-education-records': 'Admin-EducationModel',
  'create-an-education-record': 'Admin-EducationModel',
  'update-email-configuration': 'Admin-EmailConfigurationModel',
  'update-localization-settings': 'Admin-LocalizationModel',
  'list-an-employees-memberships': 'Pim-EmployeeMembershipModel',
  'update-an-employees-personal-details': 'Pim-EmployeePersonalDetailModel',
  'update-a-termination-reason': 'Pim-TerminationReasonConfigurationModel',
  'create-a-project': 'Time-ProjectDetailedModel',
};

// ---- 1. Response schema mismatches ----------------------------------------
function walkForRefs(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.$ref) out.push(refName(node.$ref));
  if (node.items) walkForRefs(node.items, out);
  for (const k of ['oneOf', 'anyOf', 'allOf'])
    if (Array.isArray(node[k])) node[k].forEach((x) => walkForRefs(x, out));
}

for (const [p, item] of Object.entries(paths)) {
  for (const m of METHODS) {
    const op = item[m];
    if (!op) continue;
    const expected = EXPECTED_RESPONSE_SCHEMAS[op.operationId];
    if (!expected) continue;
    const success = op.responses?.['200'] || op.responses?.['201'];
    if (!success) continue;
    const resolved = success.$ref ? resolveRef(success.$ref) : success;
    const dataSchema = resolved?.content?.['application/json']?.schema?.properties?.data;
    if (!dataSchema) continue;
    const candidates = [];
    walkForRefs(dataSchema, candidates);
    if (candidates.length && !candidates.includes(expected)) {
      add({
        id: `schema-mismatch:${op.operationId}`,
        severity: 'high',
        category: 'response-schema',
        method: m.toUpperCase(),
        path: p,
        location: `#/paths/${jsonPointer(p)}/${m}/responses/200/content/application~1json/schema/properties/data`,
        field: 'data',
        current: candidates.filter(Boolean).join(', ') || '(inline)',
        expected,
        note: `operationId=${op.operationId}`,
      });
    }
  }
}

// ---- 2. Date/code type errors ---------------------------------------------
const DATE_HINT =
  /(^date|date$|Date$|_date|At$|On$|birthday|joinedDate|issuedDate|expiryDate|startDate|endDate|dueDate|reviewDate|completedDate|performedDate|creditedDate|commenceDate|renewalDate|expiredDate|applied)/;

function walkSchemaProps(schema, schemaName, ptr, cb, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 8) return;
  if (schema.properties) {
    for (const [name, prop] of Object.entries(schema.properties)) {
      cb(name, prop, `${ptr}/properties/${name}`);
      walkSchemaProps(prop, schemaName, `${ptr}/properties/${name}`, cb, depth + 1);
    }
  }
  if (schema.items) walkSchemaProps(schema.items, schemaName, `${ptr}/items`, cb, depth + 1);
  for (const k of ['oneOf', 'anyOf', 'allOf'])
    if (Array.isArray(schema[k]))
      schema[k].forEach((x, i) =>
        walkSchemaProps(x, schemaName, `${ptr}/${k}/${i}`, cb, depth + 1),
      );
}

for (const [name, schema] of Object.entries(schemas)) {
  walkSchemaProps(schema, name, `#/components/schemas/${name}`, (field, prop, loc) => {
    const t = prop.type;
    if (DATE_HINT.test(field) && (t === 'number' || t === 'integer')) {
      add({
        id: `date-as-number:${name}:${field}`,
        severity: 'high',
        category: 'type',
        location: loc,
        field,
        current: `type=${t}`,
        expected: 'type=string, format=date',
        note: `schema=${name}`,
      });
    }
    if (/(^code$|Code$|_code$|countryCode|stateCode)/.test(field) && t === 'integer') {
      add({
        id: `code-as-integer:${name}:${field}`,
        severity: 'high',
        category: 'type',
        location: loc,
        field,
        current: 'type=integer',
        expected: 'type=string',
        note: `schema=${name}`,
      });
    }
  });
}

// ---- 3. Typos --------------------------------------------------------------
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
  preform: 'perform',
  performend: 'performed',
};

function scanTypos(node, loc, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (typeof node.type === 'string' && KNOWN_TYPOS[node.type]) {
    add({
      id: `typo-type:${loc}`,
      severity: 'medium',
      category: 'typo',
      location: `${loc}/type`,
      field: 'type',
      current: node.type,
      expected: KNOWN_TYPOS[node.type],
    });
  }
  if (node.properties) {
    for (const [k, v] of Object.entries(node.properties)) {
      if (KNOWN_TYPOS[k]) {
        add({
          id: `typo-prop:${loc}/properties/${k}`,
          severity: 'medium',
          category: 'typo',
          location: `${loc}/properties/${k}`,
          field: k,
          current: k,
          expected: KNOWN_TYPOS[k],
          note: 'property name',
        });
      }
      scanTypos(v, `${loc}/properties/${k}`, depth + 1);
    }
  }
  if (node.items) scanTypos(node.items, `${loc}/items`, depth + 1);
  for (const k of ['oneOf', 'anyOf', 'allOf'])
    if (Array.isArray(node[k]))
      node[k].forEach((x, i) => scanTypos(x, `${loc}/${k}/${i}`, depth + 1));
}

for (const [p, item] of Object.entries(paths)) {
  for (const m of METHODS) {
    const op = item[m];
    if (!op) continue;
    const base = `#/paths/${jsonPointer(p)}/${m}`;
    if (op.requestBody?.content) {
      for (const [ct, media] of Object.entries(op.requestBody.content)) {
        if (media.schema)
          scanTypos(media.schema, `${base}/requestBody/content/${jsonPointer(ct)}/schema`);
      }
    }
    for (const [code, resp] of Object.entries(op.responses || {})) {
      const r = resp.$ref ? resolveRef(resp.$ref) : resp;
      if (r?.content)
        for (const [ct, media] of Object.entries(r.content)) {
          if (media.schema)
            scanTypos(media.schema, `${base}/responses/${code}/content/${jsonPointer(ct)}/schema`);
        }
    }
  }
}
for (const [name, schema] of Object.entries(schemas))
  scanTypos(schema, `#/components/schemas/${name}`);

// ---- 4. Malformed paths ----------------------------------------------------
for (const p of Object.keys(paths)) {
  if (p.includes('}') && !p.match(/\{[^}]+\}/)) {
    add({
      id: `path-stray-brace:${p}`,
      severity: 'medium',
      category: 'path',
      path: p,
      location: `#/paths/${jsonPointer(p)}`,
      field: '',
      current: p,
      expected: p.replace(/}+$/, ''),
      note: 'stray closing brace',
    });
  }
  if (/shedule/i.test(p)) {
    add({
      id: `path-typo:${p}`,
      severity: 'medium',
      category: 'path',
      path: p,
      location: `#/paths/${jsonPointer(p)}`,
      field: '',
      current: p,
      expected: p.replace(/shedule/gi, 'schedule'),
      note: 'misspelling',
    });
  }
}

// ---- 5. Request/response type inconsistency --------------------------------
function propertyTypes(schema, out = {}, depth = 0, seen = new Set()) {
  if (!schema || typeof schema !== 'object' || depth > 6) return out;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return out;
    seen.add(schema.$ref);
    const r = resolveRef(schema.$ref);
    if (!r) return out;
    return propertyTypes(r, out, depth + 1, seen);
  }
  if (schema.properties)
    for (const [n, p] of Object.entries(schema.properties)) {
      if (!(n in out)) out[n] = p.type || (p.$ref ? p.$ref : 'unknown');
    }
  return out;
}

for (const [p, item] of Object.entries(paths)) {
  for (const m of ['post', 'put', 'patch']) {
    const op = item[m];
    if (!op?.requestBody?.content) continue;
    const reqSchema = op.requestBody.content['application/json']?.schema;
    if (!reqSchema) continue;
    const reqTypes = propertyTypes(reqSchema);
    const success = op.responses?.['200'] || op.responses?.['201'];
    if (!success) continue;
    const r = success.$ref ? resolveRef(success.$ref) : success;
    const resSchema = r?.content?.['application/json']?.schema;
    if (!resSchema) continue;
    const resTypes = propertyTypes(resSchema);
    for (const [n, rt] of Object.entries(reqTypes)) {
      if (!(n in resTypes)) continue;
      const rest = resTypes[n];
      if (rt === 'unknown' || rest === 'unknown') continue;
      if (rt === rest) continue;
      if (String(rt).includes('null') || String(rest).includes('null')) continue;
      add({
        id: `req-res-type:${op.operationId}:${n}`,
        severity: 'low',
        category: 'inconsistency',
        method: m.toUpperCase(),
        path: p,
        location: `#/paths/${jsonPointer(p)}/${m}`,
        field: n,
        current: `request=${rt}, response=${rest}`,
        expected: 'same type on both sides',
        note: `operationId=${op.operationId}`,
      });
    }
  }
}

// ---- Sort + write artifacts ------------------------------------------------
findings.sort((a, b) => {
  const sev = { high: 0, medium: 1, low: 2, info: 3 };
  if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
  if (a.category !== b.category) return a.category.localeCompare(b.category);
  return a.id.localeCompare(b.id);
});

const lines = [
  `# Findings: ${findings.length}`,
  '# ID | SEV | CATEGORY | LOCATION | FIELD | CURRENT -> EXPECTED',
  '',
];
for (const f of findings) {
  lines.push(
    `${f.id} | ${f.severity} | ${f.category} | ${f.location} | ${f.field} | ${f.current} -> ${f.expected}`,
  );
}
fs.writeFileSync(OUT_TXT, lines.join('\n'), 'utf8');

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = [
  [
    'id',
    'severity',
    'category',
    'method',
    'path',
    'location',
    'field',
    'current',
    'expected',
    'note',
  ].join(','),
  ...findings.map((f) =>
    [
      f.id,
      f.severity,
      f.category,
      f.method,
      f.path,
      f.location,
      f.field,
      f.current,
      f.expected,
      f.note,
    ]
      .map(csvCell)
      .join(','),
  ),
].join('\n');
fs.writeFileSync(OUT_CSV, csv, 'utf8');

// ---- Snapshot (for diffs) --------------------------------------------------
const currentIds = findings.map((f) => f.id).sort();
const snapshot = {
  generatedAt: new Date().toISOString(),
  specFile: path.resolve(INPUT),
  total: findings.length,
  ids: currentIds,
  byCategory: findings.reduce((a, f) => ((a[f.category] = (a[f.category] || 0) + 1), a), {}),
  bySeverity: findings.reduce((a, f) => ((a[f.severity] = (a[f.severity] || 0) + 1), a), {}),
};

// ---- Diff vs baseline ------------------------------------------------------
let baseline = null;
if (baselineFile) {
  try {
    baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  } catch (e) {
    console.warn(`! Could not read baseline "${baselineFile}": ${e.message}`);
  }
}

if (baseline && Array.isArray(baseline.ids)) {
  const baseSet = new Set(baseline.ids);
  const currSet = new Set(currentIds);

  const closed = baseline.ids.filter((id) => !currSet.has(id));
  const remaining = baseline.ids.filter((id) => currSet.has(id));
  const added = currentIds.filter((id) => !baseSet.has(id));

  console.log('');
  console.log('============================================================');
  console.log(' DIFF vs baseline');
  console.log('============================================================');
  console.log(`baseline   : ${baselineFile}`);
  console.log(`generated  : ${baseline.generatedAt ?? 'unknown'}`);
  console.log('');
  console.log(`closed     : ${closed.length}`);
  console.log(`remaining  : ${remaining.length}`);
  console.log(`added (new): ${added.length}`);
  console.log(`total now  : ${currentIds.length}`);
  console.log('');

  const bar = (n, total) => {
    const w = 30;
    const filled = total === 0 ? w : Math.round((n / total) * w);
    return '[' + '█'.repeat(filled) + '·'.repeat(w - filled) + ']';
  };
  const started = baseline.total || closed.length + remaining.length;
  const donePct = started === 0 ? 100 : Math.round((closed.length / started) * 100);
  console.log(
    `progress   : ${bar(closed.length, started)} ${donePct}% (${closed.length}/${started})`,
  );
  console.log('');

  if (closed.length) {
    console.log('--- CLOSED ---');
    closed.forEach((id) => console.log(`  ✓ ${id}`));
    console.log('');
  }
  if (added.length) {
    console.log('--- ADDED (new findings, please review) ---');
    added.forEach((id) => console.log(`  ✗ ${id}`));
    console.log('');
  }
  if (remaining.length && remaining.length <= 30) {
    console.log('--- REMAINING ---');
    remaining.forEach((id) => console.log(`  · ${id}`));
    console.log('');
  } else if (remaining.length) {
    console.log(`--- REMAINING: ${remaining.length} (see ${OUT_TXT}) ---`);
    console.log('');
  }
} else {
  console.log('');
  console.log(`First run (no baseline). Snapshot written to ${SNAPSHOT}.`);
  console.log(`Next run will diff against it automatically.`);
}

fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2), 'utf8');

console.log(`Artifacts:`);
console.log(`  ${OUT_TXT}`);
console.log(`  ${OUT_CSV}`);
console.log(`  ${SNAPSHOT}`);
console.log(`Total findings: ${findings.length}`);
console.log('By severity  :', snapshot.bySeverity);
console.log('By category  :', snapshot.byCategory);
