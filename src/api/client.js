const axios = require('axios');

const { ApiError } = require('./errors');
const { normalizeSuccess, normalizeError } = require('./envelope');

class ApiClient {
  constructor({ baseUrl, tokenManager, logger } = {}) {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
      throw new TypeError('baseUrl is required');
    }

    if (typeof tokenManager?.getAccessToken !== 'function') {
      throw new TypeError('tokenManager.getAccessToken is required');
    }

    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.tokenManager = tokenManager;
    this.logger = logger;

    this.http = axios.create({
      baseURL: this.baseUrl,
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

  async request(config) {
    try {
      const response = await this.http.request(config);
      return normalizeSuccess(response.data);
    } catch (error) {
      const normalized = normalizeError(error);
      throw new ApiError(normalized.message, {
        status: normalized.status,
        code: normalized.code,
        data: normalized.data,
        raw: error.response,
      });
    }
  }

  async raw(config) {
    try {
      return await this.http.request(config);
    } catch (error) {
      const normalized = normalizeError(error);
      throw new ApiError(normalized.message, {
        status: normalized.status,
        code: normalized.code,
        data: normalized.data,
        raw: error.response,
      });
    }
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
