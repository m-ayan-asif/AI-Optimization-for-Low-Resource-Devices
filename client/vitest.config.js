import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    // Exclude Playwright E2E tests and default build output from Vitest
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'e2e/**',
      '**/e2e/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/hooks/**', 'src/utils/**'],
      exclude: ['src/utils/constants.js'],
    },
  },
});

