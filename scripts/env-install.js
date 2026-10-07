const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');
const { chromium, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const INSTALLER_WELCOME = '/installer/index.php/welcome';
const INSTALL_TIMEOUT = 10 * 60 * 1000;

/* eslint-disable no-console */

dotenvExpand.expand(dotenv.config({ path: ENV_PATH }));

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable in .env: ${name}`);
  }

  return value;
}

function updateEnvValues(values) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const newline = content.includes('\r\n') ? '\r\n' : '\n';

  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    const assignment = new RegExp(`^${name}\\s*=.*$`, 'm');

    if (assignment.test(content)) {
      content = content.replace(assignment, line);
    } else {
      content = `${content.replace(/[\r\n]+$/, '')}${newline}${line}`;
    }
  }

  fs.writeFileSync(ENV_PATH, content.endsWith(newline) ? content : `${content}${newline}`);
}

async function waitForInstaller(page, baseUrl) {
  const deadline = Date.now() + 180_000;
  let lastFailure = 'The installer welcome page did not become available.';

  while (Date.now() < deadline) {
    let response;

    try {
      response = await page.goto(baseUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
    } catch (error) {
      lastFailure = error.message;
    }

    if (response?.ok()) {
      const welcomeUrl = `${baseUrl}${INSTALLER_WELCOME}`;

      if (page.url() !== welcomeUrl) {
        throw new Error(
          `Expected a fresh installation at ${welcomeUrl}, but the server opened ${page.url()}. ` +
            'If this instance was already installed, reset its Docker volumes before retrying.',
        );
      }

      try {
        await expect(page.getByRole('radio', { name: 'Fresh Installation' })).toBeVisible({
          timeout: 5_000,
        });
        return;
      } catch (error) {
        lastFailure = error.message;
      }
    } else if (response) {
      lastFailure = `The server returned HTTP ${response.status()}.`;
    }

    await page.waitForTimeout(3_000);
  }

  throw new Error(
    `OrangeHRM is not ready at ${baseUrl}. ${lastFailure} Check the Docker logs and retry.`,
  );
}

async function expectRoute(page, baseUrl, route) {
  await expect(page).toHaveURL(`${baseUrl}${route}`);
}

async function selectDropdown(page, label, option) {
  const field = page.locator('.oxd-input-group', { hasText: label });

  await field.locator('.oxd-select-text').click();
  await page.getByText(option, { exact: true }).click();
}

async function expectSaved(page) {
  await expect(page.getByText('Successfully Saved', { exact: false })).toBeVisible({
    timeout: 15_000,
  });
}

async function registerOAuthClient(page, baseUrl, { name, redirectUri, envPrefix, comment }) {
  await page.getByRole('button', { name: 'Add' }).click();
  await expectRoute(page, baseUrl, '/web/index.php/admin/saveOAuthClient');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Redirect URI').fill(redirectUri);
  await page
    .locator('.orangehrm-field-row', { hasText: 'Confidential Client' })
    .locator('input[type="checkbox"]')
    .check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expectSaved(page);

  const clientId = await page.getByLabel('Client ID').inputValue();
  const clientSecret = await page.getByLabel('Client Secret').inputValue();

  if (!clientId || !clientSecret) {
    throw new Error(`OrangeHRM did not return credentials for the ${name} OAuth client.`);
  }

  if (comment) {
    updateEnvValues({
      [`# ${envPrefix}_OAUTH_CLIENT_ID`]: clientId,
      [`# ${envPrefix}_OAUTH_CLIENT_SECRET`]: clientSecret,
    });
  } else if (envPrefix === 'PLAYWRIGHT') {
    updateEnvValues({
      PLAYWRIGHT_OAUTH_CLIENT_ID: clientId,
      PLAYWRIGHT_OAUTH_CLIENT_SECRET: clientSecret,
      OHRM_OAUTH_CLIENT_ID: clientId,
      OHRM_OAUTH_CLIENT_SECRET: clientSecret,
    });
  } else {
    updateEnvValues({
      [`${envPrefix}_OAUTH_CLIENT_ID`]: clientId,
      [`${envPrefix}_OAUTH_CLIENT_SECRET`]: clientSecret,
    });
  }

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expectRoute(page, baseUrl, '/web/index.php/admin/registerOAuthClient');
}

