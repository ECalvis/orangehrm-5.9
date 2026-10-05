const axios = require('axios');

const { createVerifier, createChallenge, createState } = require('./pkce');
const { AuthenticationError } = require('./errors');

class OAuthClient {
  constructor({ authorizationUrl, tokenUrl, clientId, redirectUri }) {
    if (!authorizationUrl) throw new TypeError('authorizationUrl is required');
    if (!tokenUrl) throw new TypeError('tokenUrl is required');
    if (!clientId) throw new TypeError('clientId is required');
    if (!redirectUri) throw new TypeError('redirectUri is required');

    this.authorizationUrl = authorizationUrl;
    this.tokenUrl = tokenUrl;
    this.clientId = clientId;
    this.redirectUri = redirectUri;
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

    try {
      const { data } = await axios.post(this.tokenUrl, body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      return this._normalize(data);
    } catch (err) {
      const wire = err.response?.data;

      throw new AuthenticationError(
        `${label} failed: ${wire?.error || wire?.message || err.message}`,
        {
          status: err.response?.status,
          hint: wire?.hint,
        },
      );
    }
  }

  // The ONLY place snake_case is allowed.
  _normalize(data) {
    if (!data?.access_token) {
      throw new AuthenticationError('Token response missing access_token');
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      tokenType: data.token_type ?? 'Bearer',
      expiresAt: data.expires_in != null ? Date.now() + Number(data.expires_in) * 1000 : null,
    };
  }
}

module.exports = {
  OAuthClient,
};
