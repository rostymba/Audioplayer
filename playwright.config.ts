import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3001', channel: 'chrome', launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } },
  webServer: { command: 'npm run build && npm run start -- --port 3001', url: 'http://127.0.0.1:3001', reuseExistingServer: false },
});
