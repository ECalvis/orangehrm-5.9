class AuthenticationError extends Error {
  constructor(message, meta = {}) {
    super(message);

    this.name = 'AuthenticationError';

    // Guard against meta overwriting the properties that make an Error an
    // Error. Assign everything except the reserved keys.
    const { message: _m, name: _n, stack: _s, ...rest } = meta;
    Object.assign(this, rest);

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
