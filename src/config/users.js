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
