require('dotenv').config();
require('dotenv-expand').expand({ parsed: process.env });

const { OAuthClient } = require('../src/auth/oauth-client');
const { OAuthAuthorizer } = require('../src/auth/oauth-authorizer');
const { FileTokenStore } = require('../src/auth/token-store');
const { TokenManager } = require('../src/auth/token-manager');
const users = require('../src/config/users');

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  // Detect the common dotenv-expand failure mode where ${VAR} is left literal.
  if (value.includes('${')) {
    throw new Error(
      `Environment variable ${name} contains an unexpanded \${...} reference: "${value}". ` +
        `Did you install dotenv-expand and call expand() at the top of this script?`,
    );
  }

  return value;
}

async function main(roleName) {
  const role = users[roleName];

  if (!role) {
    throw new Error(
      `Unknown role "${roleName}". Available roles: ${Object.keys(users).join(', ')}`,
    );
  }

  const baseUrl = requireEnv('OHRM_BASE_URL');
  const clientId = requireEnv('OHRM_OAUTH_CLIENT_ID');
  const redirectUri = requireEnv('OHRM_OAUTH_REDIRECT_URI');

  const oauth = new OAuthClient({
    authorizationUrl:
      process.env.OHRM_OAUTH_AUTH_URL || `${baseUrl}/web/index.php/oauth2/authorize`,
    tokenUrl: process.env.OHRM_OAUTH_TOKEN_URL || `${baseUrl}/web/index.php/oauth2/token`,
    clientId,
    redirectUri,
  });

  const authorizer = new OAuthAuthorizer({
    callbackHost: 'localhost',
    callbackPort: Number(process.env.OHRM_AUTH_REDIRECT_PORT || 9876),
    callbackPath: '/oauth/callback',
    timeoutMs: 120_000, // browser + login + consent can exceed 60s on cold containers
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
