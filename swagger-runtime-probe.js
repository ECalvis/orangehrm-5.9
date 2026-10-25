/* eslint-disable no-console */
/* eslint-disable no-unused-vars */
// swagger-runtime-probe.js
//
// Hits the running OrangeHRM container and compares observed responses
// against what the OpenAPI spec says. Emits findings in the same shape as
// swagger-findings.js so the two feeds can be merged.
//
// SAFETY:
//   - Dry run by default. Pass --execute to actually send.
//   - GET only by default. Pass --allow-writes / --allow-deletes to expand.
//   - Excludes destructive endpoints by default.
//   - Rate-limited. Token required.

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------
const argv = process.argv.slice(2);

function arg(name, fallback = null) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
function flag(name) {
  return argv.includes(name);
}

const HELP = flag('--help');
if (HELP) {
  console.log(`
usage: node swagger-runtime-probe.js [options]

Required for execution:
  --execute                 actually send requests (otherwise dry run)

Safety gates (all off by default):
  --allow-writes            allow POST/PUT/PATCH
  --allow-deletes           allow DELETE
  --include <regex>         only probe paths matching regex
  --exclude <regex>         skip paths matching regex (adds to defaults)

Connection:
  --base <url>              base URL (default http://localhost:8080/web/index.php)
  --token-file <file>       bearer token file (default auth/admin.token.json)
  --token <value>           bearer token inline (overrides --token-file)

Behavior:
  --delay <ms>              delay between requests (default 150)
  --timeout <ms>            request timeout (default 10000)
  --concurrency <n>         parallel requests (default 1)
  --max <n>                 cap number of probes (default 0 = unlimited)

Output:
  --out-txt <file>          default ./swagger-runtime-findings.txt
  --out-csv <file>          default ./swagger-runtime-findings.csv
  --snapshot <file>         default ./swagger-runtime.snapshot.json
  --baseline <file>         diff against a prior snapshot
  --merge <file>            merge with another findings CSV (for a combined view)

Default excluded path patterns:
  */purge*, */import*, */test, */sync, */hire, */reject, */shortlist,
  */offer, */decline, */pass, */fail, */preview, */action, */bulk,
  */purge*, */csv-import
`);
  process.exit(0);
}

const EXECUTE = flag('--execute');
const ALLOW_WRITES = flag('--allow-writes');
const ALLOW_DELETES = flag('--allow-deletes');

const BASE = String(arg('--base', 'http://localhost:8080/web/index.php'));
const TOKEN_FILE = String(arg('--token-file', 'auth/admin.token.json'));
const TOKEN_INLINE = arg('--token', null);
const DELAY = Number(arg('--delay', 150));
const TIMEOUT = Number(arg('--timeout', 10000));
const CONCURRENCY = Math.max(1, Number(arg('--concurrency', 1)));
const MAX_PROBES = Number(arg('--max', 0));

const OUT_TXT = String(arg('--out-txt', './swagger-runtime-findings.txt'));
const OUT_CSV = String(arg('--out-csv', './swagger-runtime-findings.csv'));
const SNAPSHOT = String(arg('--snapshot', './swagger-runtime.snapshot.json'));
const BASELINE = arg('--baseline', null);
const MERGE = arg('--merge', null);

// module-scope: assigned by run() before any probe fires
let TOKEN = null;

const DEFAULT_EXCLUDES = [
  '\\/purge',
  '\\/import',
  '\\/test',
  '\\/sync',
  '\\/hire',
  '\\/reject',
  '\\/shortlist',
  '\\/offer',
  '\\/decline',
  '\\/pass$',
  '\\/fail',
  '\\/preview',
  '\\/action',
  '\\/bulk',
  'csv-import',
  '\\/copy\\/',
];
const INCLUDE_RE = arg('--include', null) ? new RegExp(String(arg('--include'))) : null;
const EXCLUDE_RE = new RegExp(
  [...DEFAULT_EXCLUDES, ...(arg('--exclude', null) ? [String(arg('--exclude'))] : [])].join('|'),
);

