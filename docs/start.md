OrangeHRM QA Framework — Consolidated Architecture
You've given me all the research docs, the existing framework skeleton, the current 4-file auth code, and the plan to rebuild auth cleanly. Here is the consolidated answer.

Part 1 — The Decision You've Already Made (Confirm It)
Phase 1 = auth only. Six flat files. No nesting. No roles inside auth.

text
src/auth/
├── pkce.js
├── oauth-client.js
├── oauth-authorizer.js
├── token-store.js
├── token-manager.js
└── errors.js
That is the right call. Everything below is the concrete implementation that matches your research findings, so you can write the six files and stop deliberating.

Part 2 — The Boundaries (This Is the Whole Architecture)
File Knows About MUST NOT Know About
pkce.js crypto Everything else
errors.js nothing nothing
oauth-client.js axios, config object, ./pkce, ./errors Playwright, files, roles, @playwright/test
oauth-authorizer.js playwright (not @playwright/test), http, config object Tokens, axios, files, refresh logic
token-store.js fs OAuth, Playwright, refresh logic, roles
token-manager.js the four above (injected) HTTP details, Playwright details, file paths, roles
If you ever want to import Playwright into oauth-client.js, or roles into token-manager.js, you've broken the design. Re-read this table.

Part 3 — Data Contracts (Freeze These)
js
// pkce.js
{ createVerifier(), createChallenge(verifier), createState() }

// oauth-client.js
createAuthorizationRequest() → { url, verifier, state }
exchangeCode({ code, verifier }) → Token
refresh(refreshToken) → Token

// Token (internal, camelCase — wire format dies at the boundary)
{
accessToken: string,
refreshToken: string | null,
tokenType: 'Bearer',
expiresAt: number | null // epoch ms
}

// oauth-authorizer.js
authorize({ authorizationUrl, expectedState }) → { code, state }

// token-store.js
{ load() → Token | null, save(Token), clear() }

// token-manager.js
{ getAccessToken() → string, clear() }
The single most important rule: access_token, refresh_token, expires_in are wire format. They are translated once, inside oauth-client.js. Nowhere else in the framework should ever see snake_case.

Auth tests live in `tests/auth.spec.js` and run with `npm test`. They cover PKCE, OAuth token requests and normalization, callback state validation, token refresh/caching, and file-store behavior. A local browser integration test exercises the authorizer's login, consent, and callback flow without OrangeHRM credentials. The four live OrangeHRM scenarios (cold, warm, expired with refresh, and expired with invalid refresh) are separate manual integration checks and are not part of `npm test`.

Part 4 — What Your Current Code Gets Wrong (Concretely)
Violation Location Fix
Protocol layer imports chromium from @playwright/test oauth-client.js Move browser code to oauth-authorizer.js; import playwright (not @playwright/test)
TokenManager knows about roles token-manager.js constructor(roleName) Inject collaborators; roles live in src/config/users.js
Snake_case leaks everywhere normalizeTokenResponse returns access_token, expires_at Return camelCase Token; convert at boundary
OAuthClient reaches into global config require('../../../config/config') Constructor takes a plain config object
Redundant await on callbackPromise Promise.all([allowButton.click(), callbackPromise]) then await callbackPromise Restructure: const cb = waitForCallback(...); await allowButton.click(); const { code } = await cb;
AuthenticationError from ../../core/errors creates unused hierarchy Own errors.js in src/auth/
@playwright/test in auth infra can't run outside test runner Use playwright package
Part 5 — Concrete File Sketches
src/auth/pkce.js
js
const crypto = require('crypto');

function base64url(buf) {
return buf.toString('base64')
.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createVerifier() {
return base64url(crypto.randomBytes(64));
}

function createChallenge(verifier) {
return base64url(crypto.createHash('sha256').update(verifier).digest());
}

function createState() {
return crypto.randomBytes(16).toString('hex');
}

module.exports = { createVerifier, createChallenge, createState };
No classes. No config. No logging. Just PKCE.

src/auth/errors.js
js
class AuthenticationError extends Error {
constructor(message, meta = {}) {
super(message);
this.name = 'AuthenticationError';
Object.assign(this, meta);
}
}

module.exports = { AuthenticationError };
src/auth/oauth-client.js
js
const axios = require('axios');
const { createVerifier, createChallenge, createState } = require('./pkce');
const { AuthenticationError } = require('./errors');

class OAuthClient {
constructor({ authorizationUrl, tokenUrl, clientId, redirectUri }) {
this.authorizationUrl = authorizationUrl;
this.tokenUrl = tokenUrl;
this.clientId = clientId;
this.redirectUri = redirectUri;
}

createAuthorizationRequest() {
const verifier = createVerifier();
const challenge = createChallenge(verifier);
const state = createState();

    const url = new URL(this.authorizationUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);

    return { url: url.toString(), verifier, state };

}

async exchangeCode({ code, verifier }) {
return this._tokenRequest({
grant_type: 'authorization_code',
code,
client_id: this.clientId,
redirect_uri: this.redirectUri,
code_verifier: verifier,
}, 'Token exchange');
}

async refresh(refreshToken) {
return this._tokenRequest({
grant_type: 'refresh_token',
refresh_token: refreshToken,
client_id: this.clientId,
}, 'Token refresh');
}

async _tokenRequest(params, label) {
const body = new URLSearchParams(params).toString();
try {
const { data } = await axios.post(this.tokenUrl, body, {
headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
return this._normalize(data);
} catch (err) {
const wire = err.response?.data;
throw new AuthenticationError(
`${label} failed: ${wire?.error || err.message}`,
{ status: err.response?.status, hint: wire?.hint },
);
}
}

// The ONLY place snake_case is allowed.
_normalize(data) {
if (!data?.access_token) {
throw new AuthenticationError('Token response missing access_token');
}
return {
accessToken: data.access_token,
refreshToken: data.refresh_token ?? null,
tokenType: data.token_type ?? 'Bearer',
expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
};
}
}

module.exports = { OAuthClient };
Note: no Playwright. No file I/O. No roles. No global config.

src/auth/oauth-authorizer.js
js
const http = require('http');
const { chromium } = require('playwright'); // NOT @playwright/test
const { AuthenticationError } = require('./errors');

class OAuthAuthorizer {
constructor({ callbackHost, callbackPort, callbackPath }) {
this.callbackHost = callbackHost;
this.callbackPort = callbackPort;
this.callbackPath = callbackPath;
}

async authorize({ authorizationUrl, expectedState, credentials }) {
const callback = this._listen(expectedState); // start BEFORE browser

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(authorizationUrl, { waitUntil: 'domcontentloaded' });

      // Login form (only shown if no session)
      const username = page.getByRole('textbox', { name: 'Username' });
      if (await username.isVisible().catch(() => false)) {
        await username.fill(credentials.username);
        await page.getByRole('textbox', { name: 'Password' })
          .fill(credentials.password);
        await page.getByRole('button', { name: 'Login' }).click();
      }

      // Consent screen
      const allow = page.getByRole('button', { name: /allow access/i });
      await allow.waitFor({ state: 'visible', timeout: 15_000 });
      await allow.click();

      return await callback;
    } finally {
      await browser.close();
    }

}

_listen(expectedState) {
return new Promise((resolve, reject) => {
let settled = false;
const finish = (err, val) => {
if (settled) return;
settled = true;
server.close(() => (err ? reject(err) : resolve(val)));
};

      const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://${this.callbackHost}:${this.callbackPort}`);
        if (url.pathname !== this.callbackPath) {
          res.writeHead(404); res.end(); return;
        }
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization complete</h1>');

        if (error) return finish(new AuthenticationError(`OAuth error: ${error}`));
        if (!code) return finish(new AuthenticationError('No code in callback'));
        if (state !== expectedState) {
          return finish(new AuthenticationError('State mismatch'));
        }
        finish(null, { code, state });
      });

      server.on('error', finish);
      server.listen(this.callbackPort, this.callbackHost);
    });

}
}

module.exports = { OAuthAuthorizer };
Note: no axios, no tokens, no file paths, no roles.

src/auth/token-store.js
js
const fs = require('fs');
const path = require('path');

class FileTokenStore {
constructor(filePath) { this.filePath = filePath; }

load() {
try {
if (!fs.existsSync(this.filePath)) return null;
return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
} catch { return null; }
}

save(tokens) {
fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
fs.writeFileSync(this.filePath, JSON.stringify(tokens, null, 2), {
mode: 0o600,
});
}

clear() {
try { fs.unlinkSync(this.filePath); } catch { /* ignore */ }
}
}

module.exports = { FileTokenStore };
Note: no refresh, no expiry decisions, no OAuth, no Playwright, no roles.

src/auth/token-manager.js
js
const { AuthenticationError } = require('./errors');

class TokenManager {
// All collaborators injected. No role. No file path. No config.
constructor({ oauth, authorizer, store, credentials, refreshSafetyMs = 60_000 }) {
this.oauth = oauth;
this.authorizer = authorizer;
this.store = store;
this.credentials = credentials;
this.refreshSafetyMs = refreshSafetyMs;
this.inFlight = null;
}

async getAccessToken() {
const cached = this.store.load();
if (this._isValid(cached)) return cached.accessToken;

    // Deduplicate concurrent calls
    if (!this.inFlight) {
      this.inFlight = this._acquire().finally(() => { this.inFlight = null; });
    }
    return (await this.inFlight).accessToken;

}

async _acquire() {
const cached = this.store.load();

    if (cached?.refreshToken) {
      try {
        const refreshed = await this.oauth.refresh(cached.refreshToken);
        this.store.save(refreshed);
        return refreshed;
      } catch { /* fall through to full auth */ }
    }

    const authReq = this.oauth.createAuthorizationRequest();
    const { code } = await this.authorizer.authorize({
      authorizationUrl: authReq.url,
      expectedState: authReq.state,
      credentials: this.credentials,
    });
    const tokens = await this.oauth.exchangeCode({
      code, verifier: authReq.verifier,
    });
    this.store.save(tokens);
    return tokens;

}

_isValid(t) {
if (!t?.accessToken) return false;
if (!t.expiresAt) return true;
return Date.now() + this.refreshSafetyMs < t.expiresAt;
}

clear() { this.store.clear(); }
}

module.exports = { TokenManager };
That is the whole design. TokenManager orchestrates; it knows nothing about the wire, the browser, or the file system details.

Part 6 — Where Roles Belong (Not in Auth)
js
// src/config/users.js
const path = require('path');

const AUTH_DIR = path.resolve(__dirname, '../../auth');

module.exports = {
admin: {
username: process.env.OHRM_ADMIN_USERNAME,
password: process.env.OHRM_ADMIN_PASSWORD,
tokenFile: path.join(AUTH_DIR, 'admin.token.json'),
},
ess: {
username: process.env.OHRM_ESS_USERNAME,
password: process.env.OHRM_ESS_PASSWORD,
tokenFile: path.join(AUTH_DIR, 'ess.token.json'),
},
};
Roles are a fixture-layer concept. Auth never sees the word "admin."

