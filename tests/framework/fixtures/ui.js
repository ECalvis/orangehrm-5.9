const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');
const { test: base, expect } = require('@playwright/test');

dotenvExpand.expand(dotenv.config());

const { createUi } = require('../../../src/ui');

const test = base.extend({
  ui: async ({ page }, use) => {
    const baseUrl = process.env.OHRM_BASE_URL;
    if (!baseUrl) {
      throw new Error('Missing required environment variable: OHRM_BASE_URL');
    }
    await use(createUi(page, baseUrl));
  },
});

module.exports = { test, expect };
