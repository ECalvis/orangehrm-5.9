# OrangeHRM 5.9 — API Specification Audit

**Date:** 2026-10-07
**Spec under audit:** `swagger/orangehrm-v2.json` (OpenAPI 3.1.0, spec version 2.8.0, as shipped in the 5.9 release)
**Runtime under audit:** the local dev container (`orangehrm_5.9_app`, image built from `orangehrm-5.9.zip`)
**Auditor:** Emari Joyce (QA automation)

## What we set out to do

Determine whether the OpenAPI spec that ships with OrangeHRM 5.9 accurately describes the running API, and if not, catalogue the specific defects in a form the upstream project can act on.

## How we checked

Two independent passes:

1. **Static analysis** of the spec against a curated expectation table and internal-consistency rules (`swagger-analysis.js`, `swagger-findings.js`). Detects response-schema mismatches, suspicious data types, typos, malformed paths, and request/response asymmetries without touching the runtime.

2. **Live runtime probing** (`swagger-runtime-probe.js`) — 234 authenticated GET requests against the running container, comparing observed status codes, response envelopes, error message strings, and content types against what the spec claims. Snapshot-based diffing so future runs can be compared against this baseline.

Both tools emit findings as flat CSV worklists with stable IDs, grouped by severity and category.

## What we found

**~180 specification defects** in three dominant classes plus seven minor ones:

- **Missing `rels` envelope key** (127 findings) — every successful response ends with `"rels": []`, but the spec's success schemas don't declare `rels` at all. One fix in the shared envelope schema closes all 127.
- **`meta` type wrong** (33 findings) — the spec declares `meta` as `object`; the runtime emits `"meta": []` (array). One schema fix.
- **`RecordNotFound` message string wrong** — the shared response component says `"Record Not Found"`; the runtime emits `"Records Not Found"`. Affects 216 documented responses.
- **Ten additional per-field or per-operation defects** — dates typed as `number` (23 fields), a currency code typed as `integer`, an incorrect `$ref` on 8 operations, 4 documented-but-unrouted endpoints, a stray `}` in a path, missing `422`/`403` response declarations, and three spelling typos.

**2 confirmed runtime bugs** (not spec defects — genuine PHP null-handling bugs in the shipped release):

- `GET /api/v2/performance/reviews/{reviewId}/evaluation/employee` — `TypeError` when the review doesn't exist (`EmployeeEvaluationAPI.php:124`).
- `GET /api/v2/performance/reviews/{reviewId}/evaluation/supervisor` — same defect (`SupervisorEvaluationAPI.php:153`).

Stack traces are in the audit artifacts.

**~50 probe artifacts**, not defects: 501/422 responses on endpoints the probe called without their required query parameters, and 404s on `{id}` endpoints where the probe's placeholder ID doesn't exist. These will be suppressed in a future probe iteration; they don't represent anything wrong with the API or the spec.

## Artifacts

All audit outputs live in the repository root:

| File                                    | Contents                                                    |
| --------------------------------------- | ----------------------------------------------------------- |
| `swagger-analysis.txt`                  | Static analysis report (prose)                              |
| `swagger-findings.csv` / `.txt`         | Static findings worklist                                    |
| `swagger-findings.snapshot.json`        | Static baseline for diffing                                 |
| `swagger-runtime-findings.csv` / `.txt` | Runtime findings worklist (213 rows)                        |
| `swagger-runtime-observed.json`         | Per-request observed status/content-type/top-level-keys log |
| `swagger-runtime.snapshot.json`         | Runtime baseline for diffing                                |
| `swagger-summary.txt`                   | High-level spec statistics                                  |
| `swagger-schemas.txt`                   | Full schema inventory                                       |
| `swagger-endpoints.txt`                 | Per-operation endpoint inventory                            |

Re-run instructions for each tool are in the docstrings at the top of the corresponding `.js` file.

## Status

The audit is complete. No changes to the spec or runtime were made — this is a read-only findings report. Remediation is upstream work: the spec is generated from PHP annotations inside the OrangeHRM release, so fixes would live in the OrangeHRM source tree, not in this QA harness.

The findings list is available for whoever owns the API contract. The two runtime bugs are concrete enough to file as upstream issues with the stack traces attached.
