const STATUS_CODE_MAP = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  422: 'VALIDATION',
  500: 'SERVER_ERROR',
};

function normalizeSuccess(body) {
  return {
    data: body?.data ?? null,
    meta: body?.meta ?? {},
    rels: body?.rels ?? [],
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
    return {
      message: body.error_description,
      status: response?.status,
      code: 'OAUTH_ERROR',
      data: body.hint == null ? undefined : { hint: body.hint },
    };
  }

  return {
    message: error?.message ?? axiosError.message,
    status: error?.status ?? response?.status,
    code: classify(response?.status),
    data: error?.data,
  };
}

module.exports = { normalizeSuccess, normalizeError };
