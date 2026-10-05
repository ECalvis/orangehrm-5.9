const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');

dotenvExpand.expand(dotenv.config());

const { OAuthClient } = require('../src/auth/oauth-client');
const { OAuthAuthorizer } = require('../src/auth/oauth-authorizer');
const { FileTokenStore } = require('../src/auth/token-store');
const { TokenManager } = require('../src/auth/token-manager');
const env = require('../src/config/env');
const users = require('../src/config/users');

/* eslint-disable no-console */

async function main(roleName) {
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
    redirectUri: env.oauthRedirectUri,
  });

  const authorizer = new OAuthAuthorizer({
    callbackHost: env.callbackHost,
    callbackPort: env.callbackPort,
    callbackPath: env.callbackPath,
    timeoutMs: 120_000,
  });

  const store = new FileTokenStore(role.tokenFile);

  const manager = new TokenManager({
    oauth,
    authorizer,
    store,
    credentials: {
      username: role.username,
      password: role.password,
    },
  });

  await manager.getAccessToken();

  console.log('Access token acquired successfully.');
  console.log(`Token saved to: ${role.tokenFile}`);
}

main(process.argv[2] || 'admin').catch((err) => {
  console.error('\nAuthentication failed:');
  console.error(err.message);
  process.exit(1);
});
