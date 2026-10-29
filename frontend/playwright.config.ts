import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4175', browserName: 'chromium', viewport: { width: 768, height: 1024 }, hasTouch: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npx vite --config e2e/vite.config.ts', url: 'http://127.0.0.1:4175/e2e/index.html', reuseExistingServer: !process.env.CI },
});
