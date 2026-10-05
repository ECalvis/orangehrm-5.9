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

class ApiContractError extends Error {
  constructor(message, { stage, operation, issues }) {
    super(message);

    this.name = 'ApiContractError';
    this.stage = stage;
    this.operation = operation;
    this.issues = issues;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

module.exports = { ApiContractError, ApiError };