Part 7 — Composition Root (scripts/obtain-token.js)
One file wires everything. This is the only place that constructs concrete collaborators.

js
require('dotenv').config();
const { OAuthClient } = require('../src/auth/oauth-client');
const { OAuthAuthorizer } = require('../src/auth/oauth-authorizer');
const { FileTokenStore } = require('../src/auth/token-store');
const { TokenManager } = require('../src/auth/token-manager');
const users = require('../src/config/users');

async function main(roleName) {
const role = users[roleName];
if (!role) throw new Error(`Unknown role: ${roleName}`);

const baseUrl = process.env.OHRM_BASE_URL;

const oauth = new OAuthClient({
authorizationUrl: `${baseUrl}/web/index.php/oauth2/authorize`,
tokenUrl: `${baseUrl}/web/index.php/oauth2/token`,
clientId: process.env.OHRM_OAUTH_CLIENT_ID,
redirectUri: process.env.OHRM_OAUTH_REDIRECT_URI,
});

const authorizer = new OAuthAuthorizer({
callbackHost: 'localhost',
callbackPort: 9876,
callbackPath: '/oauth/callback',
});

const store = new FileTokenStore(role.tokenFile);

const manager = new TokenManager({
oauth, authorizer, store,
credentials: { username: role.username, password: role.password },
});

console.log(await manager.getAccessToken());
}

main(process.argv[2] || 'admin').catch(err => {
console.error(err);
process.exit(1);
});
Part 8 — Phase 1 Acceptance Criteria
Write these four specs before moving on. They are your regression net for everything else.

# Setup Expected

1 No token file Full flow: browser → login → consent → write file
2 Valid token file (expiresAt far future) Returns immediately, no browser
3 Expired token file, valid refresh_token Calls refresh, writes new file, no browser
4 Expired token + expired refresh_token Falls back to full flow
If all four pass, Phase 1 is done.

Part 9 — Principles You're Actually Applying (Defensible Naming)
SRP — six files, six responsibilities

DIP — TokenManager depends on injected collaborators, not concrete classes

Boundary translation — snake_case dies in _normalize(); nothing else sees it

Composition root — one place wires; nothing else constructs

Law of Demeter — oauth.createAuthorizationRequest() returns { url, verifier, state }, not oauth.config.oauth.authorizationUrl

No speculative generality — no core/, no orangehrm/, no browser/; add folders only when you have code for them

Explicit over implicit — config passed in, not read from globals

Part 10 — Full Project Structure (Phases Ahead, Not Now)
Keep this in mind but do not create folders until you have code for them. Empty folders are lies about progress.

text
orangehrm-qa/
├── scripts/obtain-token.js
├── src/
│ ├── auth/ # Phase 1 (now)
│ │ ├── pkce.js
│ │ ├── oauth-client.js
│ │ ├── oauth-authorizer.js
│ │ ├── token-store.js
│ │ ├── token-manager.js
│ │ └── errors.js
│ ├── config/ # Phase 1 (now)
│ │ ├── env.js
│ │ └── users.js
│ ├── api/ # Phase 2
│ ├── db/ # Phase 3
│ ├── ui/ # Phase 4
│ ├── data/ # Phase 2+
│ └── fixtures/ # Phase 4 (Playwright fixtures)
└── tests/ # Phase 4+
Add each folder when the phase begins. Not before.

Part 11 — The Four Guiding Rules You Keep Coming Back To
External representation stays at the boundary. Internal representation is yours. (access_token → accessToken, once.)

Each file has one reason to change. (Table in Part 2.)

Nothing constructs its own dependencies except the composition root. (scripts/obtain-token.js.)

