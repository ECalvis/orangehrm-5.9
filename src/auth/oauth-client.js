const axios = require('axios');

const { createVerifier, createChallenge, createState } = require('./pkce');
const { AuthenticationError, OAuthRejectedError } = require('./errors');

class OAuthClient {
  constructor({ authorizationUrl, tokenUrl, clientId, redirectUri, timeoutMs = 30_000 }) {
    if (!authorizationUrl) throw new TypeError('authorizationUrl is required');
    if (!tokenUrl) throw new TypeError('tokenUrl is required');
    if (!clientId) throw new TypeError('clientId is required');
    if (!redirectUri) throw new TypeError('redirectUri is required');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive number');
    }

    this.authorizationUrl = authorizationUrl;
    this.tokenUrl = tokenUrl;
    this.clientId = clientId;
    this.redirectUri = redirectUri;
    this.timeoutMs = timeoutMs;
  }

  createAuthorizationRequest() {
    const verifier = createVerifier();
    const challenge = createChallenge(verifier);
    const state = createState();

    const url = new URL(this.authorizationUrl);

    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);

    return {
      url: url.toString(),
      verifier,
      state,
    };
  }

  async exchangeCode({ code, verifier }) {
    if (!code) throw new TypeError('code is required');
    if (!verifier) throw new TypeError('verifier is required');

    return this._tokenRequest(
      {
        grant_type: 'authorization_code',
        code,
        client_id: this.clientId,
        redirect_uri: this.redirectUri,
        code_verifier: verifier,
      },
      'Token exchange',
    );
  }

  async refresh(refreshToken) {
    if (!refreshToken) throw new TypeError('refreshToken is required');

    return this._tokenRequest(
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
      },
      'Token refresh',
    );
  }

  async _tokenRequest(params, label) {
    const body = new URLSearchParams(params).toString();

    let response;

    try {
      response = await axios.post(this.tokenUrl, body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: this.timeoutMs,
      });
    } catch (err) {
      throw this._classify(err, label);
    }

    return this._normalize(response.data);
  }

  // Decide whether a failure is "the server rejected our request" (retry with
  // a new grant) or "the request never completed" (retry the same request, or
  // surface the failure). TokenManager relies on this distinction to decide
  // whether to fall back to the browser flow.
  _classify(err, label) {
    const status = err.response?.status;
    const wire = err.response?.data;

    if (
      typeof status === 'number' &&
      status >= 400 &&
      status < 500 &&
      typeof wire?.error === 'string'
    ) {
      return new OAuthRejectedError(
        `${label} rejected: ${wire?.error || wire?.message || err.message}`,
        {
          status,
          hint: wire?.hint,
          oauthError: wire?.error,
        },
      );
    }

    // Transport failure (no response), timeout, or 5xx. The request may have
    // succeeded server-side; retrying is not safe to assume. Surface it as a
    // transport AuthenticationError and let the caller decide.
    return new AuthenticationError(`${label} failed: ${err.message}`, {
      status,
      cause: err.code || err.name,
      hint: wire?.hint,
    });
  }

  // The ONLY place snake_case is allowed.
  _normalize(data) {
    if (!data?.access_token) {
      throw new AuthenticationError('Token response missing access_token');
    }

    const expiresIn = data.expires_in;
    let expiresAt = null;

    if (expiresIn != null) {
      const numeric = Number(expiresIn);

      if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new AuthenticationError(`Invalid expires_in value: ${expiresIn}`);
      }

      expiresAt = Date.now() + numeric * 1000;
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      tokenType: data.token_type ?? 'Bearer',
      expiresAt,
    };
  }
}

module.exports = {
  OAuthClient,
};