// --------------------------------------------------------------------------
// Load token
// --------------------------------------------------------------------------
function loadToken() {
  if (TOKEN_INLINE && TOKEN_INLINE !== true) return String(TOKEN_INLINE);
  if (!fs.existsSync(TOKEN_FILE)) {
    console.error(`! Token file not found: ${TOKEN_FILE}`);
    console.error(`  Run: npm run token   (or provide --token-file / --token)`);
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const t =
    raw.access_token ||
    raw.accessToken ||
    raw.token ||
    raw.data?.access_token ||
    raw.data?.accessToken ||
    (typeof raw === 'string' ? raw : null);
  if (!t) {
    console.error(`! Could not find an access token in ${TOKEN_FILE}`);
    process.exit(2);
  }
  return t;
}

// --------------------------------------------------------------------------
// Load spec
// --------------------------------------------------------------------------
const SPEC_PATH = './swagger/orangehrm-v2.json';
const j = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
const paths = j.paths || {};
const sharedResponses = j.components?.responses || {};

// --------------------------------------------------------------------------
// Spec-side introspection (what the spec *claims*)
// --------------------------------------------------------------------------
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
function jsonPointer(s) {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

// Expand one operation into the shape we care about
function describeOperation(method, path, op) {
  const declaredStatuses = new Set(Object.keys(op.responses || {}).map(String));
  const success = op.responses?.['200'] || op.responses?.['201'] || op.responses?.['204'];
  const resolvedSuccess = success?.$ref ? resolveRef(success.$ref) : success;

  // content types declared for the success response
  const declaredContentTypes = new Set(Object.keys(resolvedSuccess?.content || {}));

  // top-level envelope keys declared in success schema
  const successSchema = resolvedSuccess?.content?.['application/json']?.schema;
  const declaredEnvelopeKeys = new Set(Object.keys(successSchema?.properties || {}));

  // shared response components referenced (for error-message drift checks)
  const sharedRefs = new Set();
  for (const resp of Object.values(op.responses || {})) {
    if (resp?.$ref) sharedRefs.add(resp.$ref);
  }

  // every declared status's `message` default (from shared components or inline)
  const declaredMessages = {};
  for (const [code, resp] of Object.entries(op.responses || {})) {
    const r = resp.$ref ? resolveRef(resp.$ref) : resp;
    const msg =
      r?.content?.['application/json']?.schema?.properties?.error?.properties?.message?.default ||
      r?.content?.['application/json']?.schema?.properties?.error?.properties?.message?.example ||
      r?.content?.['application/json']?.example?.error?.message;
    if (msg) declaredMessages[String(code)] = msg;
  }

  return {
    method,
    path,
    op,
    operationId: op.operationId,
    declaredStatuses,
    declaredContentTypes,
    declaredEnvelopeKeys,
    sharedRefs: [...sharedRefs],
    declaredMessages,
  };
}

// --------------------------------------------------------------------------
// Determine whether we're allowed to probe an operation
// --------------------------------------------------------------------------
function methodAllowed(method) {
  const m = method.toLowerCase();
  if (m === 'get' || m === 'head' || m === 'options') return true;
  if (m === 'delete') return ALLOW_DELETES;
  if (m === 'post' || m === 'put' || m === 'patch') return ALLOW_WRITES;
  return false;
}
function pathAllowed(path) {
  if (INCLUDE_RE && !INCLUDE_RE.test(path)) return false;
  if (EXCLUDE_RE.test(path)) return false;
  return true;
}

// --------------------------------------------------------------------------
// Build the probe request
// --------------------------------------------------------------------------

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function buildUrl(pathTemplate) {
  // Substitute path params with placeholder values that are *likely* valid.
  // For audits we want the request to reach the handler, not Apache 404.
  // Use 1 for numeric-looking params, a benign string otherwise.
  return pathTemplate.replace(/\{([^}]+)\}/g, (_, name) => {
    // Heuristic: prefer an id-like value. Real container usually 1 is valid.
    if (/id$|Number$|num$/i.test(name)) return '1';
    return '1';
  });
}

function buildProbe(method, path) {
  const url = `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const cfg = {
    method: method.toUpperCase(),
    url: buildUrl(url),
    timeout: TIMEOUT,
    maxRedirects: 0,
    validateStatus: () => true,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  };
  if (method === 'post' || method === 'put' || method === 'patch') {
    cfg.headers['Content-Type'] = 'application/json';
    cfg.data = {};
  }
  return cfg;
}

// --------------------------------------------------------------------------
// Analyze the response
// --------------------------------------------------------------------------
function classifyResponse(desc, resp) {
  const out = [];
  const status = String(resp.status);
  const ct = String(resp.headers['content-type'] || '')
    .split(';')[0]
    .trim();
  const body = resp.data;

  // 1. Status declared?
  if (!desc.declaredStatuses.has(status)) {
    out.push({
      id: `runtime-status-undeclared:${desc.operationId || desc.method + ' ' + desc.path}:${status}`,
      severity: 'high',
      category: 'runtime-status-undeclared',
      method: desc.method.toUpperCase(),
      path: desc.path,
      location: `#/paths/${jsonPointer(desc.path)}/${desc.method}/responses`,
      field: 'responses',
      current: `observed ${status}`,
      expected: `declared: ${[...desc.declaredStatuses].sort().join(', ') || '(none)'}`,
      note: `operationId=${desc.operationId}`,
    });
  }

  // 2. Content-type declared for this status?
  if (ct && body && typeof body === 'object' && !desc.declaredContentTypes.has(ct)) {
    out.push({
      id: `runtime-ct-undeclared:${desc.operationId || desc.method + ' ' + desc.path}:${status}:${ct}`,
      severity: 'low',
      category: 'runtime-content-type-undeclared',
      method: desc.method.toUpperCase(),
      path: desc.path,
      location: `#/paths/${jsonPointer(desc.path)}/${desc.method}/responses/${status}/content`,
      field: 'content',
      current: ct,
      expected: `declared: ${[...desc.declaredContentTypes].join(', ') || '(none)'}`,
      note: `operationId=${desc.operationId}`,
    });
  }

  // 3. Envelope keys observed vs declared (only for 2xx with object body)
  if (status.startsWith('2') && body && typeof body === 'object' && !Array.isArray(body)) {
    const observedKeys = new Set(Object.keys(body));
    for (const k of observedKeys) {
      if (!desc.declaredEnvelopeKeys.has(k)) {
        out.push({
          id: `runtime-envelope-extra:${desc.operationId || desc.method + ' ' + desc.path}:${k}`,
          severity: 'medium',
          category: 'runtime-envelope-mismatch',
          method: desc.method.toUpperCase(),
          path: desc.path,
          location: `#/paths/${jsonPointer(desc.path)}/${desc.method}/responses/200/content/application~1json/schema/properties`,
          field: k,
          current: `observed top-level key "${k}"`,
          expected: `declared: ${[...desc.declaredEnvelopeKeys].join(', ') || '(none)'}`,
          note: `operationId=${desc.operationId}`,
        });
      }
    }
    // meta/rels shape
    if ('meta' in body && desc.declaredEnvelopeKeys.has('meta')) {
      const observed = Array.isArray(body.meta) ? 'array' : typeof body.meta;
      // Most OrangeHRM endpoints declare meta as object but emit [].
      // Flag only when shape differs and spec doesn't already say array/object accordingly.
      const specSchema =
        j.paths[desc.path]?.[desc.method]?.responses?.['200']?.content?.['application/json']?.schema
          ?.properties?.meta;
      const specType = specSchema?.type;
      if (specType && specType !== observed) {
        out.push({
          id: `runtime-meta-shape:${desc.operationId || desc.method + ' ' + desc.path}`,
          severity: 'medium',
          category: 'runtime-envelope-mismatch',
          method: desc.method.toUpperCase(),
          path: desc.path,
          location: `#/paths/${jsonPointer(desc.path)}/${desc.method}/responses/200/content/application~1json/schema/properties/meta`,
          field: 'meta',
          current: `observed ${observed}`,
          expected: `spec says ${specType}`,
          note: `operationId=${desc.operationId}`,
        });
      }
    }
    if ('rels' in body && desc.declaredEnvelopeKeys.has('rels')) {
      const observed = Array.isArray(body.rels) ? 'array' : typeof body.rels;
      const specSchema =
        j.paths[desc.path]?.[desc.method]?.responses?.['200']?.content?.['application/json']?.schema
          ?.properties?.rels;
      const specType = specSchema?.type;
      if (specType && specType !== observed) {
        out.push({
          id: `runtime-rels-shape:${desc.operationId || desc.method + ' ' + desc.path}`,
          severity: 'medium',
          category: 'runtime-envelope-mismatch',
          method: desc.method.toUpperCase(),
          path: desc.path,
          location: `#/paths/${jsonPointer(desc.path)}/${desc.method}/responses/200/content/application~1json/schema/properties/rels`,
          field: 'rels',
          current: `observed ${observed}`,
          expected: `spec says ${specType}`,
          note: `operationId=${desc.operationId}`,
        });
      }
    }
  }

  // 4. Error message drift against declared shared component
  if (body && body.error && typeof body.error === 'object') {
    const observedMsg = body.error.message;
    const declaredMsg = desc.declaredMessages[status];
    if (observedMsg && declaredMsg && observedMsg !== declaredMsg) {
      out.push({
        id: `runtime-msg-drift:${desc.operationId || desc.method + ' ' + desc.path}:${status}`,
        severity: 'medium',
        category: 'runtime-error-message-drift',
        method: desc.method.toUpperCase(),
        path: desc.path,
        location: `#/paths/${jsonPointer(desc.path)}/${desc.method}/responses/${status}`,
        field: 'error.message',
        current: JSON.stringify(observedMsg),
        expected: JSON.stringify(declaredMsg),
        note: `operationId=${desc.operationId}`,
      });
    }
  }

  return out;
}

