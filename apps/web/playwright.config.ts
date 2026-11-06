import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real stack: web (3100) → API (4000) →
 * PostgreSQL/Redis, with verification codes read from Mailpit.
 * Locally: `pnpm infra:up && pnpm build && pnpm --filter @takawise/web e2e`.
 * Servers are reused when already running (e.g. `pnpm dev`).
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3100';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'pnpm --filter @takawise/api start',
      url: `${API_URL}/api/v1/health/ready`,
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @takawise/web start',
      url: WEB_URL,
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: '../..',
    },
  ],
});