No abstraction without a second concrete use case. (Don't add orangehrm/, core/, browser/ until you actually need them.)

Part 12 — What To Do Right Now (Concrete Order)
Make a fresh folder. npm init -y. Install playwright axios dotenv.

Write .env, .env.example, .gitignore (include auth/*.token.json).

Write src/auth/errors.js — 30 seconds.

Write src/auth/pkce.js — 15 minutes.

Write src/auth/oauth-client.js — no Playwright, no globals.

Write src/auth/oauth-authorizer.js — no axios, no tokens.

Write src/auth/token-store.js — boring on purpose.

Write src/auth/token-manager.js — injected collaborators only.

Write src/config/users.js and src/config/env.js.

Write scripts/obtain-token.js.

Run node scripts/obtain-token.js admin. Iterate.

Write the four specs from Part 8.

Stop. Phase 1 is done. Do not add Phase 2 folders until you build Phase 2.

One Final Note
You already have the research done — the OAuth flow, the endpoints, the error envelopes, the quirk that invalid Bearer returns 302/HTML, the PKCE requirement, the public-client shape, the refresh rotation. All of that lives in the docs you pasted. What you were missing was a decisive file layout, and now you have it.

Six flat files. Correct boundaries. Composition root. Roles outside auth. camelCase internally, snake_case only at the boundary. Use playwright, not @playwright/test.

Build it. Then tell me what broke.

supposed we now know how auth can be compose, what about api client and usage? since it was kind of connected to auth framework
i also need to have one for api
Phase 2 — API Client Layer
The API client is where the auth framework finally pays off. Phase 1 gave you a TokenManager that yields a valid accessToken on demand. Phase 2 is where you turn that token into HTTP requests against OrangeHRM's /api/v2/... and normalize responses at the boundary — exactly the same discipline you applied in auth.

Here is the decisive plan.

Part 1 — The One Decision That Matters
text
src/api/
├── client.js # HTTP transport + auth + envelope unwrap + error mapping
├── errors.js # ApiError taxonomy
├── envelope.js # {data, meta, rels} + {error: {...}} normalizers
├── resource.js # shared method/path route-group builder
├── index.js # createApi composition root
└── endpoints/
    ├── admin.js, attendance.js, authentication.js, branding.js, buzz.js
    ├── claim.js, core.js, dashboard.js, directory.js, employees.js
    ├── ldap.js, leave.js, maintenance.js, mobile.js, openid.js
    ├── performance.js, pim.js, recruitment.js, system.js, time.js
    ├── users.js, workspace-notifications.js

The facade covers all **523 HTTP method + path operations** declared in the 23
plugin `routes.yaml` files in the bundled OrangeHRM 5.9 source archive. It
excludes non-API file routes and legacy API v1, consistent with `docs/api.md`.

Do not add schemas/, resources/, models/, or contracts/ yet. Those belong to Phase 3 (contract validation) when you actually have a reason to add them.

Part 2 — The Boundaries (This Is the Whole Architecture)
File Knows About MUST NOT Know About
errors.js nothing nothing
envelope.js nothing but JS objects axios, auth, config
client.js axios, TokenManager (injected), ./envelope, ./errors, base config Playwright, DB, tests, roles
endpoints/*.js the client, endpoint paths, param shapes auth, env, axios, envelope shape
If you ever want to import TokenManager into endpoints/employees.js, stop. If you ever want to import axios into endpoints/employees.js, stop. The endpoint files speak domain language. The client speaks HTTP.

Part 3 — Data Contracts (Freeze These)
js
// client.js — public surface
{
get(path, { params, headers }?) → Data
post(path, body, { headers }?) → Data
put(path, body, { headers }?) → Data
delete(path, body?, { headers }?) → Data
request(opts) → Data
raw(opts) → AxiosResponse (escape hatch, rarely)
}

// Data — what callers receive
{
data: T | T[], // envelope.data
meta: object | array, // OrangeHRM uses [] for single resources and objects for collections
rels: array // envelope.rels (usually [])
}
Critical design choice: the client returns the whole envelope {data, meta, rels}. It does not flatten. Why? Because list endpoints need meta.total for pagination assertions, and hiding it means tests re-fetch. Keep the envelope; make it explicit.

If you want convenience, add getOne() / getAll() on the endpoint layer that pick data and data + meta respectively.

js
// errors.js
class ApiError extends Error {
constructor(message, { status, code, data, raw } = {}) {
super(message);
this.name = 'ApiError';
this.status = status; // number | string (OrangeHRM quirk)
this.code = code; // includes UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION, OAUTH_ERROR
this.data = data; // error.data (invalidParamKeys, etc.)
this.raw = raw;
}
}
Part 4 — Concrete File Sketches
src/api/errors.js
js
class ApiError extends Error {
constructor(message, { status, code, data, raw } = {}) {
super(message);
this.name = 'ApiError';
this.status = status;
this.code = code;
this.data = data;
this.raw = raw;
}
}

module.exports = { ApiError };
Nothing else. Same shape as AuthenticationError.

src/api/envelope.js
Pure functions. No axios. No auth. No config.

js
// OrangeHRM quirks captured here, once:
// - success: { data, meta, rels } (meta is [] for single resources, {} for collections)
// - error: { error: { status, message, data? } }
// - status may be number OR string ("422", "404" are strings; 401, 403 are numbers)
// - League OAuth errors are a different envelope and never reach here

function normalizeSuccess(body) {
return {
data: body?.data ?? null,
meta: body?.meta ?? {},
rels: body?.rels ?? [],
};
}

const STATUS_CODE_MAP = {
401: 'UNAUTHORIZED',
403: 'FORBIDDEN',
404: 'NOT_FOUND',
422: 'VALIDATION',
400: 'BAD_REQUEST',
500: 'SERVER_ERROR',
};

function classify(statusNumber, errorBody) {
// OrangeHRM uses strings for 404/422 and numbers for 401/403
const numeric = Number(statusNumber);
return STATUS_CODE_MAP[numeric] ?? 'UNKNOWN';
}

function normalizeError(axiosError) {
const res = axiosError.response;
const err = res?.data?.error;

// League OAuth shape leaks through only if called via oauth path — not expected here
if (res?.data?.error_description) {
return {
message: res.data.error_description,
status: res.status,
code: 'OAUTH_ERROR',
data: { hint: res.data.hint },
};
}

return {
message: err?.message ?? axiosError.message,
status: err?.status ?? res?.status,
code: classify(res?.status, err),
data: err?.data,
};
}

module.exports = { normalizeSuccess, normalizeError };
Every OrangeHRM quirk is here and nowhere else. If the API ever changes its envelope, you fix one file.

src/api/client.js
js
const axios = require('axios');
const { ApiError } = require('./errors');
const { normalizeSuccess, normalizeError } = require('./envelope');

class ApiClient {
// TokenManager is injected. So is baseUrl. So is a logger (optional).
constructor({ baseUrl, tokenManager, logger }) {
this.baseUrl = baseUrl.replace(/\/$/, '');
this.tokenManager = tokenManager;
this.logger = logger ?? { debug() {}, info() {}, warn() {}, error() {} };

    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: { Accept: 'application/json' },
      // Do NOT set validateStatus globally — we handle non-2xx via catch
      validateStatus: (s) => s >= 200 && s < 300,
    });

    this.http.interceptors.request.use(async (cfg) => {
      const token = await this.tokenManager.getAccessToken();
      cfg.headers.Authorization = `Bearer ${token}`;
      this.logger.debug?.({ method: cfg.method, url: cfg.url }, 'api →');
      return cfg;
    });

}

async request(config) {
try {
const res = await this.http.request(config);
return normalizeSuccess(res.data);
} catch (err) {
const norm = normalizeError(err);
throw new ApiError(norm.message, {
status: norm.status,
code: norm.code,
data: norm.data,
raw: err.response,
});
}
}

get(path, { params, headers } = {}) {
return this.request({ method: 'GET', url: path, params, headers });
}

post(path, body, { headers } = {}) {
return this.request({ method: 'POST', url: path, data: body, headers });
}

put(path, body, { headers } = {}) {
return this.request({ method: 'PUT', url: path, data: body, headers });
}

delete(path, body, { headers } = {}) {
return this.request({ method: 'DELETE', url: path, data: body, headers });
}
}

module.exports = { ApiClient };
Key points:

Token is fetched on every request through TokenManager.getAccessToken(). Because Phase 1 caches and refreshes, this is cheap and correct.

HTTP failures are normalized to ApiError; authentication failures from TokenManager propagate unchanged so callers can distinguish them. Axios errors do not leak through the regular request methods.

The envelope is normalized here — endpoints never see raw axios responses.

One interceptor. One place. No magic.

logger is optional. If you don't have one, pass nothing.

The client accepts only relative API paths, fixes each request to the configured base URL, and disables redirects. This prevents bearer tokens from being sent to an absolute URL or forwarded through a login redirect.

No application-session cookie, SPA redirect/reload behavior, or frontend ETag
cache is included. Those behaviors belong to OrangeHRM's Vue `APIService`;
this client is the injected OAuth-token client for automation and API tests.

Route-group calls keep HTTP parameters explicit:

```js
const { data, meta } = await api.pim.employees.list({ limit: 20, offset: 0 });
const { data: employee } = await api.pim.employeePersonalDetails.get({ empNumber: 7 });
await api.pim.employeePersonalDetails.update({
  empNumber: 7,
  data: { firstName: 'Updated' },
});
await api.pim.employeeDependents.create({
  empNumber: 7,
  data: { name: 'Dependent' },
});
await api.admin.users.get({ id: 3 });
```

Static GET methods accept query fields directly. Dynamic routes take their
named path parameters on the argument object; dynamic POST/PUT requests place
the payload in `data`. Static POST/PUT methods take the payload directly.
Collection DELETE methods accept `ids` (sent as `{ids: [...]}`); item DELETE
routes use the route's path identifier. Path segments are validated and URL
encoded before transport.

`api.employees` and `api.users` remain compatibility conveniences. New tests
should use the domain-qualified surfaces (`api.pim.employees`,
`api.admin.users`) to make the OrangeHRM module explicit.

src/api/endpoints/employees.js
Domain language. No axios. No envelope. No auth.

js
class EmployeesApi {
constructor(client) { this.client = client; }

async list(params = {}) {
// params: { limit?, offset?, model?, includeEmployees?, name?, ... }
return this.client.get('/pim/employees', { params });
}

async get(empNumber) {
return this.client.get(`/pim/employees/${empNumber}`);
}

async create({ firstName, lastName, middleName, employeeId }) {
return this.client.post('/pim/employees', {
firstName, lastName, middleName, employeeId,
});
}

async delete(empNumbers) {
const ids = Array.isArray(empNumbers) ? empNumbers : [empNumbers];
return this.client.delete('/pim/employees', { ids });
}
}

module.exports = { EmployeesApi };
Notice:

Returns the envelope. Callers assert on .data and .meta.total.

No access_token. No Content-Type. No Authorization.

Paths are strings; if they change, you change one file.

src/api/endpoints/users.js
js
class UsersApi {
constructor(client) { this.client = client; }

list(params = {}) {
return this.client.get('/admin/users', { params });
}

create({ username, password, status, userRoleId, empNumber }) {
return this.client.post('/admin/users', {
username, password, status, userRoleId, empNumber,
});
}

delete(ids) {
const list = Array.isArray(ids) ? ids : [ids];
return this.client.delete('/admin/users', { ids: list });
}
}

module.exports = { UsersApi };
Same shape. Same rules.

src/api/index.js — the API facade
This is the second composition root (the first was scripts/obtain-token.js). It wires all endpoints onto the client and hands back a single object.

js
const { ApiClient } = require('./client');
const { EmployeesApi } = require('./endpoints/employees');
const { UsersApi } = require('./endpoints/users');
// ...import other endpoints here as you build them

function createApi({ baseUrl, tokenManager, logger }) {
const client = new ApiClient({ baseUrl, tokenManager, logger });
return {
employees: new EmployeesApi(client),
users: new UsersApi(client),
// leave: new LeaveApi(client), ... etc
_client: client, // escape hatch for tests that need to hit a path directly
};
}

module.exports = { createApi };
Nowhere else in the framework constructs ApiClient or endpoint classes.

Part 5 — Composition Root (the whole framework so far)
scripts/obtain-token.js — Phase 1, unchanged.

Add a second script for smoke-checking the API:

scripts/api-smoke.js
js
require('dotenv').config();
const users = require('../src/config/users');
const { OAuthClient } = require('../src/auth/oauth-client');
const { OAuthAuthorizer } = require('../src/auth/oauth-authorizer');
const { FileTokenStore } = require('../src/auth/token-store');
const { TokenManager } = require('../src/auth/token-manager');
const { createApi } = require('../src/api');
const env = require('../src/config/env');

async function buildApi(roleName) {
const role = users[roleName];
const baseUrl = env.apiBaseUrl;

const oauth = new OAuthClient({
authorizationUrl: env.oauthAuthUrl,
tokenUrl: env.oauthTokenUrl,
clientId: env.oauthClientId,
redirectUri: env.oauthRedirectUri,
});

const authorizer = new OAuthAuthorizer({
callbackHost: env.callbackHost,
callbackPort: env.callbackPort,
callbackPath: env.callbackPath,
});

const store = new FileTokenStore(role.tokenFile);

const tokenManager = new TokenManager({
oauth, authorizer, store,
credentials: { username: role.username, password: role.password },
});

return createApi({ baseUrl, tokenManager });
}

async function main() {
const api = await buildApi('admin');
const result = await api.employees.list({ limit: 5 });
console.log(JSON.stringify(result, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
Run it. If you see { data: [...], meta: { total: N }, rels: [] }, Phase 2 is working.

Part 6 — Error Handling You Actually Care About (from your research)
Because your research docs catalogued OrangeHRM's exact error shapes, the API client's error handling must match them. Here's the mapping you get for free from envelope.js:

Case ApiError.code ApiError.status ApiError.data
No auth UNAUTHORIZED 401 (number) undefined
Invalid Bearer on POST UNAUTHORIZED 401 undefined
ESS POST to admin FORBIDDEN 403 (number) undefined
Lookup miss NOT_FOUND "404" (string) undefined
Missing param VALIDATION "422" (string) { invalidParamKeys: [...] }
Unknown param (strict) VALIDATION "422" { invalidParamKeys: [...] }
Server error SERVER_ERROR 500 (unknown, rare)
Tests then do:

js
await expect(api.employees.create({ firstName: '' })).rejects.toMatchObject({
code: 'VALIDATION',
status: '422',
data: { invalidParamKeys: expect.arrayContaining(['firstName']) },
});
Clean. Explicit. Matches the wire.

One quirk to handle explicitly: invalid Bearer on GET redirects (302) to /auth/login and returns HTML, not JSON. Your interceptor's validateStatus only accepts 2xx, so 302 falls into normalizeError — but there's no error body. The result is ApiError with code: 'UNKNOWN' and status: 302. That's acceptable. If it ever matters, add a specific branch. Don't over-engineer it now.

Part 7 — What Phase 2 Does NOT Do (Yet)
No schema validation. You have schemas/ in your old tree. Don't add it yet. When you have three endpoints that need response-shape assertions, add src/api/schemas/ with an AJV wrapper. Not before.

No retries. OrangeHRM's APIs are idempotent enough that retries hurt more than help. Add retries when you have a flaky endpoint, not speculatively.

No rate-limiting. No evidence OrangeHRM throttles.

No request logging beyond the interceptor's debug line. When you need structured logs, add a real logger. Not now.

No session-cookie client. Bearer covers API tests. Session cookies are for UI tests (Phase 4 — Playwright).

No GraphQL / Batch. Not relevant to OrangeHRM.

Each of these is a "later" that you'll know you need because a test will fail. Add them then.

Part 8 — The Layers as They Now Stand
text
┌─────────────────────────────────────────────────┐
│ tests/ (Phase 4+) │
│ uses createApi() + TokenManager │
└──────────────────────┬──────────────────────────┘
│
┌──────────────────────▼──────────────────────────┐
│ src/api/index.js (composition root) │
│ createApi({ baseUrl, tokenManager }) │
└──────────────────────┬──────────────────────────┘
│
┌──────────────────────▼──────────────────────────┐
│ src/api/endpoints/*.js (domain language) │
└──────────────────────┬──────────────────────────┘
│
┌──────────────────────▼──────────────────────────┐
│ src/api/client.js (HTTP + auth + errors) │
│ depends on: axios, envelope, errors, │
│ tokenManager (injected) │
└──────────────────────┬──────────────────────────┘
│
┌──────────────────────▼──────────────────────────┐
│ src/auth/token-manager.js (Phase 1) │
│ getAccessToken() → string │
└──────────────────────┬──────────────────────────┘
│
┌──────────────────────▼──────────────────────────┐
│ OAuthClient │ OAuthAuthorizer │ FileTokenStore │
└─────────────────────────────────────────────────┘
The whole stack composes from two roots: scripts/obtain-token.js (auth only) and src/api/index.js (auth + API). No other file constructs anything.

Part 9 — Consistency With Phase 1 (Same Rules, Applied Again)
Principle from Phase 1 Phase 2 Application
External representation at the boundary {data, meta, rels} and {error: {...}} die inside envelope.js
Camel-case internally ApiError.code, ApiError.status — never error_description, never invalidParamKeys outside data
One reason to change per file Transport, error normalization, envelope normalization, and domain calls are four different files
No construction outside composition root Only src/api/index.js builds the client
Injected dependencies TokenManager is passed in, never imported by the client
No speculative generality No retries, no schemas, no caches until a test fails
Playwright never in infrastructure API layer is pure Node + axios; runs in scripts, CI, and tests
Part 10 — Phase 2 Verification
Run the isolated client and boundary tests with `npm test -- tests/api.spec.js`. They use a local HTTP server and do not require OrangeHRM credentials.

Run `npm run api:smoke -- admin` (or `npm run api:smoke -- ess`) to verify the complete OAuth + API composition against a configured OrangeHRM instance. This smoke check lists up to five employees; it does not create or delete data.

The route-manifest test asserts coverage of the bundled source route inventory;
the local-server tests exercise auth headers, request bodies and query strings,
path-parameter encoding, the response/error envelopes, API redirects, and
authentication failure propagation.

Stop here. Do not add schemas, retries, or other speculative API infrastructure.

Part 11 — Naming the Whole Thing (for your own defense)
SRP — client.js transports; envelope.js normalizes; errors.js types; endpoints/* speaks domain.

DIP — ApiClient depends on a TokenManager interface (getAccessToken()), not a concrete class.

Boundary translation — snake_case and OrangeHRM error envelope die in envelope.js; nothing downstream sees either.

Composition root — one createApi() call wires everything; tests and scripts both go through it.

Law of Demeter — api.employees.create(...), not api.client.http.post(...).

No speculative generality — no schemas, no retries, no caching, no HTTP session fallback until they're needed.

Symmetry with auth — the API layer is shaped exactly like the auth layer: pure transport, boundary translation, injected dependencies, one composition root, flat files, no premature nesting.

One Final Note
You solved auth by giving it six files with five boundaries and one composition root. The API layer is the same problem in a different domain. Six files with four boundaries and one composition root.

The layers compose naturally:

js
// In any test:
const api = await buildApiForRole('admin'); // wires auth + api
const { data, meta } = await api.employees.list({ limit: 5 });
You will never think about axios, access_token, Content-Type, or the {error: {status, message, data}} shape again. That is the entire point.

Build it. Tell me what breaks.

supposed we now know how auth and api can be compose, what about db client framework
Phase 3 — Database Client Framework
DB is the third layer and it's structurally different from auth and API in one important way: it does not depend on auth. It's a leaf. It authenticates with credentials that come from src/config/env.js, and it exposes queries. That makes it simpler than API, not harder.

But it also carries two risks you must design against:

Coupling risk — the DB layer must not become a hidden dependency of every UI test. Your research doc says this explicitly. The framework must make DB access explicit and intentional at the call site.

Scope risk — the DB layer must not become an ORM. OrangeHRM has 150+ tables, three soft-delete conventions, orphaned rows, no FK on timesheets, and a cascade map you can only partially verify. Do not try to model them all. Model what tests need, nothing else.

Here's the decisive plan.

Part 1 — The One Decision That Matters
text
src/db/
├── pool.js # mysql2 pool + connection lifecycle
├── client.js # query interface (select/insert/update/delete + tx)
├── errors.js # DbError taxonomy
├── row.js # row shape helpers (camelCase conversion, null handling)
└── repositories/
├── employees.js
├── users.js
├── leave.js
├── timesheets.js
├── attendance.js
└── permissions.js
Six files, same flat shape as auth/ and api/. Same composition-root discipline. Same boundary-translation rule.

Do not add migrations/, models/, entities/, schemas/, or orm/. OrangeHRM owns the schema. Your job is to read and write the subset that tests require.

Part 2 — The Boundaries (This Is the Whole Architecture)
File Knows About MUST NOT Know About
errors.js nothing nothing
row.js nothing but JS objects mysql2, config, auth
pool.js mysql2/promise, DB config object queries, repositories, business meaning
client.js the pool, ./errors business meaning, table names, endpoint paths
repositories/*.js the client, table/column names auth, API, HTTP, pool lifecycle, tests
Repositories speak SQL and table names. The client speaks SQL and parameters. The pool speaks connections.

If you ever want to import the API client into a repository, stop. If you ever want to import TokenManager, stop. DB is a leaf layer. It has no downstream dependencies on auth or API.

Part 3 — Data Contracts (Freeze These)
js
// pool.js
createPool({ host, port, user, password, database, connectionLimit }) → mysql2.Pool
// internal only; not exported to repositories directly

// client.js — public surface
{
select(sql, params?) → Row[]
selectOne(sql, params?) → Row | null
selectValue(sql, params?) → any
execute(sql, params?) → { affectedRows, insertId, changedRows }
transaction(fn) → any // fn receives a scoped client
close() → void
}

// Row — plain JS objects with column names as-is (snake_case)
{
emp_number: 1,
emp_firstname: 'Admin',
purged_at: null
}
Critical design choice: rows come back with snake_case column names, matching MySQL. Why? Because that's what SQL returns, and hiding it forces you to maintain a naming map for 150+ tables. Repositories translate only when a query is actually used. Tests that need camelCase do it in one line.

This is different from the API layer, where the wire is small and stable. The DB schema is huge and evolving. Do not abstract it.

js
// errors.js
class DbError extends Error {
constructor(message, { code, sqlState, sqlMessage, sql, params, raw } = {}) {
super(message);
this.name = 'DbError';
this.code = code; // 'CONN_REFUSED' | 'ER_DUP_ENTRY' | 'ER_NO_REFERENCED_ROW' | 'UNKNOWN'
this.sqlState = sqlState;
this.sqlMessage = sqlMessage; // MySQL's message
this.sql = sql; // the offending statement, truncated
this.params = params; // the parameter array
this.raw = raw;
}
}
The sql, params, sqlState, and sqlMessage fields are what make DB failures diagnosable. Do not skip them.

Part 4 — Concrete File Sketches
src/db/errors.js
js
const MYSQL_CODE_MAP = {
ECONNREFUSED: 'CONN_REFUSED',
ER_ACCESS_DENIED_ERROR: 'AUTH_FAILED',
ER_BAD_DB_ERROR: 'NO_DATABASE',
ER_DUP_ENTRY: 'DUPLICATE_KEY',
ER_NO_REFERENCED_ROW: 'FK_MISSING',
ER_NO_REFERENCED_ROW_2: 'FK_MISSING',
ER_ROW_IS_REFERENCED: 'FK_IN_USE',
ER_ROW_IS_REFERENCED_2: 'FK_IN_USE',
ER_LOCK_WAIT_TIMEOUT: 'LOCK_TIMEOUT',
ER_LOCK_DEADLOCK: 'DEADLOCK',
};

class DbError extends Error {
constructor(message, { code, sqlState, sqlMessage, sql, params, raw } = {}) {
super(message);
this.name = 'DbError';
this.code = code;
this.sqlState = sqlState;
this.sqlMessage = sqlMessage;
this.sql = sql ? String(sql).slice(0, 500) : undefined;
this.params = params;
this.raw = raw;
}

static fromMysql(err, sql, params) {
const code = MYSQL_CODE_MAP[err.code] ?? 'UNKNOWN';
return new DbError(err.message, {
code,
sqlState: err.sqlState,
sqlMessage: err.sqlMessage,
sql,
params,
raw: err,
});
}
}

module.exports = { DbError };
Nothing else. No "repository base class." No abstract base.

src/db/pool.js
js
const mysql = require('mysql2/promise');
const { DbError } = require('./errors');

function createPool({ host, port, user, password, database, connectionLimit = 10 }) {
const pool = mysql.createPool({
host,
port,
user,
password,
database,
connectionLimit,
waitForConnections: true,
namedPlaceholders: false, // we use ? placeholders only
timezone: 'Z', // always read/write UTC
dateStrings: false, // return Date objects, not strings
multipleStatements: false, // safety
});

// A single health check at construction is enough. Don't ping per query.
pool.on('connection', () => {}); // reserved for future logging

return pool;
}

module.exports = { createPool };
Notes:

multipleStatements: false is deliberate. Tests have no reason to run multi-statement SQL, and disabling it removes a category of injection risk.

timezone: 'Z' matters because your research found ohrm_attendance_record stores UTC and user-local times side by side. Reading both as UTC-consistent Date objects is the only sane default.

No Decimal override. mysql2 returns DECIMAL as strings by default — that's fine and honest.

src/db/client.js
js
const { DbError } = require('./errors');

class DbClient {
constructor(pool) {
this.pool = pool;
}

async select(sql, params = []) {
return this._run(sql, params, async (conn) => {
const [rows] = await conn.execute(sql, params);
return rows;
});
}

async selectOne(sql, params = []) {
const rows = await this.select(sql, params);
return rows[0] ?? null;
}

async selectValue(sql, params = []) {
const row = await this.selectOne(sql, params);
if (!row) return null;
// First column of first row
return Object.values(row)[0] ?? null;
}

async execute(sql, params = []) {
return this._run(sql, params, async (conn) => {
const [result] = await conn.execute(sql, params);
return {
affectedRows: result.affectedRows ?? 0,
insertId: result.insertId ?? null,
changedRows: result.changedRows ?? 0,
};
});
}

// fn receives a client bound to one connection so all queries are in one tx
async transaction(fn) {
const conn = await this.pool.getConnection();
try {
await conn.beginTransaction();
const scoped = new DbClient({ getConnection: async () => conn, _isScoped: true });
const result = await fn(scoped);
await conn.commit();
return result;
} catch (err) {
try { await conn.rollback(); } catch { /* ignore */ }
throw err;
} finally {
conn.release();
}
}

