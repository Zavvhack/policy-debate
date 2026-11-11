// End-to-end tests: they open the BUILT single-file app from disk (file://),
// exactly as you would from a USB drive, in a real browser.
// Run `npm run build:html` first, then `npm run e2e`.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    viewport: { width: 1366, height: 768 }, // a small laptop screen
    trace: 'off',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
