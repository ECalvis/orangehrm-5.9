const crypto = require('crypto');

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createVerifier() {
  return base64url(crypto.randomBytes(64));
}

function createChallenge(verifier) {
  if (typeof verifier !== 'string' || verifier.length === 0) {
    throw new TypeError('PKCE verifier must be a non-empty string');
  }

  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

function createState() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  createVerifier,
  createChallenge,
  createState,
};