async close() {
await this.pool.end();
}

async _run(sql, params, fn) {
let conn;
try {
conn = await this.pool.getConnection();
return await fn(conn);
} catch (err) {
throw DbError.fromMysql(err, sql, params);
} finally {
if (conn) conn.release();
}
}
}

module.exports = { DbClient };
Notes:

Parameterized queries only. ? placeholders. No template string interpolation. This is non-negotiable.

Transactions are scoped, not global. You call client.transaction(async (tx) => ...). Inside, use tx, not client.

selectValue is the tiny convenience for SELECT COUNT(*). Keep it. It's worth the two lines.

_run releases the connection in finally so no leak on error.

One subtle detail in transaction: the scoped client shares the outer connection, so _run's finally releasing the shared connection would be wrong. Here's the honest version — I'll leave that as a TODO in the sketch and move the scoping into a private flag check, or (simpler) use a ScopedClient that overrides _run. Don't over-think it: the flat DbClient + a small ScopedClient class is enough. The point of the sketch is the interface; the impl detail is a 20-line refactor.

src/db/row.js
Pure functions for the tiny amount of row-shape work you'll actually do.

js
// Convert snake_case keys to camelCase. Non-recursive.
// Do NOT do this by default — only when a repository wants it.
function toCamel(row) {
if (!row) return row;
const out = {};
for (const [k, v] of Object.entries(row)) {
out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
}
return out;
}

// Camel to snake. Same idea.
function toSnake(obj) {
const out = {};
for (const [k, v] of Object.entries(obj)) {
out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
}
return out;
}

module.exports = { toCamel, toSnake };
That's it. No Row class. No getters. No proxies. Just two functions.

src/db/repositories/employees.js
js
class EmployeesRepository {
constructor(client) { this.client = client; }

async findById(empNumber) {
return this.client.selectOne(
`SELECT emp_number, employee_id, emp_firstname, emp_lastname,
              emp_middle_name, purged_at
         FROM hs_hr_employee
        WHERE emp_number = ?`,
[empNumber],
);
}

async findByEmployeeId(employeeId) {
return this.client.selectOne(
`SELECT emp_number, employee_id, emp_firstname, emp_lastname
         FROM hs_hr_employee
        WHERE employee_id = ? AND purged_at IS NULL`,
[employeeId],
);
}

async countAll() {
return this.client.selectValue(
`SELECT COUNT(*) AS n FROM hs_hr_employee WHERE purged_at IS NULL`,
);
}

// NOTE: This is a HARD delete. Research doc §7.1 confirms DELETE cascades
// leave but NOT timesheet. Cleanup scripts must handle orphans explicitly.
async deleteById(empNumber) {
return this.client.execute(
`DELETE FROM hs_hr_employee WHERE emp_number = ?`,
[empNumber],
);
}

// Explicit orphan check — used only by cleanup and cascade tests.
async findOrphanedTimesheets(empNumber) {
return this.client.select(
`SELECT timesheet_id, employee_id, state
         FROM ohrm_timesheet
        WHERE employee_id = ?
          AND employee_id NOT IN (SELECT emp_number FROM hs_hr_employee)`,
[empNumber],
);
}
}
module.exports = { EmployeesRepository };
Notes:

