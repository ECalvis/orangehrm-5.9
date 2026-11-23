# OrangeHRM 5.9 QA Automation

Playwright integration framework for validating OrangeHRM through its UI, REST API, and a read-only database connection.

## Setup

Requirements: Node.js/npm, access to an OrangeHRM 5.9 instance, and Chromium for Playwright.

1. Install dependencies: `npm ci`
2. Install the browser: `npx playwright install chromium`
3. Copy `.env.example` to `.env` and configure the OrangeHRM URL, OAuth client, Admin/ESS accounts, and database connection.
4. Register the Playwright OAuth client in OrangeHRM with the redirect URI configured by `OHRM_OAUTH_REDIRECT_URI`. Use a read-only database account for test verification.

Keep `.env` and token files private; they are excluded from Git.

## Tests

```powershell
npm test                    # framework/unit tests
npm run test:live            # live integration tests; mutating workflows are skipped by default
npm run test:live:failed     # rerun the most recently failed live tests
npm run lint
npm run format:check
```

To opt into live tests that create or change OrangeHRM records:

```powershell
$env:OHRM_RUN_MUTATING_LIVE_TESTS = 'true'
npm run test:live
```

These workflows use unique test-owned records. Cleanup uses supported OrangeHRM lifecycle operations where available; timesheets and referenced time records may be retained as history. Do not use hard deletion as routine test cleanup.

## Layers

- `src/auth/` — OAuth and token lifecycle
- `src/api/` — HTTP client and OrangeHRM API endpoints
- `src/db/` — read-only queries and repositories
- `src/ui/` — Playwright page objects and OXD components
- `src/workflows/` — cross-layer business orchestration
- `tests/framework/` — isolated framework tests
- `tests/live/` — integration scenarios against OrangeHRM

More detail: [API](./docs/api.md), [database](./docs/database.md), [architecture](./docs/architecture.md), and [setup notes](./docs/start.md).
