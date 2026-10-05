const path = require('path');

function required(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const env = {
  baseUrl: required('OHRM_BASE_URL'),

  oauthClientId: required('OHRM_OAUTH_CLIENT_ID'),

  oauthAuthUrl:
    process.env.OHRM_OAUTH_AUTH_URL ||
    `${required('OHRM_BASE_URL')}/web/index.php/oauth2/authorize`,

  oauthTokenUrl:
    process.env.OHRM_OAUTH_TOKEN_URL || `${required('OHRM_BASE_URL')}/web/index.php/oauth2/token`,

  oauthRedirectUri: required('OHRM_OAUTH_REDIRECT_URI'),

  authRedirectPort: Number(process.env.OHRM_AUTH_REDIRECT_PORT || 9876),

  authDirectory: path.resolve(__dirname, '../../auth'),
};

module.exports = env;