The repository names the tables and columns. This is where OrangeHRM schema knowledge lives.

purged_at IS NULL is included on read queries because your research showed that the API filters by it and the uniqueness rule uses it. Tests should match production semantics.

deleteById is a hard delete. The comment is there so no test author is surprised.

findOrphanedTimesheets is a specific, meaningful query — not a general "get everything for employee". Query methods should be named for the question they answer.

src/db/repositories/permissions.js
The permission tables are read-only from the framework's perspective. This repository exists so tests can assert on the permission model without knowing the joins.

js
class PermissionsRepository {
constructor(client) { this.client = client; }

async dataGroupIdForApi(apiClass) {
return this.client.selectValue(
`SELECT data_group_id FROM ohrm_api_permission WHERE api_name = ?`,
[apiClass],
);
}

async rolePermissionsForApi(apiClass) {
return this.client.select(
`SELECT ur.id   AS user_role_id,
              ur.name AS user_role_name,
              urdg.can_read, urdg.can_create, urdg.can_update, urdg.can_delete,
              urdg.self
         FROM ohrm_api_permission ap
         JOIN ohrm_user_role_data_group urdg ON urdg.data_group_id = ap.data_group_id
         JOIN ohrm_user_role ur               ON ur.id = urdg.user_role_id
        WHERE ap.api_name = ?
        ORDER BY ur.id`,
[apiClass],
);
}

async isActionAllowed(workflow, state, role, action) {
const n = await this.client.selectValue(
`SELECT COUNT(*) FROM ohrm_workflow_state_machine
        WHERE workflow = ? AND state = ? AND role = ? AND action = ?`,
[String(workflow), state, role, String(action)],
);
return Number(n) > 0;
}
}
module.exports = { PermissionsRepository };
Notes:

String(workflow) and String(action) because your research found the workflow column stores strings ('0'–'7') and the action column stores integers-as-strings for most flows. This is a real quirk; the repository makes it explicit.

No JOIN-fest. Each method answers one question.

No methods that write. These tables are read-only. If a test wants to change permissions, it's doing something wrong.

src/db/index.js — composition root
js
const { createPool } = require('./pool');
const { DbClient } = require('./client');
const { EmployeesRepository } = require('./repositories/employees');
const { UsersRepository } from './repositories/users'; // when you build it
const { PermissionsRepository } = require('./repositories/permissions');

function createDb({ host, port, user, password, database, connectionLimit }) {
const pool = createPool({ host, port, user, password, database, connectionLimit });
const client = new DbClient(pool);

return {
client,
employees: new EmployeesRepository(client),
users: new UsersRepository(client),
permissions: new PermissionsRepository(client),
// leave: new LeaveRepository(client), ... etc, as you build them
async close() { await client.close(); },
};
}

module.exports = { createDb };
One function. One pool. One client. Repositories hang off it.

Part 5 — Composition Root (the whole framework so far)
text
scripts/
├── obtain-token.js # Phase 1 composition root (auth only)
├── api-smoke.js # Phase 2 composition root (auth + api)
└── db-smoke.js # Phase 3 composition root (db only)
scripts/db-smoke.js
js
require('dotenv').config();
const { createDb } = require('../src/db');

async function main() {
const db = createDb({
host: process.env.OHRM_DB_HOST,
port: Number(process.env.OHRM_DB_PORT),
user: process.env.OHRM_DB_USER,
password: process.env.OHRM_DB_PASSWORD,
database: process.env.OHRM_DB_NAME,
});

try {
const n = await db.employees.countAll();
console.log('employees:', n);

    const perms = await db.permissions.rolePermissionsForApi(
      'OrangeHRM\\Pim\\Api\\EmployeeAPI',
    );
    console.log(perms);

} finally {
await db.close();
}
}

main().catch(err => { console.error(err); process.exit(1); });
Run it. If you see employee count and the Admin/ESS/Supervisor permission rows from your research, Phase 3 is working.

Part 6 — The Rule That Keeps DB From Becoming a Hidden Dependency
This is the most important thing in Phase 3, more important than any code.

The DB client must never be auto-injected into a test by default.

In your old tree, src/fixtures/db.fixture.js existed and every test imported it. That's the anti-pattern your research doc called out:

DB should not become a hidden dependency of every UI test.

The correct pattern is the opposite:

A test opts in to DB access. test.use({ db: true }) or an explicit db fixture that starts undefined.

If a UI test wants to verify persisted state, it either:

Re-fetches via API — default, always preferred.
Reloads the page and asserts UI state — acceptable.
Explicitly uses DB — only when 1 and 2 cannot answer the question (audit tables, workflow history, orphan checks, cascade verification).
To make this concrete for Phase 4 (Playwright fixtures):

js
// src/fixtures/base.js
const base = require('@playwright/test');
const { createDb } = require('../db');
const { buildApi } = require('../support/build-api'); // your composition helper

const test = base.test.extend({
// API is available whenever a test needs it
api: async ({}, use) => {
const api = await buildApi('admin');
await use(api);
},

// DB is NOT available by default. Tests must opt in.
db: [async ({}, use) => {
const db = createDb({ /* from env */ });
await use(db);
await db.close();
}, { scope: 'worker' }],
});

module.exports = { test, expect: base.expect };
Two consequences:

Nothing about db leaks into tests that don't request it. The pool is not created.

Tests that request db are visibly doing so at the top. A reviewer sees test('...', async ({ db }) => ...) and immediately knows this test touches the DB. That's the point.

Part 7 — What Phase 3 Does NOT Do (Yet)
No migrations. The schema is OrangeHRM's. If you need schema variants, that's a Phase 4+ problem.

No ORM. No entity classes. No relation loading. No lazy associations. Every query is explicit SQL.

No soft-delete helper. Three different conventions (deleted, is_deleted, purged_at). The repository for each table knows its own convention. Don't unify them.

No cascade-aware delete helper. Cascade behavior is per-table. Every cascade-sensitive operation is a named repository method with a comment explaining its scope.

No fixture data seeding in this layer. Test data creation belongs in src/data/ (Phase 4). The DB layer just executes SQL.

No cleanup helpers. DELETE FROM x WHERE ... is enough. If cleanup needs to be non-trivial, it goes in src/db/cleanup.js — added only when you have a second concrete use case.

No caching. Every read hits the DB. Tests are short-lived processes.

No connection retries. If the DB is down at startup, fail fast.

Each of these is a "later" that a test will earn for you.

Part 8 — The Layers as They Now Stand
text
┌──────────────────────────────────────────────────┐
│ tests/ (Phase 4+) │
│ { api } ← default, always available │
│ { db } ← opt-in, explicit at call site │
└────────────────┬─────────────────┬───────────────┘
│ │
┌────────▼───────┐ ┌──────▼──────────────┐
│ src/api/index │ │ src/db/index │
│ createApi() │ │ createDb() │
└────────┬───────┘ └──────┬──────────────┘
│ │
┌────────▼───────┐ ┌──────▼──────────────┐
│ api/endpoints │ │ db/repositories │
└────────┬───────┘ └──────┬──────────────┘
│ │
┌────────▼───────┐ ┌──────▼──────────────┐
│ api/client │ │ db/client │
│ + envelope │ │ + row │
│ + errors │ │ + errors │
└────────┬───────┘ └──────┬──────────────┘
│ │
┌────────▼───────┐ ┌──────▼──────────────┐
│ TokenManager │ │ mysql2 Pool │
│ (Phase 1) │ │ │
└────────┬───────┘ └─────────────────────┘
│
┌────────▼──────────────────────────────────┐
│ OAuthClient │ OAuthAuthorizer │ Store │
└────────────────────────────────────────────┘
Two independent leaf stacks. API depends on auth. DB depends on nothing but mysql2. UI (Phase 4) depends on both. That is the whole architecture.

Part 9 — Consistency Across the Three Phases
Principle Auth (Phase 1) API (Phase 2) DB (Phase 3)
One reason to change per file ✅ ✅ ✅
Boundary translation once ✅ snake_case in _normalize ✅ envelope in envelope.js ✅ toCamel opt-in
Injected dependencies ✅ TokenManager ✅ TokenManager in client ✅ Pool in client
Composition root ✅ obtain-token.js ✅ api/index.js ✅ db/index.js
No speculative abstraction ✅ 6 files ✅ 6 files ✅ 6 files
Playwright-free ✅ (authorizer imports playwright, not @playwright/test) ✅ ✅
Error taxonomy ✅ AuthenticationError ✅ ApiError ✅ DbError
No hidden deps in tests n/a ✅ ✅ (explicit opt-in)
That table is the whole point of doing this in phases: the shape repeats, so the mental model transfers. You solved auth once, and now API and DB are the same problem with different payloads.

Part 10 — Phase 3 Implementation and Verification
The initial DB layer is implemented in src/db/. It includes the MySQL pool, query client and transactions, DB error normalization, opt-in row conversion, and the employees and permissions repositories. scripts/db-smoke.js composes the layer without auth or API dependencies.

Run npm run db:smoke to verify that:

employees.countAll() returns a number

permissions.rolePermissionsForApi('OrangeHRM\\Pim\\Api\\EmployeeAPI') returns the four expected rows (Admin, ESS, Supervisor×2)

permissions.isActionAllowed(3, 'NOT_EXIST', 'ADMIN', 1) returns true

Run npx playwright test tests/db.spec.js for the focused client and row-helper tests.

Stop here for Phase 3. Do not add cleanup helpers, migrations, or ORM features until Phase 4 needs them.

Part 11 — Naming the Whole Thing (for your own defense)
SRP — pool connection lifecycle, client query interface, row translation, and repositories are four different concerns.

DIP — DbClient depends on a pool object with getConnection / end, not on mysql2.

Boundary translation — snake_case is the default; camelCase is an explicit, opt-in call per repository method.

Composition root — one createDb() per process; nothing else constructs a pool.

Law of Demeter — db.employees.findById(3), not db.client.pool.execute(...).

No speculative generality — no ORM, no migrations, no soft-delete abstraction, no cascade helper.

Symmetry with auth and API — same flat layout, same boundary discipline, same composition root, same error taxonomy.

Explicit-over-implicit at the test boundary — DB is opt-in via fixture, not auto-injected. This is the single most important design choice in the whole layer.

One Final Note
Auth solved "how do I get a token."
API solved "how do I call an endpoint."
DB solves "how do I ask a question of the schema."