async function install(page, baseUrl) {
  await waitForInstaller(page, baseUrl);

  await page.getByRole('radio', { name: 'Fresh Installation' }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await expectRoute(page, baseUrl, '/installer/index.php/installer/licence-acceptance');
  await page.getByText('I accept the terms in the').click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expectRoute(page, baseUrl, '/installer/index.php/installer/database-config');
  await page.getByRole('radio', { name: 'Existing Empty Database' }).check();
  await page.getByLabel('Database Host Name').fill('mariadb');
  await page.getByLabel('Database Host Port').fill('3306');
  await page.getByLabel('Database Name').fill(requiredEnv('OHRM_DB_NAME'));
  await page.getByLabel('OrangeHRM Database Username').fill(requiredEnv('OHRM_DB_USER'));
  await page.getByLabel('OrangeHRM Database User Password').fill(requiredEnv('OHRM_DB_PASSWORD'));
  await page.getByRole('button', { name: 'Next' }).click();

  await expectRoute(page, baseUrl, '/installer/index.php/installer/system-check');
  await page.getByRole('button', { name: 'Next' }).click();

  await expectRoute(page, baseUrl, '/installer/index.php/installer/instance-creation');
  await page.getByLabel('Organization Name').fill('ECalvis');
  await selectDropdown(page, 'Country', 'Philippines');
  await selectDropdown(page, 'Language', 'English (United States)');
  await selectDropdown(page, 'Timezone', 'Asia/Manila');
  await page.getByRole('button', { name: 'Next' }).click();

  await expectRoute(page, baseUrl, '/installer/index.php/installer/admin-user-creation');
  await page.getByPlaceholder('First Name').fill('Caummo');
  await page.getByPlaceholder('Last Name').fill('Bunummu');
  await page.getByLabel('Email').fill(requiredEnv('OHRM_ADMIN_USERNAME'));
  await page.getByLabel('Contact Number').fill('09123456789');
  await page.getByLabel('Admin Username').fill(requiredEnv('OHRM_ADMIN_USERNAME'));
  await page.getByLabel('Password').fill(requiredEnv('OHRM_ADMIN_PASSWORD'));
  await page.getByLabel('Confirm Password').fill(requiredEnv('OHRM_ADMIN_PASSWORD'));
  await page.locator('input[type="checkbox"]').uncheck();
  await page.getByRole('button', { name: 'Next' }).click();

  await expectRoute(page, baseUrl, '/installer/index.php/installer/confirmation');
  await page.getByRole('button', { name: 'Install' }).click();
  await expectRoute(page, baseUrl, '/installer/index.php/installer/process');
  await page.getByRole('button', { name: 'Next' }).waitFor({
    state: 'visible',
    timeout: INSTALL_TIMEOUT,
  });
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Launch OrangeHRM' }).click();
  await expectRoute(page, baseUrl, '/web/index.php/auth/login');
}

async function createEmployee(page, baseUrl) {
  await page.getByPlaceholder('Username').fill(requiredEnv('OHRM_ADMIN_USERNAME'));
  await page.getByPlaceholder('Password').fill(requiredEnv('OHRM_ADMIN_PASSWORD'));
  await page.getByRole('button', { name: 'Login' }).click();
  await expectRoute(page, baseUrl, '/web/index.php/dashboard/index');

  await page.getByRole('link', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/\/web\/index\.php\/leave\//);
  await page.getByText('Configure', { exact: true }).click();
  await page.getByText('Leave Period', { exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expectSaved(page);

  await page.getByRole('link', { name: 'Time' }).click();
  await expect(page).toHaveURL(/\/web\/index\.php\/time\//);
  await page.getByText('Configure', { exact: true }).click();
  await page.getByText('Work Week', { exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expectSaved(page);

  await page.getByRole('link', { name: 'PIM' }).click();
  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('input[name="firstName"]').fill('Zephyr');
  await page.locator('input[name="middleName"]').fill('Kite');
  await page.locator('input[name="lastName"]').fill('Bloom');
  await page
    .locator('.oxd-input-group', { hasText: 'Employee Id' })
    .locator('input')
    .fill('EMP002');
  await page.locator('.oxd-switch-wrapper input[type="checkbox"]').check();
  await page.getByLabel('Username').fill(requiredEnv('OHRM_ESS_USERNAME'));
  await page.getByLabel('Password').fill(requiredEnv('OHRM_ESS_PASSWORD'));
  await page.getByLabel('Confirm Password').fill(requiredEnv('OHRM_ESS_PASSWORD'));
  await page.getByRole('button', { name: 'Save' }).click();
  await expectSaved(page);
}

async function configureAdmin(page, baseUrl) {
  await page.getByRole('link', { name: 'Admin' }).click();
  await page.getByText('Configuration', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Register OAuth Client' }).click();
  await expectRoute(page, baseUrl, '/web/index.php/admin/registerOAuthClient');

  await registerOAuthClient(page, baseUrl, {
    name: 'Swagger',
    redirectUri: `${baseUrl}/swagger/oauth2-redirect.html`,
    envPrefix: 'SWAGGER',
  });
  await registerOAuthClient(page, baseUrl, {
    name: 'Bruno',
    redirectUri: 'https://oauth.usebruno.com/callback',
    envPrefix: 'BRUNO',
    comment: true,
  });
  await registerOAuthClient(page, baseUrl, {
    name: 'Playwright',
    redirectUri: `${process.env.OHRM_AUTH_REDIRECT_URL}/oauth/callback`,
    envPrefix: 'PLAYWRIGHT',
  });

  await page.getByText('Configuration', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Email Configuration' }).click();
  await expectRoute(page, baseUrl, '/web/index.php/admin/listMailConfiguration');
  await page.getByLabel('Mail Sent As').fill('orangehrm@5.9.test');
  await page.getByLabel('SMTP Host').fill('mailpit');
  await page.getByLabel('SMTP Port').fill('1025');
  await page.locator('input[type="radio"][value="smtp"]').check();
  await page.locator('input[type="radio"][value="none"]').check();
  await page
    .locator('.orangehrm-optional-field-row', { hasText: 'Send Test Mail' })
    .locator('input[type="checkbox"]')
    .check();
  await page.getByLabel('Test Email Address').fill('orangehrm@5.9.test.example');
  await page.getByRole('button', { name: 'Save' }).click();
  await expectSaved(page);
}

async function main() {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`Missing ${ENV_PATH}. Copy .env.example to .env and configure it first.`);
  }

  const baseUrl = requiredEnv('OHRM_BASE_URL').replace(/\/+$/, '');
  const authRedirectUrl = requiredEnv('OHRM_AUTH_REDIRECT_URL').replace(/\/+$/, '');
  process.env.OHRM_AUTH_REDIRECT_URL = authRedirectUrl;

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(30_000);

    await install(page, baseUrl);
    await createEmployee(page, baseUrl);
    await configureAdmin(page, baseUrl);

    const mailpitUrl = `http://localhost:${requiredEnv('MAILPIT_WEB_HOST_PORT')}`;
    await page.goto(mailpitUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('To: orangehrm@5.9.test.example', { exact: false })).toBeVisible({
      timeout: 30_000,
    });
    console.log('OrangeHRM installation and local test data setup completed.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`\nEnvironment installation failed: ${error.message}`);
  process.exitCode = 1;
});
