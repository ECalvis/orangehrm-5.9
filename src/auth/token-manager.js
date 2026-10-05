const { AuthenticationError } = require('./errors');

class TokenManager {
  constructor({ oauth, authorizer, store, credentials, refreshSafetyMs = 60_000 }) {
    if (!oauth) throw new TypeError('oauth collaborator is required');
    if (!authorizer) throw new TypeError('authorizer collaborator is required');
    if (!store) throw new TypeError('store collaborator is required');
    if (!credentials?.username || !credentials?.password) {
      throw new TypeError('credentials are required');
    }

    this.oauth = oauth;
    this.authorizer = authorizer;
    this.store = store;
    this.credentials = credentials;
    this.refreshSafetyMs = refreshSafetyMs;
    this.inFlight = null;
  }

  async getAccessToken() {
    const cached = this.store.load();

    if (this._isValid(cached)) {
      return cached.accessToken;
    }

    if (!this.inFlight) {
      this.inFlight = this._acquire().finally(() => {
        this.inFlight = null;
      });
    }

    const token = await this.inFlight;

    return token.accessToken;
  }

  async _acquire() {
    const cached = this.store.load();

    if (cached?.refreshToken) {
      try {
        const refreshed = await this.oauth.refresh(cached.refreshToken);

        // OrangeHRM may or may not rotate the refresh token. If the new
        // response omits it, keep the old one — otherwise the next refresh
        // attempt has nothing to send and we fall back to the full browser
        // flow, which defeats the point of storing a refresh token at all.
        const merged = {
          ...refreshed,
          refreshToken: refreshed.refreshToken ?? cached.refreshToken,
        };

        this.store.save(merged);
        return merged;
      } catch {
        // Refresh failed (revoked, expired, server error). Fall through to
        // the full authorization-code flow.
      }
    }

    const authorizationRequest = this.oauth.createAuthorizationRequest();

    const callback = await this.authorizer.authorize({
      authorizationUrl: authorizationRequest.url,
      expectedState: authorizationRequest.state,
      credentials: this.credentials,
    });

    if (!callback?.code) {
      throw new AuthenticationError('Authorization did not return a code');
    }

    const tokens = await this.oauth.exchangeCode({
      code: callback.code,
      verifier: authorizationRequest.verifier,
    });

    this.store.save(tokens);
    return tokens;
  }

  _isValid(token) {
    if (!token?.accessToken) {
      return false;
    }

    if (token.expiresAt == null) {
      return true;
    }

    const expiresAt = Number(token.expiresAt);

    return Number.isFinite(expiresAt) && Date.now() + this.refreshSafetyMs < expiresAt;
  }

  clear() {
    this.store.clear();
  }
}

module.exports = {
  TokenManager,
};