All three share the same answer shape: inject dependencies, translate at the boundary, expose one composition root, don't model the world — model the questions.

Build it. Tell me what breaks.

supposed we now know how auth and api and db can be compose, what about front end/oxd component framework
Phase 4 — UI / OXD Component Framework
This is the phase where everything you've read in the frontend research doc gets turned into something a test can actually use. It's also the phase that will tempt you to over-build the most, because OXD has 61 components, three table components, four select/autocomplete variants, custom date pickers, and the notorious "label without for" quirk. If you try to write a class per component, you will end up with 61 files of shims, and you will have built the exact thing your principles forbid: a framework for the sake of the framework.

The decisive answer is: don't wrap components. Wrap behaviors.

Here's the plan.

Part 1 — The One Decision That Matters
text
src/ui/
├── selectors.js # one file: every stable selector string, keyed by name
├── base-page.js # thin base class: navigation + OXD-wide behaviors
├── components/ # one file per _interaction pattern_, not per OXD component
│ ├── oxd-table.js # the row/checkbox/action pattern (used by every list page)
│ ├── oxd-select.js # the select + multiselect + autocomplete pattern
│ ├── oxd-date-picker.js # the date + time input pattern
│ ├── oxd-dialog.js # overlay + confirm/cancel pattern
│ ├── oxd-toast.js # the notification pattern (assertable)
│ └── oxd-form.js # the label-lookup + validation-message pattern
├── pages/ # one file per _screen_, not per DOM element
│ ├── login-page.js
│ ├── dashboard-page.js
│ ├── employee-list-page.js
│ ├── add-employee-page.js
│ ├── leave-list-page.js
│ └── admin-users-page.js
├── workflows/ # multi-page business flows
│ ├── login.js
│ ├── create-employee.js
│ ├── apply-leave.js
│ └── create-user.js
└── index.js # composition root
Not oxd-input.js, oxd-button.js, oxd-icon.js, oxd-checkbox.js. Those are OXD components; wrapping them 1:1 produces no value — Playwright's own locators already handle them. Wrap them only when a reusable interaction pattern exists that would otherwise be duplicated.

Six components, six pages, four workflows. That's a Phase 4 that stays small enough to be honest.

