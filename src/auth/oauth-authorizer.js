const http = require('http');
const { URL } = require('url');
const { chromium } = require('playwright');

const { AuthenticationError } = require('./errors');

class OAuthAuthorizer {
  constructor({
    callbackHost = 'localhost',
    callbackPort = 9876,
    callbackPath = '/oauth/callback',
    timeoutMs = 120_000,
    headless = true,
  } = {}) {
    this.callbackHost = callbackHost;
    this.callbackPort = callbackPort;
    this.callbackPath = callbackPath;
    this.timeoutMs = timeoutMs;
    this.headless = headless;
  }

  async authorize({ authorizationUrl, expectedState, credentials }) {
    if (!authorizationUrl) {
      throw new TypeError('authorizationUrl is required');
    }
    if (!expectedState) {
      throw new TypeError('expectedState is required');
    }
    if (!credentials?.username || !credentials?.password) {
      throw new TypeError('credentials are required');
    }

    let callbackServer;
    let browser;
    let context;

    try {
      // 1. Start the callback server BEFORE the browser navigates anywhere.
      const callback = this._createCallbackServer(expectedState);
      callbackServer = await callback.serverReady;

      // 2. Launch browser.
      browser = await chromium.launch({ headless: this.headless });
      context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(authorizationUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });

      // 3. Wait until EITHER the login form OR the consent screen is visible.
      //    This replaces the old "wait 1s, then check isVisible()" heuristic.
      const usernameInput = page
        .locator('input[name="username"], input[placeholder="Username"]')
        .first();

      const passwordInput = page.locator('input[name="password"], input[type="password"]').first();

      const allowButton = page.getByRole('button', { name: /allow access/i }).first();

      const allowLink = page.getByRole('link', { name: /allow access/i }).first();

      await Promise.race([
        usernameInput.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
        allowButton.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
        allowLink.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
      ]);

      // 4. If the login form is showing, log in. Otherwise assume session exists.
      const loginVisible = await usernameInput.isVisible().catch(() => false);

      if (loginVisible) {
        await usernameInput.fill(credentials.username);
        await passwordInput.fill(credentials.password);

        const loginButton = page.getByRole('button', { name: /^login$/i }).first();

        if ((await loginButton.count()) > 0) {
          await loginButton.click();
        } else {
          const submitButton = page.locator('button[type="submit"]').first();

          if ((await submitButton.count()) > 0) {
            await submitButton.click();
          } else {
            throw new AuthenticationError('OrangeHRM login button was not found.');
          }
        }

        // Wait for navigation away from the login page, OR for the consent
        // screen to appear. Whichever comes first.
        await Promise.race([
          page
            .waitForURL(/oauth2\/authorize|oauth2\/consent/, {
              timeout: 15_000,
            })
            .catch(() => {}),
          allowButton.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
        ]);
      }

      // 5. Consent screen. Button preferred, link as fallback.
      let consentFound = false;

      try {
        await allowButton.waitFor({ state: 'visible', timeout: 15_000 });
        consentFound = true;
      } catch {
        /* fall through to link */
      }

      if (!consentFound) {
        try {
          await allowLink.waitFor({ state: 'visible', timeout: 5_000 });
          consentFound = true;
        } catch {
          /* fall through to error */
        }
      }

      if (!consentFound) {
        await page.screenshot({ path: 'oauth-debug.png', fullPage: true }).catch(() => {});

        throw new AuthenticationError(
          `OAuth consent screen was not displayed. Current URL: ${page.url()}`,
        );
      }

      if (await allowButton.isVisible().catch(() => false)) {
        await allowButton.click();
      } else {
        await allowLink.click();
      }

      // 6. Wait for the callback server to resolve.
      //    State validation has already happened inside the server.
      const callbackResult = await callback.result;

      if (!callbackResult.code) {
        throw new AuthenticationError('OAuth callback did not contain an authorization code.');
      }

      return {
        code: callbackResult.code,
        state: callbackResult.state,
      };
    } catch (err) {
      if (err instanceof AuthenticationError) {
        throw err;
      }

      throw new AuthenticationError(`OAuth authorization failed: ${err.message}`);
    } finally {
      if (callbackServer) {
        await this._stopCallbackServer(callbackServer);
      }
      if (context) {
        await context.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  _createCallbackServer(expectedState) {
    let server;
    let resolveResult;
    let rejectResult;
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    };

    const result = new Promise((resolve, reject) => {
      resolveResult = (v) => settle(resolve, v);
      rejectResult = (e) => settle(reject, e);
    });

    const serverReady = new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        try {
          const requestUrl = new URL(req.url, `http://${this.callbackHost}:${this.callbackPort}`);

          if (requestUrl.pathname !== this.callbackPath) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }

          const code = requestUrl.searchParams.get('code');
          const state = requestUrl.searchParams.get('state');
          const error = requestUrl.searchParams.get('error');
          const errorDescription = requestUrl.searchParams.get('error_description');

          if (state !== expectedState) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h2>State mismatch. You can close this window.</h2>');
            rejectResult(new AuthenticationError('OAuth state mismatch.'));
            return;
          }

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h2>Authorization failed. You can close this window.</h2>');
            rejectResult(
              new AuthenticationError(
                `OAuth authorization failed: ${error}${
                  errorDescription ? ` - ${errorDescription}` : ''
                }`,
              ),
            );
            return;
          }

          if (!code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h2>Authorization failed. You can close this window.</h2>');
            rejectResult(new AuthenticationError('OAuth callback did not contain a code.'));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!doctype html>
            <html>
            <head><meta charset="utf-8"><title>OAuth Complete</title></head>
            <body>
            <h2>Authentication complete</h2>
            <p>You can close this window.</p>
            </body>
            </html>
          `);

          resolveResult({
            code,
            state,
            error: null,
            errorDescription: null,
            url: requestUrl.toString(),
          });
        } catch (err) {
          rejectResult(err);
        }
      });

      server.on('error', (err) => {
        reject(err);
        rejectResult(err);
      });

      server.listen(this.callbackPort, this.callbackHost, () => resolve(server));
    });

    const timeout = setTimeout(() => {
      rejectResult(new AuthenticationError(`OAuth callback timed out after ${this.timeoutMs}ms.`));
    }, this.timeoutMs);

    // If the server fails to start, don't leave the timer running.
    serverReady.catch(() => {
      settled = true;
      clearTimeout(timeout);
    });

    return { serverReady, result };
  }

  async _stopCallbackServer(server) {
    if (!server || !server.listening) return;

    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}

module.exports = {
  OAuthAuthorizer,
};
