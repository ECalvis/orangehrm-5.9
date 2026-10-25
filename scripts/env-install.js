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
  try {
    await expect(page).toHaveURL(`${baseUrl}${route}`);
  } catch (error) {
    const validationErrors = await page.locator('.oxd-input-field-error-message').allTextContents();
    const emptyRequiredFields = await page.locator('.oxd-input-group').evaluateAll((groups) =>
      groups
        .filter((group) => group.querySelector('.oxd-input-field-required'))
        .filter((group) =>
          Array.from(group.querySelectorAll('input')).some((input) => !input.value),
        )
        .map((group) => group.innerText.split('\n')[0]),
    );

    // eslint-disable-next-line preserve-caught-error
    throw new Error(
      `${error.message}\nValidation errors: ${validationErrors.join('; ') || 'none'}\n` +
        `Empty required fields: ${emptyRequiredFields.join(', ') || 'none'}`,
    );
  }
}

async function selectRadio(page, name) {
  const radio = page.getByRole('radio', { name, exact: true });
  const wrapper = page.locator('.oxd-radio-wrapper').filter({ has: radio });

  await expect(radio).toHaveCount(1);
  await wrapper.getByText(name, { exact: true }).click();
  await expect(radio).toBeChecked();
}

async function clickTopbarMenu(page, name) {
  const item = page.locator('.oxd-topbar-body-nav-tab-item').filter({ hasText: name });

  await expect(item, `Expected one topbar menu named "${name}"`).toHaveCount(1);
  await item.click();
}

async function selectRadioByValue(page, value, label) {
  const radio = page.locator(`.oxd-radio-wrapper input[type="radio"][value="${value}"]`);

  await expect(radio, `Expected one radio option for "${label}" (${value})`).toHaveCount(1);

  await radio.locator('xpath=..').click();

  await expect(radio).toBeChecked();
}

async function fillField(page, label, value) {
  const field = page.locator('.oxd-input-group').filter({
    has: page.locator(`label.oxd-label:text-is("${label}")`),
  });

  await expect(field, `Expected one input group for "${label}"`).toHaveCount(1);

  const input = field.locator('input').first();

  await input.fill(value);

  await expect(input, `"${label}" was not filled correctly`).toHaveValue(value);
}

async function readField(page, label) {
  const field = page
    .locator('.oxd-input-group')
    .filter({ has: page.locator('label.oxd-label').getByText(label, { exact: true }) });

  await expect(field, `Expected one input group for "${label}"`).toHaveCount(1);
  const value = await field.locator('input').inputValue();

  if (!value) {
    throw new Error(`OrangeHRM did not provide a value for the "${label}" field.`);
  }

  return value;
}

async function setCheckboxByText(page, text, checked) {
  const wrapper = page.locator('.oxd-checkbox-wrapper').filter({ hasText: text });
  const checkbox = wrapper.locator('input[type="checkbox"]');

  await expect(wrapper, `Expected one checkbox for "${text}"`).toHaveCount(1);

  if ((await checkbox.isChecked()) !== checked) {
    await wrapper.locator('label').click();
  }

  await expect(checkbox).toBeChecked({ checked });
}

async function setSwitch(wrapper, checked, description) {
  const input = wrapper.locator('input[type="checkbox"]');

  await expect(input, `Expected one switch for "${description}"`).toHaveCount(1);

  if ((await input.isChecked()) !== checked) {
    await wrapper.locator('label').click();
  }

  await expect(input).toBeChecked({ checked });
}

async function selectDropdown(page, label, option) {
  const field = page
    .locator('.oxd-input-group')
    .filter({ has: page.locator('label.oxd-label').getByText(label, { exact: true }) });

  await expect(field, `Expected one dropdown for "${label}"`).toHaveCount(1);
  await field.locator('.oxd-select-text').click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(field.locator('.oxd-select-text-input')).toHaveText(option);
}

async function expectSaved(page) {
  await expect(page.getByText('Successfully Saved', { exact: false })).toBeVisible({
    timeout: 15_000,
  });
}

