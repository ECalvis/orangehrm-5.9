const path = require('path');

const AUTH_DIR = path.resolve(__dirname, '../../auth');

function requiredRoleEnv(roleName, varName) {
  const value = process.env[varName];

  if (!value) {
    throw new Error(`Missing required environment variable for role "${roleName}": ${varName}`);
  }

  return value;
}

function role(name, prefix) {
  return {
    get username() {
      return requiredRoleEnv(name, `OHRM_${prefix}_USERNAME`);
    },
    get password() {
      return requiredRoleEnv(name, `OHRM_${prefix}_PASSWORD`);
    },
    tokenFile: path.join(AUTH_DIR, `${name}.token.json`),
  };
}

module.exports = {
  admin: role('admin', 'ADMIN'),
  ess: role('ess', 'ESS'),
};