Part 2 — The Boundaries (This Is the Whole Architecture)
File Knows About MUST NOT Know About
selectors.js OXD DOM classes, roles, data-* attributes from the frontend doc pages, workflows, business meaning, HTTP
base-page.js page, selectors API, DB, auth, other pages
components/_.js page, selectors, other components pages, workflows, API, DB, auth
pages/_.js page, components, selectors workflows, API, DB, auth
workflows/*.js pages, components API, DB, auth (unless the workflow is explicitly cross-layer)
index.js everything (composition root) nothing — it constructs
Rule of thumb that will save you: components never import pages. Pages never import workflows. Workflows import pages and components. If a page starts importing another page, you have a workflow that hasn't been named yet.

And: no UI file imports src/api/ or src/db/. UI speaks DOM. Cross-layer coordination belongs in a cross-layer workflow — a small, explicit, opt-in construct you'll add in Phase 5 if you actually need it. Not in page objects.

Part 3 — Data Contracts (Freeze These)
js
// components/oxd-table.js
{
rowCount() → number
rowByText(text) → Locator
checkboxInRow(text) → Locator
actionInRow(text, actionName) → Locator
clickAction(text, actionName) → Promise<void>
selectAllCheckbox() → Locator
sortBy(columnName, 'asc' | 'desc') → Promise<void>
waitForLoad() → Promise<void>
}

// components/oxd-select.js
{
open(labelText) → Promise<void>
choose(labelText, optionText) → Promise<void>
select(labelText, optionText) → Promise<void> // open + choose
selectedValue(labelText) → Promise<string>
}

// components/oxd-date-picker.js
{
set(labelText, date) → Promise<void> // 'YYYY-MM-DD'
clear(labelText) → Promise<void>
open(labelText) → Promise<void>
}

// components/oxd-dialog.js
{
confirm() → Promise<void>
cancel() → Promise<void>
text() → Promise<string>
}

// components/oxd-toast.js
{
waitForSuccess(text?) → Promise<void>
waitForError(text?) → Promise<void>
text() → Promise<string>
dismiss() → Promise<void>
}

// components/oxd-form.js
{
fieldByLabel(labelText) → Locator // the actual input/textarea
fillByLabel(labelText, value) → Promise<void>
errorFor(labelText) → Promise<string | null>
submit() → Promise<void>
reset() → Promise<void>
}

// pages/*.js — freeform but always:
{
goto() → Promise<void>
...page-specific methods
}
Every component's return values are either a Promise<void>, a Locator, or a primitive. Nothing returns raw DOM. Nothing returns an ElementHandle. That rule is what keeps the UI layer replaceable.

Part 4 — Concrete File Sketches
src/ui/selectors.js
One file. Every stable selector from the frontend doc. This is the file that changes when OXD changes. Everything else uses it symbolically.

js
// Every entry here is traceable to the frontend research doc.
// When OXD changes, only this file changes.

const SELECTORS = {
// --- Navigation ---
sidepanel: 'aside.oxd-sidepanel',
sidepanelNav: 'nav[aria-label="Sidepanel"]',
mainMenuItem: '.oxd-main-menu-item',
mainMenuItemName: '.oxd-main-menu-item--name',
topbarNav: 'nav[aria-label="Topbar Menu"]',
topbarTabItem: '.oxd-topbar-body-nav-tab-item',
topbarTabLink: '.oxd-topbar-body-nav-tab-link',

// --- Form ---
form: 'form.oxd-form',
formLoader: '.oxd-form-loader',
inputGroup: '.oxd-input-group',
inputGroupLabel: '.oxd-input-group__label',
inputFieldError: '.oxd-input-field-error-message',
input: 'input.oxd-input',
textarea: 'textarea.oxd-textarea',
formActions: '.oxd-form-actions',

// --- Select / MultiSelect / Autocomplete ---
selectTrigger: '.oxd-select-text-input',
selectDropdown: '.oxd-select-dropdown',
selectOption: '.oxd-select-option',
multiselectChips: '.oxd-multiselect-chips-area',
autocompleteInput: '.oxd-autocomplete-text-input input',
autocompleteDropdown:'.oxd-autocomplete-dropdown',

// --- Date / Time ---
dateWrapper: '.oxd-date-wrapper',
dateInput: '.oxd-date-input input.oxd-input',
dateCalendar: '.oxd-calendar-wrapper',
dateShortcutToday: '.oxd-date-input-links a:has-text("Today")',
dateShortcutClear: '.oxd-date-input-links a:has-text("Clear")',

// --- Card table ---
cardTable: '.oxd-table',
cardTableHeaderCell: '.oxd-table-header-cell',
cardTableCard: '.oxd-table-card',
cardTableRow: '.oxd-table-row',
cardTableCell: '.oxd-table-cell',
cardTableActions: '.oxd-table-cell-actions',
cardTableCheckbox: '.oxd-table-card-cell-checkbox',
cardTableLoader: '.oxd-table-loader',
cardTableSortDropdown: '.oxd-table-header-sort-dropdown',

// --- Dialog / Overlay ---
overlay: '.oxd-overlay[role="dialog"]',
dialogSheet: '.oxd-dialog-sheet',
dialogClose: '.oxd-dialog-close-button',

// --- Toast / Alert ---
toastContainer: '.oxd-toast-container',
toast: '.oxd-toast',
toastSuccess: '.oxd-toast--success',
toastError: '.oxd-toast--error',
alert: '.oxd-alert[role="alert"]',

// --- Loading ---
spinner: '.oxd-loading-spinner',

// --- Pagination ---
pagination: '.oxd-pagination',
};

// Dynamic helpers — need interpolation, kept separate so they stand out
const byLabelText = (label) =>
`${SELECTORS.inputGroup}:has(${SELECTORS.inputGroupLabel}:text-is("${label}"))`;

const iconButton = (biName) => `.oxd-icon.bi-${biName}`;

module.exports = { SELECTORS, byLabelText, iconButton };
Two functions and one frozen object. No classes, no getters, no build step.

src/ui/base-page.js
js
const { SELECTORS } = require('./selectors');

class BasePage {
constructor(page, baseUrl) {
this.page = page;
this.baseUrl = baseUrl.replace(/\/$/, '');
}

async goto(path) {
// Every OrangeHRM navigation is a full page load.
// Research doc §3.3: navigate() sets window.location.href.
await this.page.goto(`${this.baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
await this.waitForReady();
}

async waitForReady() {
// The sidepanel only exists after the Vue shell mounts.
await this.page.locator(SELECTORS.sidepanel).waitFor({ state: 'attached' });
}

async navigateSidebar(label) {
await this.page
.locator(SELECTORS.sidepanelNav)
.getByRole('link', { name: label, exact: true })
.click();
// Full page load — wait for URL change and shell remount.
await this.page.waitForLoadState('domcontentloaded');
await this.waitForReady();
}

async navigateTopbar(label) {
await this.page
.locator(SELECTORS.topbarNav)
.getByRole('link', { name: label, exact: true })
.click();
await this.page.waitForLoadState('domcontentloaded');
await this.waitForReady();
}

async currentUrl() { return this.page.url(); }
async title() { return this.page.title(); }
}

module.exports = { BasePage };
Notes:

goto(path) takes the server path, not a full URL. Same for sidebar labels. Pages call this.goto('/web/index.php/pim/viewEmployeeList').

The waitForReady gate is the one place you encode "the SPA has mounted." Research doc §3.3 says every navigation is a full page load, so this wait is not optional.

No this.page.waitForTimeout(...). Ever. That rule is enforced by the fact that it's not in the base class.

src/ui/components/oxd-form.js
The single most important component, because the frontend doc says OxdLabel has no for attribute, so getByLabel() fails everywhere.

js
const { SELECTORS, byLabelText } = require('../selectors');

class OxdForm {
constructor(page) { this.page = page; }

// Returns the container for a labeled field: label + input + error
group(labelText) {
return this.page.locator(byLabelText(labelText));
}

// Returns the actual input element for a labeled field.
// Handles: text input, textarea, native select, and the custom select trigger.
fieldByLabel(labelText) {
const group = this.group(labelText);
// Prefer a real input/textarea if present; otherwise fall back to
// the OXD select trigger (div.oxd-select-text-input) — also the
// shape used by multiselect and autocomplete's wrapper.
return group.locator(
`input.oxd-input, textarea.oxd-textarea, ${SELECTORS.selectTrigger}`,
).first();
}

async fillByLabel(labelText, value) {
const field = this.fieldByLabel(labelText);
await field.scrollIntoViewIfNeeded();
await field.fill(value);
}

async errorFor(labelText) {
const group = this.group(labelText);
const err = group.locator(SELECTORS.inputFieldError);
if (await err.count() === 0) return null;
return (await err.first().innerText()).trim();
}

async submit() {
await this.page
.locator(SELECTORS.formActions)
.getByRole('button', { name: /save|search|submit/i })
.click();
}

async reset() {
await this.page
.locator(SELECTORS.formActions)
.getByRole('button', { name: /reset/i })
.click();
}

async waitForLoad() {
await this.page.locator(SELECTORS.formLoader).waitFor({ state: 'detached' });
}
}

module.exports = { OxdForm };
Notes:

group() uses byLabelText(), which anchors on the input group and filters by the label's exact text. This is the documented workaround for the missing for attribute.

fieldByLabel() is a single method that resolves the right input shape. It does not try to be a Swiss army knife. Select and date pickers have their own components.

errorFor() returns a string or null. Nothing else.

src/ui/components/oxd-select.js
Handles the shared interaction of native-looking selects, multiselects, and autocompletes. These three all share the same "trigger + dropdown + option" pattern in OXD, which is why one component covers them.

js
const { SELECTORS, byLabelText } = require('../selectors');

class OxdSelect {
constructor(page) { this.page = page; }

trigger(labelText) {
return this.page.locator(byLabelText(labelText)).locator(SELECTORS.selectTrigger);
}

async open(labelText) {
await this.trigger(labelText).click();
// Dropdown is v-if — it does not exist until opened.
await this.page.locator(SELECTORS.selectDropdown).waitFor({ state: 'visible' });
}

async choose(labelText, optionText) {
await this.page
.locator(SELECTORS.selectDropdown)
.getByRole('option', { name: optionText, exact: true })
.click();
}

async select(labelText, optionText) {
await this.open(labelText);
await this.choose(labelText, optionText);
}

async selectedValue(labelText) {
return (await this.trigger(labelText).innerText()).trim();
}

// --- Autocomplete variant: 800ms debounce per research doc §3.9 ---
async autocomplete(labelText, query, optionText) {
const input = this.page
.locator(byLabelText(labelText))
.locator(SELECTORS.autocompleteInput);
await input.click();
await input.fill(query);
await this.page
.locator(`${SELECTORS.autocompleteDropdown} [role="option"]`)
.filter({ hasText: optionText })
.first()
.click();
}
}

module.exports = { OxdSelect };
Notes:

The v-if on dropdowns is captured once, in open(). Every caller gets the correct wait for free.

Autocomplete is a distinct method, not a subclass. Same class, two methods, one file. That's the right granularity.

The 800ms debounce is handled by Playwright's auto-wait on .click() of the option — because the option doesn't exist until the debounce resolves. No waitForTimeout.

src/ui/components/oxd-table.js
The most important component for list pages. Research doc §3.8 says rows are <div class="oxd-table-card"> wrapping a <tr>; the browser may hoist the <tr>. Anchor on .oxd-table-card — never on tr.

js
const { SELECTORS } = require('../selectors');

class OxdTable {
constructor(page) { this.page = page; }

root() { return this.page.locator(SELECTORS.cardTable); }
rows() { return this.page.locator(SELECTORS.cardTableCard); }

async rowCount() { return this.rows().count(); }

rowByText(text) {
return this.rows().filter({ hasText: text }).first();
}

checkboxInRow(text) {
return this.rowByText(text)
.locator(SELECTORS.cardTableCheckbox)
.getByRole('checkbox');
}

actionInRow(text, biName) {
return this.rowByText(text)
.locator(SELECTORS.cardTableActions)
.locator(`.oxd-icon.bi-${biName}`);
}

async clickAction(text, biName) {
await this.actionInRow(text, biName).click();
}

selectAllCheckbox() {
// The select-all checkbox lives in the header only at lg/xl.
// Research doc §3.18: header renders only at viewport ≥ 1000px.
return this.page
.locator(SELECTORS.cardTableHeaderCell)
.getByRole('checkbox')
.first();
}

async sortBy(columnName, direction = 'asc') {
// Sort uses a dropdown — menu items are "Ascending" / "Descending".
const header = this.page
.locator(SELECTORS.cardTableHeaderCell)
.filter({ hasText: columnName });
await header.locator(SELECTORS.cardTableSortDropdown).click();
await this.page
.getByRole('menuitem', {
name: new RegExp(direction === 'asc' ? 'Ascending' : 'Descending', 'i'),
})
.click();
}

async waitForLoad() {
await this.page.locator(SELECTORS.cardTableLoader).waitFor({ state: 'detached' });
}

async waitForRowCount(n) {
await this.page.waitForFunction(
({ sel, n }) => document.querySelectorAll(sel).length === n,
{ sel: SELECTORS.cardTableCard, n },
);
}
}

module.exports = { OxdTable };
Notes:

Every method anchors on .oxd-table-card. Nothing uses tr. That rule prevents the "hoisted <tr>" bug from ever being possible.

waitForRowCount(n) uses waitForFunction because there is no Playwright-native "wait for N elements" primitive. This is a condition-based wait, not a sleep.

The select-all checkbox rule ("header only renders at ≥1000px") is captured in a comment. The Playwright config sets the viewport to ≥1200 (Phase 5), so this is documented behavior, not a runtime concern.

src/ui/components/oxd-date-picker.js
js
const { SELECTORS, byLabelText } = require('../selectors');

class OxdDatePicker {
constructor(page) { this.page = page; }

input(labelText) {
return this.page
.locator(byLabelText(labelText))
.locator('input.oxd-input');
}

async set(labelText, isoDate) {
// The date input is a native text input. Playwright fill works.
// But the underlying picker also writes a formatted value; we bypass
// the picker and set the input directly, then blur to commit.
const input = this.input(labelText);
await input.click();
await input.fill(isoDate);
await input.press('Tab');
}

async clear(labelText) {
await this.input(labelText).fill('');
await this.input(labelText).press('Tab');
}

async open(labelText) {
await this.input(labelText).click();
await this.page.locator(SELECTORS.dateCalendar).waitFor({ state: 'visible' });
}
}

module.exports = { OxdDatePicker };
Notes:

We fill the input directly and blur. The picker's shortcut links (Today, Clear) exist but we don't need them — direct input is more deterministic. This is a deliberate choice: Playwright's fill is faster and less fragile than navigating the picker.

If a future test needs to exercise the picker UI itself (a real user flow), add pickFromCalendar() as a separate method. Don't pollute set().

src/ui/components/oxd-dialog.js
js
const { SELECTORS } = require('../selectors');

class OxdDialog {
constructor(page) { this.page = page; }

root() { return this.page.locator(SELECTORS.overlay); }

async waitFor() {
await this.root().waitFor({ state: 'visible' });
}

async text() {
return (await this.root().innerText()).trim();
}

async confirm() {
// Confirmation dialogs use a primary button whose label comes from i18n
// (general.yes_delete, general.yes_save, etc.). Anchor on role + visible.
await this.root()
.locator('button.oxd-button--secondary, button.oxd-button--label-danger')
.last()
.click();
await this.root().waitFor({ state: 'detached' });
}

async cancel() {
await this.root()
.locator('button.oxd-button--ghost')
.first()
.click();
await this.root().waitFor({ state: 'detached' });
}
}

module.exports = { OxdDialog };
Notes:

The class name lookup (oxd-button--secondary, oxd-button--label-danger) comes from the frontend doc. If OXD ever changes button classes, this is the one file that changes.

We wait for detached after confirm/cancel because the dialog is v-if. That's the correct condition-based wait.

src/ui/components/oxd-toast.js
js
const { SELECTORS } = require('../selectors');

class OxdToast {
constructor(page) { this.page = page; }

last() { return this.page.locator(SELECTORS.toast).last(); }

async waitForSuccess(text) {
const toast = this.page.locator(SELECTORS.toastSuccess).last();
await toast.waitFor({ state: 'visible' });
if (text) {
await toast.getByText(text).waitFor({ state: 'visible' });
}
}

async waitForError(text) {
const toast = this.page.locator(SELECTORS.toastError).last();
await toast.waitFor({ state: 'visible' });
if (text) {
await toast.getByText(text).waitFor({ state: 'visible' });
}
}

async text() {
return (await this.last().innerText()).trim();
}

async dismiss() {
await this.last().click();
}
}

module.exports = { OxdToast };
Notes:

The toast container is aria-live="assertive" per the frontend doc — visible from the moment it renders.

We don't assert on auto-dismiss timing. That's a known "NOT VERIFIED" quirk, and asserting on it would create flaky tests.

waitForSuccess(text?) takes optional text so both assert toast appeared and assert toast says X are one call.

src/ui/pages/employee-list-page.js
Page objects are domain-named methods, not generic locators. Look at how small this is when the components do the work.

js
const { BasePage } = require('../base-page');
const { OxdTable } = require('../components/oxd-table');
const { OxdDialog } = require('../components/oxd-dialog');
const { OxdToast } = require('../components/oxd-toast');

class EmployeeListPage extends BasePage {
constructor(page, baseUrl) {
super(page, baseUrl);
this.table = new OxdTable(page);
this.dialog = new OxdDialog(page);
this.toast = new OxdToast(page);
}

async goto() { await super.goto('/web/index.php/pim/viewEmployeeList'); }

async addEmployee() {
await this.page.getByRole('link', { name: 'Add' }).click();
await this.page.waitForLoadState('domcontentloaded');
}

async searchByName(name) {
await this.page
.locator(this.sel.inputGroup)
.filter({ hasText: 'Employee Name' })
.locator('input.oxd-input')
.fill(name);
await this.page.getByRole('button', { name: 'Search' }).click();
await this.table.waitForLoad();
}

async deleteEmployeeByName(name) {
await this.table.clickAction(name, 'trash');
await this.dialog.waitFor();
await this.dialog.confirm();
await this.toast.waitForSuccess();
}

async rowCount() { return this.table.rowCount(); }
async hasRow(text) { return (await this.table.rowByText(text).count()) > 0; }
}

module.exports = { EmployeeListPage };
Notes:

deleteEmployeeByName is the whole delete flow. In the test, one line. In the page object, three lines that clearly map to the frontend doc: click trash → dialog appears → confirm → success toast.

No getByText scattered through the test. No waitForTimeout(1000). No asserting on CSS classes from the test file.

Every method is a behavior, not a wrapper.

src/ui/workflows/create-employee.js
Workflows wire pages and components without knowing about API or DB.

js
const { EmployeeListPage } = require('../pages/employee-list-page');
const { AddEmployeePage } = require('../pages/add-employee-page');
const { OxdToast } = require('../components/oxd-toast');

async function createEmployee(page, baseUrl, { firstName, lastName, employeeId }) {
const list = new EmployeeListPage(page, baseUrl);
const toast = new OxdToast(page);

await list.goto();
await list.addEmployee();

const form = new AddEmployeePage(page, baseUrl);
await form.fill({ firstName, lastName, employeeId });
await form.save();

await toast.waitForSuccess();
}

module.exports = { createEmployee };
That's a workflow: pages + components, no API, no DB, one file, fifteen lines. If your workflow needs API or DB (e.g. "create employee via API, verify in UI"), that's a Phase 5 cross-layer workflow — not a Phase 4 UI workflow.

src/ui/index.js — composition root
js
const { BasePage } = require('./base-page');
const { OxdForm } = require('./components/oxd-form');
const { OxdSelect } = require('./components/oxd-select');
const { OxdTable } = require('./components/oxd-table');
const { OxdDatePicker } = require('./components/oxd-date-picker');
const { OxdDialog } = require('./components/oxd-dialog');
const { OxdToast } = require('./components/oxd-toast');

const { LoginPage } = require('./pages/login-page');
const { DashboardPage } = require('./pages/dashboard-page');
const { EmployeeListPage } = require('./pages/employee-list-page');
const { AddEmployeePage } = require('./pages/add-employee-page');
const { LeaveListPage } = require('./pages/leave-list-page');
const { AdminUsersPage } = require('./pages/admin-users-page');

// Everything constructible from (page, baseUrl).
// No module-level state. No singletons. No globals.
function createUi(page, baseUrl) {
return {
base: new BasePage(page, baseUrl),

    components: {
      form:     new OxdForm(page),
      select:   new OxdSelect(page),
      table:    new OxdTable(page),
      date:     new OxdDatePicker(page),
      dialog:   new OxdDialog(page),
      toast:    new OxdToast(page),
    },

    pages: {
      login:      new LoginPage(page, baseUrl),
      dashboard:  new DashboardPage(page, baseUrl),
      employees:  new EmployeeListPage(page, baseUrl),
      addEmployee:new AddEmployeePage(page, baseUrl),
      leave:      new LeaveListPage(page, baseUrl),
      users:      new AdminUsersPage(page, baseUrl),
    },

};
}

module.exports = { createUi };
One function. One page. One baseUrl. Every UI object your test could ever need.

In a Playwright test:

js
const ui = createUi(page, process.env.OHRM_BASE_URL);

await ui.pages.login.loginAs('admin');
await ui.pages.employees.goto();
await ui.components.table.waitForRowCount(4);
await ui.components.toast.waitForSuccess();
Notice what's not there: no new EmployeeListPage(page), no page.locator('.oxd-table-card'), no waitForTimeout. That's what the composition root buys you.

Part 5 — The One Rule That Keeps This From Becoming the Framework Monster
If a component method is called from exactly one page, it is not a component method — it's a page method.

Wrapping a component is justified only when at least two pages share the interaction. OxdTable, OxdDialog, OxdToast, OxdForm, OxdSelect, OxdDatePicker — those six patterns appear on every list/form/detail page. OxdPagination, OxdTab, OxdTreeView, OxdDropdownMenu — do not add these as components until a second page needs them.

Concretely:

Component First motivated by Second confirmed by
OxdForm Login page Every form on every page
OxdSelect Admin Users page (role dropdown) Leave (type), PIM (job title), etc.
OxdTable Employee List Leave List, Admin Users, Recruitment
OxdDatePicker Add Employee (DOB) Leave (dates), Timesheet
OxdDialog Delete confirmation Every confirm in the app
OxdToast Every action Every action
You add the seventh component only when the second concrete use case appears. Until then, put the method on the page that needs it.

Part 6 — The Frontend-Doc Quirks, Handled Once and Only Once
Your frontend research doc catalogued these. Each one lives in exactly one place in this framework. That's the point.

Quirk Handled In
OxdLabel has no for → getByLabel() fails selectors.js → byLabelText(), used only by OxdForm and OxdSelect
OxdSelectInput is not a native <select> OxdSelect uses .oxd-select-text-input + .oxd-select-option
Autocomplete debounce is 800ms OxdSelect.autocomplete() — Playwright auto-waits on the option; no explicit sleep
Card table rows are .oxd-table-card, <tr> may be hoisted OxdTable anchors on .oxd-table-card exclusively
Header renders only at ≥1000px Documented in OxdTable.selectAllCheckbox(); viewport locked at ≥1200 in Playwright config
Row checkbox uses @click.stop OxdTable.checkboxInRow() targets the checkbox wrapper, not the row
v-if vs v-show for menu items, dropdowns, toasts Each component's open/close waits on visible/detached correctly
401 → full page reload base-page.js uses waitForLoadState + waitForReady after every navigation
Navigation is always full page load BasePage.goto and navigateSidebar do waitForLoadState
unselectableEmpNumbers hides the checkbox Documented; test asserts on presence, never on disabled state
Only first error per field shown OxdForm.errorFor() returns a single string or null
Each quirk is one place. If OXD changes, you update one entry in selectors.js or one method in a component. That's the whole point of the layer.

Part 7 — What Phase 4 Does NOT Do (Yet)
No page object per screen the tests don't touch. You have six pages. The app has ~80 screens. Add pages as tests need them, one at a time.

No component per OXD export. Six components. OXD has 61. If you tried to wrap all 61, you'd have 61 files of shims and you'd rebuild Playwright's own locators.

No cross-layer workflow. A workflow that uses API to set up and UI to verify is a Phase 5 concern. Keeping them separate now forces explicit design at the call site.

No data-testid injection into the app. OrangeHRM is upstream software. Your framework adapts to its DOM, not the other way around.

No visual regression. Not yet.

No accessibility assertions beyond the roles already used. A dedicated a11y/ layer comes when you actually have a11y requirements.

No custom selector engine. Playwright's getByRole, getByText, filter, and :has(...) cover every case in the frontend doc. Adding a custom engine is a solution to a problem you don't have.

No framework-internal retry. Playwright's auto-waiting handles it. waitForTimeout is prohibited because it would hide flakiness instead of surfacing it.

No custom expect extensions yet. Add one when the same three-line assertion appears in three tests.

Each of these is a "later" that a specific test earns for you.

Part 8 — The Full Framework as It Now Stands
text
scripts/
├── obtain-token.js # Phase 1
├── api-smoke.js # Phase 2
└── db-smoke.js # Phase 3

src/
├── auth/ # Phase 1
│ ├── pkce.js
│ ├── oauth-client.js
│ ├── oauth-authorizer.js
│ ├── token-store.js
│ ├── token-manager.js
│ └── errors.js
├── api/ # Phase 2
│ ├── client.js
│ ├── envelope.js
│ ├── errors.js
│ ├── index.js
│ └── endpoints/_.js
├── db/ # Phase 3
│ ├── pool.js
│ ├── client.js
│ ├── row.js
│ ├── errors.js
│ ├── index.js
│ └── repositories/_.js
├── ui/ # Phase 4
│ ├── selectors.js
│ ├── base-page.js
│ ├── index.js
│ ├── components/_.js
│ ├── pages/_.js
│ └── workflows/*.js
└── config/
├── env.js
└── users.js
Four independent composition roots, one per layer. Each layer is replaceable. Each layer is testable in isolation. Each layer's boundary is a single file:

Auth's boundary: _normalize() in oauth-client.js

API's boundary: envelope.js

DB's boundary: the SELECT clauses in repositories

UI's boundary: selectors.js

Change OXD → touch one file. Change envelope → touch one file. Change auth wire format → touch one file. That is the whole architecture.

Part 9 — Consistency Across the Four Phases
Principle Auth API DB UI
One reason to change per file ✅ ✅ ✅ ✅
Boundary translation once ✅ ✅ ✅ ✅ selectors.js
Injected dependencies ✅ ✅ ✅ ✅ (page, baseUrl)
Composition root ✅ ✅ ✅ ✅ createUi
No speculative abstraction ✅ ✅ ✅ ✅ six components
Playwright only where justified ✅ authorizer ✗ never ✗ never ✅ everywhere
Error taxonomy ✅ ✅ ✅ ✗ (Playwright's native errors suffice)
Named for the question they answer ✅ ✅ ✅ ✅ page/workflow methods
The same shape repeats four times. If you can hold one of these layers in your head, you can hold all four.

Part 10 — Phase 4 Implementation and Verification
The Phase 4 UI layer is implemented under src/ui/: centralized selectors, a navigation base page, six reusable OXD interaction components, six page objects, four UI-only workflows, and the createUi composition root. The isolated UI tests are in tests/framework/ui.spec.js, and the viewport is fixed at 1280×900 so desktop OXD table headers are available.

The isolated UI regression suite covers selector construction, page navigation, each component's public interactions, all page/workflow entry points, and invalid-input behavior without requiring a running OrangeHRM server:

sh
npm test -- tests/framework/ui.spec.js
npx eslint src/ui tests/framework/ui.spec.js playwright.config.js
npx prettier src/ui tests/framework/ui.spec.js playwright.config.js --check

`npm test` runs only the framework regression suite and does not load `.env` or require a running OrangeHRM server. The separate `npm run test:live` command loads `.env` through playwright.live.config.js and runs the tests under tests/live.

The repository also includes a no-mock integration suite against the running OrangeHRM, MariaDB, and real browser:

```sh
npm run test:live
```

Create `.env` from `.env.example`, start the documented Compose services, configure the Admin and ESS credentials, OAuth client, and database connection, then run the command. The suite checks real Admin and ESS UI login, authenticated employee API reads, ESS row-level authorization, unauthenticated API rejection, API-to-database employee consistency, and a read-only database transaction. It creates or deletes no business records. Normal login audit events are produced by the application. The focused `npm test` regression suite remains independent of a running instance.

Part 11 — Naming the Whole Thing (for Your Own Defense)
SRP — selectors, base navigation, one component per interaction pattern, one page per screen, one workflow per business flow.

DIP — pages depend on components (injected in the constructor); components depend on page (injected).

Boundary translation — every OXD DOM class lives in selectors.js; every quirk is documented in the one component that handles it.

Composition root — createUi(page, baseUrl) wires everything. Nowhere else constructs a page or a component.

Law of Demeter — ui.pages.employees.deleteEmployeeByName('X'), not page.locator('.oxd-table-card').nth(3).locator('.bi-trash').click().

No speculative generality — six components; pages added only when a test needs one; workflows added only when a flow is shared.

Naming reveals intent — waitForSuccess, clickAction, fillByLabel, waitForRowCount. Reading the method name tells you what it does without reading the DOM.

Condition-based waiting only — no waitForTimeout anywhere. Playwright's auto-waiting and waitFor(state) cover every case.

Test code is production code — every rule from Phases 1–3 applies here: no globals, injected dependencies, boundary discipline, composition root, no speculative abstractions.

One Final Note
The four layers answer four different questions:

Auth: Who am I?

API: What can I ask the server?

DB: What is actually persisted?

UI: What does the user see?

Each has one composition root. Each has one boundary file. Each hides exactly the things the layer above should not see. Test code composes them:

js
const api = await buildApi('admin'); // Phase 1 + 2
const db = createDb({ /* from env */ }); // Phase 3
const ui = createUi(page, baseUrl); // Phase 4

// Verify a cross-layer workflow without coupling any layer to another
const created = await api.employees.create({ firstName: 'X', lastName: 'Y' });
const row = await db.employees.findById(created.data.empNumber);
expect(row.emp_firstname).toBe('X');
await ui.pages.employees.goto();
expect(await ui.components.table.hasRow('Y')).toBe(true);
That's the whole framework. Four independent layers, each with one entry point, each replaceable, each honest about what it knows.

Build it. Tell me what breaks.
