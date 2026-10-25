const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');

dotenvExpand.expand(dotenv.config());

const { OAuthClient } = require('../src/auth/oauth-client');
const { OAuthAuthorizer } = require('../src/auth/oauth-authorizer');
const { FileTokenStore } = require('../src/auth/token-store');
const { TokenManager } = require('../src/auth/token-manager');
const { createApi } = require('../src/api');
const env = require('../src/config/env');
const users = require('../src/config/users');

/* eslint-disable no-console */

async function buildApi(roleName) {
  const role = users[roleName];

  if (!role) {
    throw new Error(
      `Unknown role "${roleName}". Available roles: ${Object.keys(users).join(', ')}`,
    );
  }

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

  const store = new FileTokenStore(role.tokenFile);
  const tokenManager = new TokenManager({
    oauth,
    authorizer,
    store,
    credentials: {
      username: role.username,
      password: role.password,
    },
  });

  return createApi({ baseUrl: env.apiBaseUrl, tokenManager });
}

async function main(roleName = 'admin') {
  const api = await buildApi(roleName);
  const result = await api.pim.employees.list({ limit: 5 });
  console.log(JSON.stringify(result, null, 2));
}

main(process.argv[2] || 'admin').catch((error) => {
  console.error('\nAPI smoke check failed:');
  console.error(error.message);
  process.exit(1);
});
