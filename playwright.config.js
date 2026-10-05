const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');
const { defineConfig, devices } = require('@playwright/test');

dotenvExpand.expand(dotenv.config());

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