// --------------------------------------------------------------------------
// Main probe loop
// --------------------------------------------------------------------------
async function run() {
  TOKEN = loadToken();
  const client = axios.create({
    baseURL: BASE,
    timeout: TIMEOUT,
    maxRedirects: 0,
    validateStatus: () => true,
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  // Build the probe plan
  const plan = [];
  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      if (!methodAllowed(method)) continue;
      if (!pathAllowed(path)) continue;
      plan.push(describeOperation(method, path, op));
    }
  }

  console.log('');
  console.log('============================================================');
  console.log(' RUNTIME PROBE');
  console.log('============================================================');
  console.log(`base        : ${BASE}`);
  console.log(`token file  : ${TOKEN_FILE}`);
  console.log(`mode        : ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`writes      : ${ALLOW_WRITES ? 'allowed' : 'blocked'}`);
  console.log(`deletes     : ${ALLOW_DELETES ? 'allowed' : 'blocked'}`);
  console.log(`include     : ${INCLUDE_RE || '(all)'}`);
  console.log(`exclude     : ${EXCLUDE_RE}`);
  console.log(`delay       : ${DELAY} ms`);
  console.log(`concurrency : ${CONCURRENCY}`);
  console.log(`planned     : ${plan.length} probes`);
  console.log('');

  if (!EXECUTE) {
    console.log('DRY RUN — listing operations that would be probed:');
    for (const d of plan) console.log(`  ${d.method.toUpperCase().padEnd(7)} ${d.path}`);
    console.log('');
    console.log('Re-run with --execute to send requests.');
    return;
  }

  const findings = [];
  const observedLog = [];
  let count = 0;

  async function probeOne(desc) {
    if (MAX_PROBES && count >= MAX_PROBES) return;
    count++;
    const req = buildProbe(desc.method, desc.path);
    let resp;
    try {
      resp = await client.request(req);
    } catch (e) {
      observedLog.push({
        method: desc.method.toUpperCase(),
        path: desc.path,
        status: 'ERR',
        error: e.code || e.message,
      });
      return;
    }

    observedLog.push({
      method: desc.method.toUpperCase(),
      path: desc.path,
      status: resp.status,
      contentType: resp.headers['content-type'],
      bodyTopKeys:
        resp.data && typeof resp.data === 'object' && !Array.isArray(resp.data)
          ? Object.keys(resp.data)
          : null,
    });

    const f = classifyResponse(desc, resp);
    findings.push(...f);

    const tag = f.length ? `(+${f.length})` : '';
    console.log(`  ${desc.method.toUpperCase().padEnd(7)} ${desc.path} → ${resp.status} ${tag}`);
  }

  // concurrency-limited iteration
  let cursor = 0;
  async function worker() {
    while (cursor < plan.length) {
      const i = cursor++;
      const desc = plan[i];
      await probeOne(desc);
      if (DELAY) await new Promise((r) => setTimeout(r, DELAY));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // ------------------------------------------------------------------------
  // Emit findings
  // ------------------------------------------------------------------------
  findings.sort((a, b) => {
    const sev = { high: 0, medium: 1, low: 2, info: 3 };
    if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.id.localeCompare(b.id);
  });

  const lines = [
    `# Runtime findings: ${findings.length}`,
    `# base: ${BASE}`,
    `# Format: ID | SEV | CATEGORY | METHOD | PATH | FIELD | CURRENT -> EXPECTED`,
    '',
  ];
  for (const f of findings) {
    lines.push(
      `${f.id} | ${f.severity} | ${f.category} | ${f.method} | ${f.path} | ${f.field} | ${f.current} -> ${f.expected}`,
    );
  }
  fs.writeFileSync(OUT_TXT, lines.join('\n'), 'utf8');

  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
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

  // observed log (not findings — evidence)
  fs.writeFileSync(
    './swagger-runtime-observed.json',
    JSON.stringify(
      { generatedAt: new Date().toISOString(), base: BASE, observed: observedLog },
      null,
      2,
    ),
    'utf8',
  );

  // snapshot for diff
  const currentIds = findings.map((f) => f.id).sort();
  const snapshot = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    total: findings.length,
    ids: currentIds,
    byCategory: findings.reduce((a, f) => ((a[f.category] = (a[f.category] || 0) + 1), a), {}),
    bySeverity: findings.reduce((a, f) => ((a[f.severity] = (a[f.severity] || 0) + 1), a), {}),
  };

  // diff against baseline
  if (BASELINE && fs.existsSync(BASELINE)) {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const baseSet = new Set(base.ids || []);
    const currSet = new Set(currentIds);
    const closed = (base.ids || []).filter((id) => !currSet.has(id));
    const remaining = (base.ids || []).filter((id) => currSet.has(id));
    const added = currentIds.filter((id) => !baseSet.has(id));

    console.log('');
    console.log('============================================================');
    console.log(' DIFF vs baseline');
    console.log('============================================================');
    console.log(`closed     : ${closed.length}`);
    console.log(`remaining  : ${remaining.length}`);
    console.log(`added (new): ${added.length}`);
    console.log(`total now  : ${currentIds.length}`);
    if (added.length) {
      console.log('');
      console.log('--- ADDED ---');
      added.forEach((id) => console.log(`  ✗ ${id}`));
    }
  }

  fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2), 'utf8');

  console.log('');
  console.log('Artifacts:');
  console.log(`  ${OUT_TXT}`);
  console.log(`  ${OUT_CSV}`);
  console.log(`  ./swagger-runtime-observed.json`);
  console.log(`  ${SNAPSHOT}`);
  console.log(`Total runtime findings: ${findings.length}`);
  console.log('By severity  :', snapshot.bySeverity);
  console.log('By category  :', snapshot.byCategory);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
