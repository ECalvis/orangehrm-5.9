class AuthenticationError extends Error {
  constructor(message, meta = {}) {
    super(message);

    this.name = 'AuthenticationError';

    Object.assign(this, meta);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuthenticationError);
    }
  }
}

module.exports = {
  AuthenticationError,
};
