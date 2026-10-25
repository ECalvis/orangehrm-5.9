# Swagger Analysis Scripts

This directory contains analysis scripts for the OrangeHRM OpenAPI specification.

## Scripts

### Static Analysis Scripts

- **swagger-analysis.js** - Comprehensive static analysis of the OpenAPI spec
- **swagger-findings.js** - Finds spec defects and inconsistencies
- **swagger-summary.js** - High-level spec statistics
- **swagger-schemas.js** - Complete schema inventory
- **swagger-endpoints.js** - Per-operation endpoint inventory

### Runtime Analysis Scripts

- **swagger-runtime-probe.js** - Live runtime probing against the running container

## Usage

Run scripts from the project root:

```bash
# Static analysis
node swagger/analysis/swagger-analysis.js
node swagger/analysis/swagger-findings.js
node swagger/analysis/swagger-summary.js
node swagger/analysis/swagger-schemas.js
node swagger/analysis/swagger-endpoints.js

# Runtime probing (requires running container and valid token)
node swagger/analysis/swagger-runtime-probe.js --execute --token-file auth/admin.token.json
```

## Output Files

All output files are generated in this directory (`swagger/analysis/`):

- `swagger-analysis.txt` - Static analysis report (prose)
- `swagger-findings.csv` / `swagger-findings.txt` - Static findings worklist
- `swagger-findings.snapshot.json` - Static baseline for diffing
- `swagger-runtime-findings.csv` / `swagger-runtime-findings.txt` - Runtime findings worklist
- `swagger-runtime-observed.json` - Per-request observed status/content-type/top-level-keys log
- `swagger-runtime.snapshot.json` - Runtime baseline for diffing
- `swagger-summary.txt` - High-level spec statistics
- `swagger-schemas.txt` - Full schema inventory
- `swagger-endpoints.txt` - Per-operation endpoint inventory

## Documentation

See [docs/api-audit.md](../../docs/api-audit.md) for detailed information about the audit methodology and findings.
