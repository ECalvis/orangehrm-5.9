const { randomBytes } = require('crypto');

function createTestIdentity(prefix = 'QA') {
  if (!/^[A-Z]{1,2}$/.test(prefix)) {
    throw new TypeError('Test identity prefix must contain one or two uppercase letters');
  }

  const suffix = randomBytes(4).toString('hex').toUpperCase();
  return {
    tag: `${prefix}-${Date.now().toString(36).toUpperCase()}-${suffix}`,
    employeeId: `${prefix}${suffix}`,
  };
}

module.exports = { createTestIdentity };
