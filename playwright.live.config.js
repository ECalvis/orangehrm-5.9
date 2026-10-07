const { defineConfig } = require('@playwright/test');

const baseConfig = require('./playwright.config');

module.exports = defineConfig({
  ...baseConfig,
  testMatch: '**/*.integration.js',
  fullyParallel: false,
  outputDir: 'test-results/live',
});
