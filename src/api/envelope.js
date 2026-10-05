const STATUS_CODE_MAP = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  422: 'VALIDATION',
  500: 'SERVER_ERROR',
};

const { assertValid } = require('./schemas/validate');
const { errorEnvelope, oauthErrorEnvelope, successEnvelope } = require('./schemas/common');

function normalizeSuccess(body) {
  assertValid(successEnvelope, body, { stage: 'response', operation: 'API response' });

  return {
    data: body.data,
    meta: body.meta,
    rels: body.rels,
  };
}

function classify(status) {
  return STATUS_CODE_MAP[Number(status)] ?? 'UNKNOWN';
}

function normalizeError(axiosError) {
  const response = axiosError.response;
  const body = response?.data;
  const error = body?.error;

  if (body?.error_description) {
    assertValid(oauthErrorEnvelope, body, {
      stage: 'error response',
      operation: `${response?.status ?? 'HTTP'} error`,
    });
    return {
      message: body.error_description,
      status: response?.status,
      code: 'OAUTH_ERROR',
      data: body.hint == null ? undefined : { hint: body.hint },
    };
  }

  if (error && typeof error === 'object') {
    assertValid(errorEnvelope, body, {
      stage: 'error response',
      operation: `${response?.status ?? 'HTTP'} error`,
    });
  }

  return {
    message: error?.message ?? axiosError.message,
    status: error?.status ?? response?.status,
    code: classify(response?.status),
    data: error?.data,
  };
}

module.exports = { normalizeSuccess, normalizeError };
