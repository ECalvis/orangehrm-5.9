const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');
const { defineConfig } = require('@playwright/test');

dotenvExpand.expand(dotenv.config());

module.exports = defineConfig({
  ...require('./playwright.config'),
  testDir: './tests/live',
  workers: 1,
});