async function registerOAuthClient(page, baseUrl, { name, redirectUri, envPrefix, comment }) {
  await page.getByRole('button', { name: 'Add' }).click();
  await expectRoute(page, baseUrl, '/web/index.php/admin/saveOAuthClient');
  await fillField(page, 'Name', name);
  await fillField(page, 'Redirect URI', redirectUri);
  const confidentialSwitch = page
    .locator('.orangehrm-field-row', { hasText: 'Confidential Client' })
    .locator('.oxd-switch-wrapper');
  const enableClientSwitch = page
    .locator('.orangehrm-field-row', { hasText: 'Enable Client' })
    .locator('.oxd-switch-wrapper');

  await expect(confidentialSwitch).toHaveCount(1);
  await expect(enableClientSwitch).toHaveCount(1);
  await setSwitch(enableClientSwitch, true, 'Enable Client');
  await setSwitch(confidentialSwitch, true, 'Confidential Client');
  await page.getByRole('button', { name: 'Save' }).click();
  await expectSaved(page);

  const clientId = await readField(page, 'Client ID');
  const clientSecret = await readField(page, 'Client Secret');

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

  await selectRadio(page, 'Fresh Installation');
  await page.getByRole('button', { name: 'Next' }).click();
  await expectRoute(page, baseUrl, '/installer/index.php/installer/licence-acceptance');
  await page.getByText('I accept the terms in the').click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expectRoute(page, baseUrl, '/installer/index.php/installer/database-config');
  await selectRadio(page, 'Existing Empty Database');
  await fillField(page, 'Database Host Name', 'mariadb');
  await fillField(page, 'Database Host Port', '3306');
  await fillField(page, 'Database Name', requiredEnv('OHRM_DB_NAME'));
  await fillField(page, 'OrangeHRM Database Username', requiredEnv('OHRM_DB_USER'));
  await fillField(page, 'OrangeHRM Database User Password', requiredEnv('OHRM_DB_PASSWORD'));
  await page.getByRole('button', { name: 'Next' }).click();

  await expectRoute(page, baseUrl, '/installer/index.php/installer/system-check');
  await page.getByRole('button', { name: 'Next' }).click();

  await expectRoute(page, baseUrl, '/installer/index.php/installer/instance-creation');
  await selectDropdown(page, 'Country', 'Philippines');
  await selectDropdown(page, 'Language', 'English (United States)');
  await selectDropdown(page, 'Timezone', 'Asia/Manila');
  await fillField(page, 'Organization Name', 'ECalvis');

  await expect(
    page
      .locator('.oxd-input-group')
      .filter({
        has: page.locator('label.oxd-label').getByText('Organization Name', { exact: true }),
      })
      .locator('input'),
  ).toHaveValue('ECalvis');
  await page.getByRole('button', { name: 'Next' }).click();

  await expectRoute(page, baseUrl, '/installer/index.php/installer/admin-user-creation');
  await page.getByPlaceholder('First Name').fill('Caummo');
  await page.getByPlaceholder('Last Name').fill('Bunummu');
  await fillField(page, 'Email', requiredEnv('OHRM_ADMIN_USERNAME'));
  await fillField(page, 'Contact Number', '09123456789');
  await fillField(page, 'Admin Username', requiredEnv('OHRM_ADMIN_USERNAME'));
  await fillField(page, 'Password', requiredEnv('OHRM_ADMIN_PASSWORD'));
  await fillField(page, 'Confirm Password', requiredEnv('OHRM_ADMIN_PASSWORD'));
  await setCheckboxByText(page, 'Register your system with OrangeHRM.', false);
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
  //await clickTopbarMenu(page, 'Configure');
  //await page.getByText('Leave Period', { exact: true }).click();
  //await expectRoute(page, baseUrl, '/web/index.php/leave/defineLeavePeriod');
  await page.getByRole('button', { name: 'Save' }).click();
  await expectSaved(page);

  await page.getByRole('link', { name: 'Time' }).click();
  await expectRoute(page, baseUrl, '/web/index.php/time/viewTimeModule');
  await page.getByRole('button', { name: 'Save' }).click();
  await expectSaved(page);

  await page.getByRole('link', { name: 'PIM' }).click();
  await page.getByRole('button', { name: 'Add' }).click();
  await expectRoute(page, baseUrl, '/web/index.php/pim/addEmployee');
  await page.locator('input[name="firstName"]').fill('Zephyr');
  await page.locator('input[name="middleName"]').fill('Kite');
  await page.locator('input[name="lastName"]').fill('Bloom');
  await fillField(page, 'Employee Id', 'EMP002');
  await setSwitch(page.locator('.oxd-switch-wrapper'), true, 'Create Login Details');
  await fillField(page, 'Username', requiredEnv('OHRM_ESS_USERNAME'));
  await fillField(page, 'Password', requiredEnv('OHRM_ESS_PASSWORD'));
  await fillField(page, 'Confirm Password', requiredEnv('OHRM_ESS_PASSWORD'));
  await page.getByRole('button', { name: 'Save' }).click();
  await expectSaved(page);
}

async function configureAdmin(page, baseUrl) {
  await page.getByRole('link', { name: 'Admin' }).click();
  await clickTopbarMenu(page, 'Configuration');
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

  await clickTopbarMenu(page, 'Configuration');
  await page.getByRole('menuitem', { name: 'Email Configuration' }).click();

  await expectRoute(page, baseUrl, '/web/index.php/admin/listMailConfiguration');

  // Select configuration mode FIRST.
  await selectRadioByValue(page, 'smtp', 'SMTP');
  await selectRadioByValue(page, 'none', 'No');

  // Now fill the SMTP fields.
  await fillField(page, 'Mail Sent As', 'orangehrm@5.9.test');
  await fillField(page, 'SMTP Host', 'mailpit');
  await fillField(page, 'SMTP Port', '1025');

  // Verify them before saving.
  await expect(
    page
      .locator('.oxd-input-group')
      .filter({
        has: page.locator('label.oxd-label:text-is("Mail Sent As")'),
      })
      .locator('input'),
  ).toHaveValue('orangehrm@5.9.test');

  await expect(
    page
      .locator('.oxd-input-group')
      .filter({
        has: page.locator('label.oxd-label:text-is("SMTP Host")'),
      })
      .locator('input'),
  ).toHaveValue('mailpit');

  await expect(
    page
      .locator('.oxd-input-group')
      .filter({
        has: page.locator('label.oxd-label:text-is("SMTP Port")'),
      })
      .locator('input'),
  ).toHaveValue('1025');

  // Enable test mail.
  const sendTestMailSwitch = page
    .locator('.orangehrm-optional-field-row', { hasText: 'Send Test Mail' })
    .locator('.oxd-switch-wrapper');

  await expect(sendTestMailSwitch).toHaveCount(1);

  await setSwitch(sendTestMailSwitch, true, 'Send Test Mail');

  // Wait for the dynamically-created field.
  await expect(
    page.locator('.oxd-input-group').filter({
      has: page.locator('label.oxd-label:text-is("Test Email Address")'),
    }),
  ).toBeVisible();

  await fillField(page, 'Test Email Address', 'orangehrm@5.9.test.example');

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

  const browser = await chromium.launch({ headless: false });

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
