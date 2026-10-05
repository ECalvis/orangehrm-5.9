const axios = require('axios');

const { ApiError } = require('./errors');
const { normalizeSuccess, normalizeError } = require('./envelope');
const { assertValid } = require('./schemas/validate');

class ApiClient {
  constructor({ baseUrl, tokenManager, logger } = {}) {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
      throw new TypeError('baseUrl is required');
    }

    let parsedBaseUrl;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      throw new TypeError('baseUrl must be an absolute HTTP(S) URL');
    }

    if (
      !['http:', 'https:'].includes(parsedBaseUrl.protocol) ||
      parsedBaseUrl.username ||
      parsedBaseUrl.password ||
      parsedBaseUrl.search ||
      parsedBaseUrl.hash
    ) {
      throw new TypeError(
        'baseUrl must be an absolute HTTP(S) URL without credentials, query, or fragment',
      );
    }

    if (typeof tokenManager?.getAccessToken !== 'function') {
      throw new TypeError('tokenManager.getAccessToken is required');
    }

    this.baseUrl = parsedBaseUrl.toString().replace(/\/+$/, '');
    this.apiOrigin = parsedBaseUrl.origin;
    this.apiBasePath = parsedBaseUrl.pathname.replace(/\/+$/, '') || '/';
    this.tokenManager = tokenManager;
    this.logger = logger;

    this.http = axios.create({
      baseURL: this.baseUrl,
      allowAbsoluteUrls: false,
      headers: { Accept: 'application/json' },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    this.http.interceptors.request.use(async (config) => {
      const token = await this.tokenManager.getAccessToken();
      config.headers.Authorization = `Bearer ${token}`;
      this.logger?.debug?.({ method: config.method, url: config.url }, 'api →');
      return config;
    });
  }

  _validateRequestUrl(url) {
    if (
      typeof url !== 'string' ||
      !url ||
      url.trim() !== url ||
      url.startsWith('//') ||
      url.includes('\\') ||
      /^[a-z][a-z\d+.-]*:/i.test(url)
    ) {
      throw new TypeError('API request URL must be a relative path');
    }

    let targetUrl;
    try {
      targetUrl = new URL(url.replace(/^\/+/, ''), `${this.baseUrl}/`);
    } catch (error) {
      throw new TypeError(`Invalid API request URL: ${error.message}`, { cause: error });
    }

    const isWithinApiBase =
      this.apiBasePath === '/' ||
      targetUrl.pathname === this.apiBasePath ||
      targetUrl.pathname.startsWith(`${this.apiBasePath}/`);

    if (targetUrl.origin !== this.apiOrigin || !isWithinApiBase) {
      throw new TypeError('API request URL must resolve within the configured API base URL');
    }
  }

  async _send(config) {
    this._validateRequestUrl(config?.url);

    try {
      return await this.http.request({
        ...config,
        baseURL: this.baseUrl,
        allowAbsoluteUrls: false,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 300,
      });
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        throw error;
      }

      const normalized = normalizeError(error);
      throw new ApiError(normalized.message, {
        status: normalized.status,
        code: normalized.code,
        data: normalized.data,
        raw: error.response,
      });
    }
  }

  async request({ contract, pathParams, ...config } = {}) {
    const operation = contract?.operation ?? `${config.method ?? 'GET'} ${config.url ?? ''}`;
    if (contract?.pathParamsSchema) {
      assertValid(contract.pathParamsSchema, pathParams, {
        stage: 'request path',
        operation,
      });
    }
    if (
      contract?.querySchema &&
      (config.params !== undefined || contract.querySchema.required?.length)
    ) {
      assertValid(contract.querySchema, config.params ?? {}, {
        stage: 'request query',
        operation,
      });
    }
    if (contract?.bodySchema && (contract.bodyRequired || config.data !== undefined)) {
      assertValid(contract.bodySchema, config.data, { stage: 'request body', operation });
    }

    const response = await this._send(config);
    const result = normalizeSuccess(response.data);
    if (contract?.responseSchema) {
      assertValid(contract.responseSchema, result.data, {
        stage: 'response data',
        operation,
      });
    }
    if (contract?.metaSchema) {
      assertValid(contract.metaSchema, result.meta, {
        stage: 'response meta',
        operation,
      });
    }
    if (contract?.responseBodySchema) {
      assertValid(contract.responseBodySchema, response.data, {
        stage: 'OpenAPI response',
        operation,
      });
    }
    return result;
  }

  raw(config) {
    return this._send(config);
  }

  get(path, { params, headers } = {}) {
    return this.request({ method: 'GET', url: path, params, headers });
  }

  post(path, body, { headers } = {}) {
    return this.request({ method: 'POST', url: path, data: body, headers });
  }

  put(path, body, { headers } = {}) {
    return this.request({ method: 'PUT', url: path, data: body, headers });
  }

  delete(path, body, { headers } = {}) {
    return this.request({ method: 'DELETE', url: path, data: body, headers });
  }
}

module.exports = { ApiClient };
