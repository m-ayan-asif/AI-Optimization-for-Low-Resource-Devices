import { defineConfig, devices } from '@playwright/test';

// End-to-end tests of the PWA against the real backend. Needs the stack running first (start.cmd, or
// `docker compose up -d` in deploy/). See e2e/README.md.
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1, // one shared test account; registration is rate-limited to 3 per hour
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    // Installed Edge or Chrome needs no browser download; set E2E_CHANNEL= (empty) to use `npx playwright install chromium`.
    channel: process.env.E2E_CHANNEL ?? 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'], channel: process.env.E2E_CHANNEL ?? 'msedge' } }],
  webServer: {
    // Production build of the client, then vite preview with /api proxied to the stack.
    command: 'npx vite build && npx vite preview --config ../e2e/preview.config.js',
    cwd: '../client',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
