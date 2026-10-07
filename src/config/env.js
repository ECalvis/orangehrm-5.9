const { URL } = require('url');

function required(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const baseUrl = required('OHRM_BASE_URL');

// The redirect URI is the single source of truth for the callback server's
// host, port, and path. Deriving them here eliminates a class of
// misconfiguration where OHRM_OAUTH_REDIRECT_URI and OHRM_AUTH_REDIRECT_PORT
// disagree and the OAuth flow fails with an opaque state mismatch or timeout.
const oauthRedirectUri = required('OHRM_OAUTH_REDIRECT_URI');

let redirectUrl;
try {
  redirectUrl = new URL(oauthRedirectUri);
} catch {
  throw new Error(`OHRM_OAUTH_REDIRECT_URI is not a valid absolute URL: ${oauthRedirectUri}`);
}

if (redirectUrl.protocol !== 'http:') {
  throw new Error(
    `OHRM_OAUTH_REDIRECT_URI must use http because the local callback server does not terminate TLS: ${oauthRedirectUri}`,
  );
}

if (!redirectUrl.port) {
  throw new Error(
    `OHRM_OAUTH_REDIRECT_URI must include an explicit port (the callback server needs one): ${oauthRedirectUri}`,
  );
}

const callbackPort = Number(redirectUrl.port);
if (!Number.isInteger(callbackPort) || callbackPort < 1 || callbackPort > 65535) {
  throw new Error(`OHRM_OAUTH_REDIRECT_URI has an invalid port: ${redirectUrl.port}`);
}

const env = {
  baseUrl,
  apiBaseUrl: process.env.API_BASE_URL || `${baseUrl}/web/index.php/api/v2`,

  oauthClientId: required('OHRM_OAUTH_CLIENT_ID'),

  oauthAuthUrl: process.env.OHRM_OAUTH_AUTH_URL || `${baseUrl}/web/index.php/oauth2/authorize`,

  oauthTokenUrl: process.env.OHRM_OAUTH_TOKEN_URL || `${baseUrl}/web/index.php/oauth2/token`,

  oauthRedirectUri,

  callbackHost: redirectUrl.hostname,
  callbackPort,
  callbackPath: redirectUrl.pathname,
};

module.exports = env;
