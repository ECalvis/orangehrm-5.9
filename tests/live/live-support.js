const { createApi } = require('../../src/api');
const { OAuthAuthorizer } = require('../../src/auth/oauth-authorizer');
const { OAuthClient } = require('../../src/auth/oauth-client');
const { FileTokenStore } = require('../../src/auth/token-store');
const { TokenManager } = require('../../src/auth/token-manager');
const env = require('../../src/config/env');
const users = require('../../src/config/users');
const { createDb } = require('../../src/db');

function createLiveApi(roleName) {
  const user = users[roleName];
  const oauth = new OAuthClient({
    authorizationUrl: env.oauthAuthUrl,
    tokenUrl: env.oauthTokenUrl,
    clientId: env.oauthClientId,
    clientSecret: env.oauthClientSecret,
    redirectUri: env.oauthRedirectUri,
  });
  const authorizer = new OAuthAuthorizer({
    callbackHost: env.callbackHost,
    callbackPort: env.callbackPort,
    callbackPath: env.callbackPath,
    timeoutMs: 120_000,
  });
  const tokenManager = new TokenManager({
    oauth,
    authorizer,
    store: new FileTokenStore(user.tokenFile),
    credentials: { username: user.username, password: user.password },
  });

  return createApi({ baseUrl: env.apiBaseUrl, tokenManager });
}

function createLiveDb() {
  return createDb({
    host: process.env.OHRM_DB_HOST,
    port: Number(process.env.OHRM_DB_PORT),
    user: process.env.OHRM_DB_USER,
    password: process.env.OHRM_DB_PASSWORD ?? '',
    database: process.env.OHRM_DB_NAME,
  });
}

module.exports = { createLiveApi, createLiveDb };
