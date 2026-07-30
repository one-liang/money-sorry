// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.js',
  timeout: 180000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    // 用系統上已安裝的 Chrome，不另外下載瀏覽器
    channel: 'chrome',
    launchOptions: { args: ['--allow-file-access-from-files'] },
  },
});
