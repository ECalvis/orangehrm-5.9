class ApiError extends Error {
  constructor(message, { status, code, data, raw } = {}) {
    super(message);

    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
    this.raw = raw;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

module.exports = { ApiError };
