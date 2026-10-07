class AuthenticationError extends Error {
  constructor(message, meta = {}) {
    super(message);

    this.name = 'AuthenticationError';

    for (const [key, value] of Object.entries(meta)) {
      if (key !== 'message' && key !== 'name' && key !== 'stack') {
        this[key] = value;
      }
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// The token endpoint rejected the request for a reason that is about the
// request itself: invalid_grant, invalid_client, invalid_request, etc. This
// is distinct from a transport failure (network down, timeout) which also
// surfaces as an AuthenticationError but must NOT trigger a browser fallback
// in TokenManager.
class OAuthRejectedError extends AuthenticationError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.name = 'OAuthRejectedError';
  }
}

module.exports = {
  AuthenticationError,
  OAuthRejectedError,
};
